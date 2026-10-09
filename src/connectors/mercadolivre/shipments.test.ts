import { describe, expect, it, vi } from "vitest";

import type { FetchFn } from "@/connectors/mercadolivre/http";
import {
  getShipment,
  getShipmentSla,
  getShippingLabels,
  normalizeShipment,
} from "@/connectors/mercadolivre/shipments";
import { MarketplaceValidationError } from "@/connectors/types";

function fakeFetch(
  handler: (url: URL, init?: RequestInit) => { status: number; body: unknown; type?: string },
) {
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

// Fields from the documentation (new format, x-format-new: true).
const docShipment = {
  id: 43308302844,
  status: "ready_to_ship",
  substatus: "ready_to_print",
  tracking_number: "BR123",
  logistic: { mode: "me2", type: "xd_drop_off", direction: "forward" },
  lead_time: { buffering: { date: null } },
};

describe("shipments", () => {
  it("normalizes the documented shipment", () => {
    expect(normalizeShipment(docShipment)).toMatchObject({
      externalId: "43308302844",
      status: "ready_to_ship",
      substatus: "ready_to_print",
      mode: "me2",
      logisticType: "xd_drop_off",
      trackingNumber: "BR123",
      labelAvailableAt: null,
    });
  });

  it("sends the mandatory x-format-new header", async () => {
    const fetchFn = fakeFetch(() => ({ status: 200, body: docShipment }));
    await getShipment(fetchFn, "t", "43308302844");
    const init = fetchFn.mock.calls[0]?.[1] as RequestInit;
    expect((init.headers as Record<string, string>)["x-format-new"]).toBe("true");
    expect(new URL(String(fetchFn.mock.calls[0]?.[0])).pathname).toBe("/shipments/43308302844");
  });

  it("reads the dispatch deadline; none for shipments without SLA", async () => {
    const ok = fakeFetch(() => ({
      status: 200,
      body: { status: "on_time", expected_date: "2024-05-22T23:59:59-03:00" },
    }));
    expect(await getShipmentSla(ok, "t", "1")).toEqual({
      status: "on_time",
      expectedDate: new Date("2024-05-23T02:59:59.000Z"),
    });
    const none = fakeFetch(() => ({ status: 404, body: {} }));
    expect(await getShipmentSla(none, "t", "1")).toBeNull();
  });

  it("downloads labels of several shipments; refuses non printable ones with the reason", async () => {
    const pdf = fakeFetch(() => ({ status: 200, body: "%PDF-1.4", type: "application/pdf" }));
    const file = await getShippingLabels(pdf, "t", ["1", "2"], "pdf");
    expect(file.contentType).toBe("application/pdf");
    const url = new URL(String(pdf.mock.calls[0]?.[0]));
    expect(url.pathname).toBe("/shipment_labels");
    expect(url.searchParams.get("shipment_ids")).toBe("1,2");
    expect(url.searchParams.get("response_type")).toBe("pdf");

    const zpl = fakeFetch(() => ({ status: 200, body: "^XA", type: "text/plain" }));
    await getShippingLabels(zpl, "t", ["1"], "zpl");
    expect(new URL(String(zpl.mock.calls[0]?.[0])).searchParams.get("response_type")).toBe("zpl2");

    const refused = fakeFetch(() => ({
      status: 400,
      body: { error: "not_printable_status", message: "Estado não permitido" },
    }));
    await expect(getShippingLabels(refused, "t", ["1"], "pdf")).rejects.toBeInstanceOf(
      MarketplaceValidationError,
    );
    await expect(getShippingLabels(pdf, "t", [], "pdf")).rejects.toBeInstanceOf(RangeError);
  });
});
