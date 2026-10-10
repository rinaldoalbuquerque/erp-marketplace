import { describe, expect, it, vi } from "vitest";

import type { FetchFn } from "@/connectors/mercadolivre/http";
import {
  publishListing,
  quoteFees,
  suggestCategories,
  toPublishBody,
  uploadPicture,
  validateListing,
} from "@/connectors/mercadolivre/publishing";
import { MarketplaceApiError, MarketplaceValidationError } from "@/connectors/types";
import { emptyListing, type CanonicalListing } from "@/domain/listings/canonical";

type Reply = { status: number; body?: unknown };

function fakeFetch(handler: (url: URL, init?: RequestInit) => Reply) {
  const fn = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const { status, body } = handler(new URL(String(input)), init);
    return new Response(status === 204 ? null : JSON.stringify(body ?? {}), { status });
  });
  return fn as unknown as FetchFn & typeof fn;
}

const listing: CanonicalListing = {
  ...emptyListing(),
  familyName: "Borracha Panela de Pressão 4,5 L",
  title: "Borracha Panela de Pressão 4,5 L Clock",
  categoryId: "MLB1234",
  priceCents: 2990,
  availableQuantity: 5,
  pictures: [{ id: "123-MLB456_112021", url: null }],
  attributes: [
    { id: "BRAND", valueId: null, valueName: "Clock" },
    { id: "COLOR", valueId: "52049", valueName: "Preto" },
  ],
  warranty: { type: "Garantia do vendedor", time: "90 dias" },
};

describe("publishing body", () => {
  it("User Products: family_name and no title", () => {
    const body = toPublishBody(listing, "user_products");
    expect(body).toMatchObject({
      family_name: "Borracha Panela de Pressão 4,5 L",
      category_id: "MLB1234",
      price: 29.9,
      currency_id: "BRL",
      available_quantity: 5,
      buying_mode: "buy_it_now",
      listing_type_id: "gold_special",
      condition: "new",
      pictures: [{ id: "123-MLB456_112021" }],
      attributes: [
        { id: "BRAND", value_name: "Clock" },
        { id: "COLOR", value_id: "52049", value_name: "Preto" },
      ],
      sale_terms: [
        { id: "WARRANTY_TYPE", value_name: "Garantia do vendedor" },
        { id: "WARRANTY_TIME", value_name: "90 dias" },
      ],
    });
    expect(body).not.toHaveProperty("title");
  });

  it("package size and weight go as SELLER_PACKAGE_* attributes (numbers only)", () => {
    const body = toPublishBody(
      { ...listing, package: { weightG: 500, heightCm: 10, widthCm: 20, lengthCm: 30 } },
      "user_products",
    );
    expect(body.attributes).toEqual(
      expect.arrayContaining([
        { id: "SELLER_PACKAGE_WEIGHT", value_name: "500" },
        { id: "SELLER_PACKAGE_HEIGHT", value_name: "10" },
        { id: "SELLER_PACKAGE_WIDTH", value_name: "20" },
        { id: "SELLER_PACKAGE_LENGTH", value_name: "30" },
      ]),
    );
  });

  it("traditional: title and no family_name", () => {
    const body = toPublishBody(listing, "traditional");
    expect(body).toMatchObject({ title: "Borracha Panela de Pressão 4,5 L Clock" });
    expect(body).not.toHaveProperty("family_name");
  });
});

describe("Mercado Livre publishing", () => {
  it("suggests up to 3 categories from the text", async () => {
    const fetchFn = fakeFetch(() => ({
      status: 200,
      body: [
        {
          domain_id: "MLB-PRESSURE_COOKER_GASKETS",
          domain_name: "Borrachas para panela",
          category_id: "MLB1234",
          category_name: "Borrachas",
          attributes: [{ id: "BRAND", value_id: "1", value_name: "Clock" }],
        },
      ],
    }));
    expect(await suggestCategories(fetchFn, "t", "borracha panela pressão")).toEqual([
      {
        categoryId: "MLB1234",
        categoryName: "Borrachas",
        domainName: "Borrachas para panela",
        attributes: [{ id: "BRAND", valueId: "1", valueName: "Clock" }],
      },
    ]);
    const url = new URL(String(fetchFn.mock.calls[0]?.[0]));
    expect(url.pathname).toBe("/sites/MLB/domain_discovery/search");
    expect(url.searchParams.get("limit")).toBe("3");
    expect(await suggestCategories(fetchFn, "t", "  ")).toEqual([]);
  });

  it("uploads a picture as multipart and keeps the id and an https url", async () => {
    const fetchFn = fakeFetch(() => ({
      status: 201,
      body: {
        id: "123-MLB456_112021",
        variations: [
          {
            size: "1920x1076",
            url: "http://http2.mlstatic.com/D_NQ_NP_123-F.jpg",
            secure_url: "https://http2.mlstatic.com/D_NQ_NP_123-F.jpg",
          },
        ],
      },
    }));
    const picture = await uploadPicture(fetchFn, "t", new Blob(["x"]), "foto.jpg");
    expect(picture).toEqual({
      id: "123-MLB456_112021",
      url: "https://http2.mlstatic.com/D_NQ_NP_123-F.jpg",
    });
    const init = fetchFn.mock.calls[0]?.[1] as RequestInit;
    expect(init.body).toBeInstanceOf(FormData);
    expect((init.body as FormData).get("file")).toBeInstanceOf(Blob);
  });

  it("quotes the sale fee per listing type", async () => {
    const fetchFn = fakeFetch((url) => ({
      status: 200,
      body: [
        {
          listing_type_id: url.searchParams.get("listing_type_id"),
          listing_type_name:
            url.searchParams.get("listing_type_id") === "gold_pro" ? "Premium" : "Clássico",
          sale_fee_amount: url.searchParams.get("listing_type_id") === "gold_pro" ? 5.98 : 3.89,
          sale_fee_details: { percentage_fee: 13, fixed_fee: 0 },
        },
      ],
    }));
    const quotes = await quoteFees(fetchFn, "t", {
      categoryId: "MLB1234",
      priceCents: 2990,
      listingTypeIds: ["gold_special", "gold_pro"],
    });
    expect(quotes).toEqual([
      {
        listingTypeId: "gold_special",
        listingTypeName: "Clássico",
        saleFeeCents: 389,
        percentageFee: 13,
        fixedFeeCents: 0,
      },
      {
        listingTypeId: "gold_pro",
        listingTypeName: "Premium",
        saleFeeCents: 598,
        percentageFee: 13,
        fixedFeeCents: 0,
      },
    ]);
    expect(new URL(String(fetchFn.mock.calls[0]?.[0])).searchParams.get("price")).toBe("29.90");
  });

  it("validate: 400 with only warnings is valid (real answer seen on 2026-10-10)", async () => {
    const warningsOnly = fakeFetch(() => ({
      status: 400,
      body: {
        cause: [
          { type: "warning", code: "shipping.lost_me1_by_user", message: "User has not mode me1" },
          {
            type: "warning",
            code: "shipping.free_shipping.cost_exceeded",
            message: "Free shipping costs exceeds sale",
          },
        ],
        message: "Validation error",
        error: "validation_error",
        status: 400,
      },
    }));
    const result = await validateListing(warningsOnly, "t", listing, "user_products");
    expect(result.warnings).toHaveLength(2);
    // a warning mixed with an error: only the error is a problem
    const mixed = fakeFetch(() => ({
      status: 400,
      body: {
        cause: [
          { type: "warning", message: "User has not mode me1" },
          { type: "error", message: "The attributes [GTIN] are required" },
        ],
      },
    }));
    await expect(validateListing(mixed, "t", listing, "user_products")).rejects.toMatchObject({
      causes: ["The attributes [GTIN] are required"],
    });
  });

  it("validate: 204 is ok; 400 brings the causes", async () => {
    await validateListing(
      fakeFetch(() => ({ status: 204 })),
      "t",
      listing,
      "user_products",
    );
    const refused = fakeFetch(() => ({
      status: 400,
      body: {
        message: "Validation error",
        cause: [{ code: "item.attributes.missing_required", message: "Atributo GTIN obrigatório" }],
      },
    }));
    await expect(validateListing(refused, "t", listing, "user_products")).rejects.toBeInstanceOf(
      MarketplaceValidationError,
    );
  });

  it("publishes once (no automatic retry) and returns the new listing", async () => {
    const ok = fakeFetch(() => ({
      status: 201,
      body: {
        id: "MLB999",
        title: "Borracha",
        status: "active",
        family_name: "Borracha",
        user_product_id: "MLBU1",
      },
    }));
    const created = await publishListing(ok, "t", listing, "user_products");
    expect(created).toMatchObject({ externalId: "MLB999", listingModel: "user_products" });

    const down = fakeFetch(() => ({ status: 503 }));
    await expect(publishListing(down, "t", listing, "user_products")).rejects.toBeInstanceOf(
      MarketplaceApiError,
    );
    expect(down).toHaveBeenCalledTimes(1);
  });
});
