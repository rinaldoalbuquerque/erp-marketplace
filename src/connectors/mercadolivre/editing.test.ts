import { describe, expect, it, vi } from "vitest";

import {
  causeMessages,
  changeListingType,
  getListingForEdit,
  normalizeCategoryAttributes,
  setListingStock,
  toItemBody,
  updateListing,
  updateListingDescription,
} from "@/connectors/mercadolivre/editing";
import type { FetchFn } from "@/connectors/mercadolivre/http";
import { MarketplaceValidationError } from "@/connectors/types";

type Reply = { status: number; body?: unknown };

/** Fake fetch: answers by "METHOD path" (query string ignored), records calls. */
function fakeFetch(routes: Record<string, Reply>) {
  const fn = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const reply = routes[`${init?.method ?? "GET"} ${url.pathname}`] ?? { status: 500, body: {} };
    return new Response(reply.body === undefined ? null : JSON.stringify(reply.body), {
      status: reply.status,
    });
  });
  return fn as unknown as FetchFn & typeof fn;
}

const callOf = (fn: ReturnType<typeof fakeFetch>, index = 0) => {
  const [input, init] = fn.mock.calls[index] as unknown as [string, RequestInit | undefined];
  return { url: new URL(input), init: init ?? {} };
};

describe("normalizeCategoryAttributes", () => {
  it("reads which attributes may vary and which define the picture", () => {
    const [color, brand] = normalizeCategoryAttributes([
      {
        id: "COLOR",
        name: "Cor",
        value_type: "string",
        tags: { allow_variations: true, defines_picture: true },
      },
      { id: "BRAND", name: "Marca", value_type: "string", tags: { required: true } },
    ]);
    expect(color).toMatchObject({ allowsVariations: true, definesPicture: true });
    expect(brand).toMatchObject({ allowsVariations: false, definesPicture: false });
  });

  it("maps the documented category attribute shape", () => {
    const [format, brand, color, width] = normalizeCategoryAttributes([
      {
        id: "HEADPHONE_FORMAT",
        name: "Formato",
        tags: { fixed: true },
        value_type: "list",
        values: [{ id: "182349", name: "In-Ear" }],
        attribute_group_name: "Otros",
      },
      {
        id: "BRAND",
        name: "Marca",
        tags: { required: true },
        value_type: "string",
        value_max_length: 60,
        values: [{ id: 15438, name: "Shure" }],
      },
      {
        id: "COLOR",
        name: "Cor",
        tags: { allow_variations: true, hidden: true },
        value_type: "list",
      },
      {
        id: "WIDTH",
        name: "Largura",
        tags: {},
        value_type: "number_unit",
        allowed_units: [{ id: "cm", name: "cm" }],
        default_unit: "cm",
      },
    ]);
    expect(format).toMatchObject({ readOnly: true, valueType: "list", group: "Otros" });
    expect(brand).toMatchObject({
      required: true,
      maxLength: 60,
      values: [{ id: "15438", name: "Shure" }],
    });
    expect(color).toMatchObject({ hidden: true, readOnly: false, values: [] });
    expect(width).toMatchObject({ units: [{ id: "cm", name: "cm" }], defaultUnit: "cm" });
  });

  it("unknown value types become 'other'", () => {
    expect(
      normalizeCategoryAttributes([{ id: "X", name: "X", value_type: "grid_id" }])[0]?.valueType,
    ).toBe("other");
  });
});

describe("getListingForEdit", () => {
  const item = {
    id: "MLB1",
    title: "Garrafa térmica 1L Azul",
    price: 89.9,
    sold_quantity: 0,
    family_name: null,
    attributes: [
      { id: "BRAND", value_id: 123, value_name: "Termolar" },
      { id: "VOLTAGE", value_id: "-1", value_name: null },
    ],
  };

  it("asks for N/A attributes and reads the plain-text description", async () => {
    const fetchFn = fakeFetch({
      "GET /items/MLB1": { status: 200, body: item },
      "GET /items/MLB1/description": { status: 200, body: { plain_text: "Linha 1\nLinha 2" } },
    });
    const result = await getListingForEdit(fetchFn, "t", "MLB1");
    expect(callOf(fetchFn).url.searchParams.get("include_internal_attributes")).toBe("true");
    expect(result.attributes).toEqual([
      { id: "BRAND", valueId: "123", valueName: "Termolar" },
      { id: "VOLTAGE", valueId: "-1", valueName: null },
    ]);
    expect(result.description).toBe("Linha 1\nLinha 2");
    expect(result.rules).toEqual({
      titleEditable: true,
      familyNameEditable: false,
      titleLockReason: null,
    });
  });

  it("no description yet -> null; title locked after sales and on User Products", async () => {
    const sold = fakeFetch({
      "GET /items/MLB1": { status: 200, body: { ...item, sold_quantity: 3 } },
      "GET /items/MLB1/description": { status: 404, body: {} },
    });
    const traditional = await getListingForEdit(sold, "t", "MLB1");
    expect(traditional.description).toBeNull();
    expect(traditional.rules).toMatchObject({ titleEditable: false, titleLockReason: "has_sales" });

    const up = fakeFetch({
      "GET /items/MLB1": { status: 200, body: { ...item, family_name: "Garrafa térmica" } },
      "GET /items/MLB1/description": { status: 404, body: {} },
    });
    // family_name via PUT /items is refused by Mercado Livre (seen on a real UP item).
    expect((await getListingForEdit(up, "t", "MLB1")).rules).toEqual({
      titleEditable: false,
      familyNameEditable: false,
      titleLockReason: "user_products",
    });
  });

  it("reads Mercado Livre errors whatever the shape of 'cause'", async () => {
    // Real answer seen on 2026-10-09 (cause is a number, readable text in `error`).
    const fetchFn = fakeFetch({
      "PUT /items/MLB1": {
        status: 400,
        body: {
          cause: 374,
          message: "BODY_INVALID_FIELDS",
          error: "The field family name is invalid",
          status: 400,
        },
      },
    });
    const error = await updateListing(fetchFn, "t", "MLB1", { familyName: "X" }).catch(
      (caught: unknown) => caught,
    );
    expect((error as MarketplaceValidationError).causes).toEqual([
      "The field family name is invalid",
    ]);
    expect(causeMessages({ code: "item.title.invalid" })).toEqual(["item.title.invalid"]);
    expect(causeMessages("texto")).toEqual(["texto"]);
    expect(causeMessages(null)).toEqual([]);
  });
});

describe("pictures and listing type", () => {
  it("sends the pictures as the full ordered list of ids", () => {
    expect(toItemBody({ pictures: ["P2", "P1"] })).toEqual({
      pictures: [{ id: "P2" }, { id: "P1" }],
    });
  });

  it("changes the listing type with POST /items/{id}/listing_type", async () => {
    const fetchFn = fakeFetch({ "POST /items/MLB1/listing_type": { status: 200, body: {} } });
    await changeListingType(fetchFn, "t", "MLB1", "gold_pro");
    const { init } = callOf(fetchFn);
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ id: "gold_pro" });
  });
});

describe("updateListing", () => {
  it("sends only the patch, price in reais, attributes with id/value", () => {
    expect(
      toItemBody({
        familyName: "Garrafa",
        priceCents: 8990,
        status: "paused",
        attributes: [
          { id: "COLOR", valueId: "52028", valueName: "Azul" },
          { id: "DIAMETER", valueId: null, valueName: null },
        ],
      }),
    ).toEqual({
      family_name: "Garrafa",
      price: 89.9,
      status: "paused",
      attributes: [
        { id: "COLOR", value_id: "52028", value_name: "Azul" },
        { id: "DIAMETER", value_id: null, value_name: null },
      ],
    });
  });

  it("does not call Mercado Livre when there is nothing to send", async () => {
    const fetchFn = fakeFetch({});
    expect(await updateListing(fetchFn, "t", "MLB1", {})).toEqual({ warnings: [] });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("PUTs the item and returns warnings (e.g. price ignored by automation)", async () => {
    const fetchFn = fakeFetch({
      "PUT /items/MLB1": {
        status: 200,
        body: {
          id: "MLB1",
          warnings: [{ code: "price.automation", message: "Price not updated" }],
        },
      },
    });
    const result = await updateListing(fetchFn, "t", "MLB1", { priceCents: 1000, title: "Novo" });
    const { init } = callOf(fetchFn);
    expect(init.method).toBe("PUT");
    expect(JSON.parse(String(init.body))).toEqual({ title: "Novo", price: 10 });
    expect(result.warnings).toEqual(["Price not updated"]);
  });

  it("4xx becomes a validation error with the causes from Mercado Livre", async () => {
    const fetchFn = fakeFetch({
      "PUT /items/MLB1": {
        status: 400,
        body: {
          message: "Validation error",
          error: "validation_error",
          cause: [
            { code: "item.attributes.deleted_required", message: "Required attribute BRAND" },
          ],
        },
      },
    });
    const error = await updateListing(fetchFn, "t", "MLB1", { status: "paused" }).catch(
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(MarketplaceValidationError);
    expect((error as MarketplaceValidationError).causes).toEqual(["Required attribute BRAND"]);
  });
});

describe("setListingStock", () => {
  it("PUTs available_quantity on the item", async () => {
    const fetchFn = fakeFetch({ "PUT /items/MLB1": { status: 200, body: { id: "MLB1" } } });
    await setListingStock(fetchFn, "t", "MLB1", 7);
    const { init } = callOf(fetchFn);
    expect(init.method).toBe("PUT");
    expect(JSON.parse(String(init.body))).toEqual({ available_quantity: 7 });
  });

  it("refuses negative or fractional quantities before calling", async () => {
    const fetchFn = fakeFetch({});
    await expect(setListingStock(fetchFn, "t", "MLB1", -1)).rejects.toThrow(RangeError);
    await expect(setListingStock(fetchFn, "t", "MLB1", 1.5)).rejects.toThrow(RangeError);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("a refusal becomes a validation error", async () => {
    const fetchFn = fakeFetch({
      "PUT /items/MLB1": {
        status: 400,
        body: { error: "Item in fulfillment can not change stock" },
      },
    });
    await expect(setListingStock(fetchFn, "t", "MLB1", 3)).rejects.toBeInstanceOf(
      MarketplaceValidationError,
    );
  });
});

describe("updateListingDescription", () => {
  it("PUT with api_version=2 to replace, POST to create", async () => {
    const replace = fakeFetch({ "PUT /items/MLB1/description": { status: 200, body: {} } });
    await updateListingDescription(replace, "t", "MLB1", "Texto", true);
    const put = callOf(replace);
    expect(put.url.searchParams.get("api_version")).toBe("2");
    expect(JSON.parse(String(put.init.body))).toEqual({ plain_text: "Texto" });

    const create = fakeFetch({ "POST /items/MLB1/description": { status: 201, body: {} } });
    await updateListingDescription(create, "t", "MLB1", "Texto", false);
    expect(callOf(create).init.method).toBe("POST");
  });
});
