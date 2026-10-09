import { randomBytes, randomUUID } from "node:crypto";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { MarketplaceApiError } from "@/connectors/types";
import { InvoiceRefusedError, type InvoiceDocument } from "@/fiscal/types";
import { db } from "@/server/db";
import {
  checkInvoiceReadiness,
  issueInvoices,
  refreshPendingInvoices,
  syncInvoicesForShipment,
} from "@/server/fiscal/invoice-service";
import { encryptTokens } from "@/server/marketplaces/token-service";
import { fakeFiscalProvider } from "@/test/fake-fiscal";

// Real database (`npm run test:db`) in a TEMPORARY organization deleted at the end.
// The invoice issuer is simulated: no invoice is issued anywhere.

const key = randomBytes(32);
const externalUserId = `test-${randomUUID()}`;
let organizationId: string;
let accountId: string;
let counter = 0;

function doc(overrides: Partial<InvoiceDocument> = {}): InvoiceDocument {
  counter++;
  return {
    externalId: `INV-${Date.now()}-${counter}`,
    status: "authorized",
    number: 1000 + counter,
    series: "1",
    accessKey: null,
    amountCents: 5000,
    issuedAt: new Date(),
    danfePath: null,
    xmlPath: null,
    raw: {},
    ...overrides,
  };
}

async function createOrder(
  extra: {
    packId?: string | null;
    stage?: "invoice_pending" | "printed" | "cancelled";
    shippingId?: string;
  } = {},
) {
  counter++;
  return db.order.create({
    data: {
      organizationId,
      marketplaceAccountId: accountId,
      marketplace: "mercadolivre",
      externalId: `${Date.now()}${counter}`,
      packId: extra.packId ?? null,
      status: extra.stage === "cancelled" ? "cancelled" : "paid",
      stage: extra.stage ?? "invoice_pending",
      shippingId: extra.shippingId ?? null,
      dateCreated: new Date(),
      raw: {},
      syncedAt: new Date(),
    },
  });
}

const deps = (provider: ReturnType<typeof fakeFiscalProvider>) => ({
  key,
  providerFor: () => provider,
});

beforeAll(async () => {
  organizationId = (await db.organization.create({ data: { name: "[teste] notas" } })).id;
  accountId = (
    await db.marketplaceAccount.create({
      data: {
        organizationId,
        marketplace: "mercadolivre",
        externalUserId,
        nickname: "TESTE",
        ...encryptTokens(
          {
            accessToken: "access",
            refreshToken: "refresh",
            expiresAt: new Date(Date.now() + 6 * 60 * 60 * 1000),
            scopes: null,
            externalUserId: "1",
          },
          key,
        ),
      },
    })
  ).id;
});

afterAll(async () => {
  await db.order.updateMany({ where: { organizationId }, data: { invoiceId: null } });
  await db.organization.deleteMany({ where: { id: organizationId } });
  await db.$disconnect();
});

beforeEach(() => {
  counter += 10;
});

describe("invoices against the database", () => {
  it("issues ONE invoice for the whole cart, even when only one order was selected", async () => {
    const pack = `P-${Date.now()}`;
    const first = await createOrder({ packId: pack });
    const second = await createOrder({ packId: pack });
    const issued: string[][] = [];
    const provider = fakeFiscalProvider({
      issueForOrders: async (_ctx, ids) => {
        issued.push(ids);
        return doc({ number: 555 });
      },
    });
    const result = await issueInvoices(organizationId, null, [first.id], deps(provider));
    expect(result).toEqual({
      status: "done",
      outcomes: [{ status: "issued", packKey: pack, number: 555 }],
    });
    expect(issued).toEqual([[first.externalId, second.externalId].sort()]);
    const linked = await db.order.findMany({
      where: { id: { in: [first.id, second.id] } },
      select: { invoice: { select: { number: true, status: true } } },
    });
    expect(linked.map((row) => row.invoice)).toEqual([
      { number: 555, status: "authorized" },
      { number: 555, status: "authorized" },
    ]);
  });

  it("never issues when the order already has an invoice (e.g. from the seller panel)", async () => {
    const order = await createOrder();
    const provider = fakeFiscalProvider({ findInvoiceForOrder: async () => doc({ number: 77 }) });
    const result = await issueInvoices(organizationId, null, [order.id], deps(provider));
    expect(result).toMatchObject({ outcomes: [{ status: "already_had", number: 77 }] });
  });

  it("a refusal is recorded with the reason and does not stop the other carts", async () => {
    const bad = await createOrder();
    const good = await createOrder();
    const provider = fakeFiscalProvider({
      issueForOrders: async (_ctx, ids) => {
        if (ids[0] === bad.externalId) {
          throw new InvoiceRefusedError("14", "CPF do destinatário inválido");
        }
        return doc();
      },
    });
    const result = await issueInvoices(organizationId, null, [bad.id, good.id], deps(provider));
    expect(result).toMatchObject({
      outcomes: expect.arrayContaining([
        { status: "refused", packKey: bad.externalId, reason: "CPF do destinatário inválido" },
        expect.objectContaining({ status: "issued", packKey: good.externalId }),
      ]),
    });
    const failed = await db.invoice.findFirstOrThrow({ where: { packKey: bad.externalId } });
    expect(failed).toMatchObject({ status: "error", errorCode: "14" });
    expect((await db.order.findUniqueOrThrow({ where: { id: bad.id } })).invoiceId).toBeNull();
  });

  it("lost answer: asks the provider again instead of issuing twice", async () => {
    const order = await createOrder();
    let calls = 0;
    let lookups = 0;
    const provider = fakeFiscalProvider({
      findInvoiceForOrder: async () => (lookups++ === 0 ? null : doc({ number: 909 })),
      issueForOrders: async () => {
        calls++;
        throw new MarketplaceApiError("no answer", null);
      },
    });
    const result = await issueInvoices(organizationId, null, [order.id], deps(provider));
    expect(calls).toBe(1);
    expect(result).toMatchObject({ outcomes: [{ status: "issued", number: 909 }] });
  });

  it("a request in progress for the cart blocks a second one", async () => {
    const order = await createOrder();
    await db.invoice.create({
      data: {
        organizationId,
        marketplaceAccountId: accountId,
        provider: "mercadolivre",
        status: "requesting",
        packKey: order.externalId,
      },
    });
    const provider = fakeFiscalProvider({
      issueForOrders: async () => {
        throw new Error("must not issue");
      },
    });
    const result = await issueInvoices(organizationId, null, [order.id], deps(provider));
    expect(result).toMatchObject({ outcomes: [{ status: "skipped" }] });
  });

  it("does not issue for cancelled orders or orders not waiting for the invoice", async () => {
    const cancelled = await createOrder({ stage: "cancelled" });
    const printed = await createOrder({ stage: "printed" });
    const provider = fakeFiscalProvider();
    const result = await issueInvoices(
      organizationId,
      null,
      [cancelled.id, printed.id],
      deps(provider),
    );
    expect(result).toMatchObject({
      outcomes: [{ status: "skipped" }, { status: "skipped" }],
    });
  });

  it("brings in invoices issued outside the ERP once the shipment is past the invoice step", async () => {
    const order = await createOrder({ stage: "printed", shippingId: `S-${Date.now()}` });
    const provider = fakeFiscalProvider({ findInvoiceForOrder: async () => doc({ number: 4242 }) });
    await syncInvoicesForShipment(
      { id: accountId, organizationId, marketplace: "mercadolivre", externalUserId },
      "token",
      order.shippingId!,
      deps(provider),
    );
    const saved = await db.order.findUniqueOrThrow({
      where: { id: order.id },
      select: { invoice: { select: { number: true } }, invoiceCheckedAt: true },
    });
    expect(saved.invoice?.number).toBe(4242);
    expect(saved.invoiceCheckedAt).not.toBeNull();
  });

  it("readiness lists the listings without fiscal data", async () => {
    const order = await createOrder();
    await db.orderItem.create({
      data: {
        organizationId,
        orderId: order.id,
        externalItemId: "MLB-NOFISCAL",
        title: "Sem fiscal",
        quantity: 1,
      },
    });
    const provider = fakeFiscalProvider({
      checkListing: async () => ({ ok: false, restrictions: ["NCM ausente"] }),
    });
    const rows = await checkInvoiceReadiness(organizationId, [order.id], deps(provider));
    expect(rows).toEqual([
      {
        orderId: order.id,
        externalId: order.externalId,
        ready: false,
        problems: ["MLB-NOFISCAL: NCM ausente"],
      },
    ]);
  });

  it("an invoice pending authorization is read again until it gets its number", async () => {
    const order = await createOrder();
    const externalId = `INV-PENDING-${Date.now()}`;
    let answer = doc({ externalId, status: "pending_authorization", number: null, series: null });
    const provider = fakeFiscalProvider({
      issueForOrders: async () => answer,
      findInvoiceForOrder: async (_ctx, id) =>
        id === order.externalId && answer.status !== "pending_authorization" ? answer : null,
    });
    await issueInvoices(organizationId, null, [order.id], deps(provider));
    expect(await db.invoice.findFirstOrThrow({ where: { externalId } })).toMatchObject({
      status: "pending_authorization",
      number: null,
    });

    answer = doc({
      externalId,
      status: "authorized",
      number: 31337,
      danfePath: "/users/x/invoices/d",
    });
    const account = {
      id: accountId,
      organizationId,
      marketplace: "mercadolivre" as const,
      externalUserId,
    };
    expect(await refreshPendingInvoices(account, "token", deps(provider))).toBe(1);
    const saved = await db.invoice.findFirstOrThrow({ where: { externalId } });
    expect(saved).toMatchObject({ status: "authorized", number: 31337 });
    expect(await db.invoice.count({ where: { packKey: order.externalId } })).toBe(1);
  });
});
