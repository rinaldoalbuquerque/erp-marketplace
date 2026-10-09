import { describe, expect, it, vi } from "vitest";

import type { FetchFn } from "@/connectors/mercadolivre/http";
import { createMercadoLivreInvoicer, normalizeInvoice } from "@/connectors/mercadolivre/invoices";
import { MarketplaceApiError } from "@/connectors/types";
import { InvoiceRefusedError } from "@/fiscal/types";

type Reply = { status: number; body: unknown; type?: string };

function fakeFetch(handler: (url: URL, init?: RequestInit) => Reply) {
  const fn = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const { status, body, type } = handler(new URL(String(input)), init);
    const payload = typeof body === "string" ? body : JSON.stringify(body);
    return new Response(payload, {
      status,
      headers: { "content-type": type ?? "application/json" },
    });
  });
  return fn as unknown as FetchFn & typeof fn;
}

const ctx = { accessToken: "t", sellerId: "225885396" };

// Fields seen on a real BELA invoice (2026-10-09) / documentation example.
const authorized = {
  id: 7176571409,
  status: "authorized",
  transaction_status: "authorized",
  invoice_number: 12313213,
  invoice_series: "12",
  amount: 35.8,
  issued_date: "2020-03-06T17:52:05.269",
  attributes: {
    invoice_key: "35200300000000000000550120123132131000000000",
    authorization_date: "2020-03-06T17:52:05.268",
    danfe_location: "/users/225885396/invoices/sites/MLB/documents/danfe/7176571409",
    xml_location: "/users/225885396/invoices/documents/xml/7176571409/authorized",
  },
};

describe("Mercado Livre invoicer", () => {
  it("normalizes an invoice (dates without zone read as Brasília time)", () => {
    expect(normalizeInvoice(authorized)).toMatchObject({
      externalId: "7176571409",
      status: "authorized",
      number: 12313213,
      series: "12",
      amountCents: 3580,
      issuedAt: new Date("2020-03-06T20:52:05.268Z"),
      danfePath: "/users/225885396/invoices/sites/MLB/documents/danfe/7176571409",
    });
  });

  it("finds the invoice of an order; 404 means none", async () => {
    const found = fakeFetch(() => ({ status: 200, body: authorized }));
    const invoicer = createMercadoLivreInvoicer(found);
    expect((await invoicer.findInvoiceForOrder(ctx, "2000018768302842"))?.number).toBe(12313213);
    expect(new URL(String(found.mock.calls[0]?.[0])).pathname).toBe(
      "/users/225885396/invoices/orders/2000018768302842",
    );
    const none = createMercadoLivreInvoicer(
      fakeFetch(() => ({ status: 404, body: { message: "Invoice not found", error_code: "404" } })),
    );
    expect(await none.findInvoiceForOrder(ctx, "1")).toBeNull();
  });

  it("issues one invoice for all cart orders, ids sent as exact JSON numbers", async () => {
    const fetchFn = fakeFetch(() => ({ status: 201, body: authorized }));
    const invoice = await createMercadoLivreInvoicer(fetchFn).issueForOrders(ctx, [
      "2000018768302842",
      "2000018768302843",
    ]);
    expect(invoice.status).toBe("authorized");
    const init = fetchFn.mock.calls[0]?.[1] as RequestInit;
    expect(init.method).toBe("POST");
    expect(init.body).toBe('{"orders":[2000018768302842,2000018768302843]}');
  });

  it("a refusal carries the readable message from the errors resource", async () => {
    const fetchFn = fakeFetch((url) =>
      url.pathname.startsWith("/users/invoices/errors/")
        ? { status: 200, body: { id: "14", display_message: "CPF do destinatário inválido" } }
        : { status: 400, body: { message: "invalid", error_code: "14" } },
    );
    const error = await createMercadoLivreInvoicer(fetchFn)
      .issueForOrders(ctx, ["1"])
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(InvoiceRefusedError);
    expect(error).toMatchObject({ code: "14", reason: "CPF do destinatário inválido" });
    expect(new URL(String(fetchFn.mock.calls[1]?.[0])).pathname).toBe(
      "/users/invoices/errors/MLB/14",
    );
  });

  it("never retries the issue call (a lost answer could mean a second invoice)", async () => {
    const fetchFn = fakeFetch(() => ({ status: 503, body: {} }));
    await expect(
      createMercadoLivreInvoicer(fetchFn).issueForOrders(ctx, ["1"]),
    ).rejects.toBeInstanceOf(MarketplaceApiError);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    await expect(
      createMercadoLivreInvoicer(fetchFn).issueForOrders(ctx, ["12a"]),
    ).rejects.toBeInstanceOf(RangeError);
  });

  it("checks whether a listing can be invoiced", async () => {
    const fetchFn = fakeFetch(() => ({
      status: 200,
      body: { item_id: "MLB1", status: false, restrictions: [{ message: "NCM ausente" }] },
    }));
    expect(await createMercadoLivreInvoicer(fetchFn).checkListing(ctx, "MLB1")).toEqual({
      ok: false,
      restrictions: ["NCM ausente"],
    });
  });

  it("downloads only the seller's own documents", async () => {
    const fetchFn = fakeFetch(() => ({ status: 200, body: "%PDF", type: "application/pdf" }));
    const invoicer = createMercadoLivreInvoicer(fetchFn);
    expect((await invoicer.download(ctx, authorized.attributes.danfe_location)).contentType).toBe(
      "application/pdf",
    );
    await expect(invoicer.download(ctx, "/users/999/invoices/x")).rejects.toBeInstanceOf(
      RangeError,
    );
  });
});
