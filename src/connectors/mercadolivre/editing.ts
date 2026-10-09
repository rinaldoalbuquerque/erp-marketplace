import { z } from "zod";

import type {
  AttributeDefinition,
  AttributeValue,
  AttributeValueType,
} from "@/domain/listings/attributes";

import {
  MarketplaceApiError,
  MarketplaceAuthError,
  MarketplaceValidationError,
  type EditableListing,
  type ListingPatch,
} from "../types";
import { ML_API_BASE, mlFetch, type FetchFn } from "./http";
import { normalizeItem } from "./items";
import { translateMlMessage } from "./messages";

// Editing Mercado Livre listings.
// - Category attributes: GET /categories/{CATEGORY_ID}/attributes
//   https://developers.mercadolivre.com.br/pt_br/atributos (value_type, values,
//   allowed_units, default_unit, value_max_length, tags: required, hidden,
//   read_only, fixed, inferred, multivalued, conditional_required, ...)
// - Item with N/A attributes: GET /items/{id}?include_internal_attributes=true
// - Update: PUT /items/{id} with only the changed fields; attributes not sent
//   stay as they are; remove = value_id/value_name null; N/A = value_id "-1".
//   https://developers.mercadolivre.com.br/pt_br/produto-sincronizacao-de-publicacoes
//   Title can't change after the first sale. User Products: title is not
//   editable (400), edit family_name instead
//   https://developers.mercadolivre.com.br/pt_br/preco-variacao
//   Price is refused for items with price automation (error or "warnings")
//   https://developers.mercadolivre.com.br/pt_br/automatizacoes-de-precos
// - Description: plain text only; GET /items/{id}/description,
//   POST to create, PUT /items/{id}/description?api_version=2 to replace
//   https://developers.mercadolivre.com.br/pt_br/descricao-de-produtos

const categoryAttributeSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    value_type: z.string().optional(),
    values: z
      .array(z.object({ id: z.union([z.string(), z.number()]), name: z.string() }).passthrough())
      .default([]),
    allowed_units: z
      .array(z.object({ id: z.string(), name: z.string() }).passthrough())
      .default([]),
    default_unit: z.string().nullish(),
    value_max_length: z.number().nullish(),
    attribute_group_name: z.string().nullish(),
    tags: z.record(z.string(), z.unknown()).default({}),
  })
  .passthrough();

const VALUE_TYPES = new Set<AttributeValueType>([
  "string",
  "number",
  "number_unit",
  "boolean",
  "list",
]);

export function normalizeCategoryAttributes(body: unknown): AttributeDefinition[] {
  const list = z.array(categoryAttributeSchema).parse(body);
  return list.map((attribute) => {
    const tags = attribute.tags;
    const flag = (name: string) => tags[name] === true;
    const valueType = (attribute.value_type ?? "other") as AttributeValueType;
    return {
      id: attribute.id,
      name: attribute.name,
      valueType: VALUE_TYPES.has(valueType) ? valueType : "other",
      values: attribute.values.map((value) => ({ id: String(value.id), name: value.name })),
      units: attribute.allowed_units.map((unit) => ({ id: unit.id, name: unit.name })),
      defaultUnit: attribute.default_unit ?? null,
      required: flag("required"),
      conditionalRequired: flag("conditional_required"),
      hidden: flag("hidden"),
      // read_only: sellers can't set it; fixed/inferred: filled by Mercado Livre.
      readOnly: flag("read_only") || flag("fixed") || flag("inferred"),
      multivalued: flag("multivalued"),
      maxLength: attribute.value_max_length ?? null,
      group: attribute.attribute_group_name ?? null,
    };
  });
}

export const bearer = (accessToken: string) => ({
  accept: "application/json",
  authorization: `Bearer ${accessToken}`,
});

type MlErrorBody = {
  message?: string;
  error?: string;
  /** Documented as an array, but seen in practice as a single object or text too. */
  cause?: unknown;
};

/** Readable messages from `cause`, whatever its shape (array, object, string). */
export function causeMessages(cause: unknown): string[] {
  const items = Array.isArray(cause) ? cause : cause == null ? [] : [cause];
  return items
    .map((item) => {
      if (typeof item === "string") return item;
      if (item && typeof item === "object") {
        const { message, code } = item as { message?: unknown; code?: unknown };
        if (typeof message === "string" && message) return message;
        if (typeof code === "string" && code) return code;
      }
      return "";
    })
    .filter(Boolean);
}

/** Turns an ML error response into an error the user can read. */
export async function failure(response: Response, what: string): Promise<never> {
  if (response.status === 401) {
    throw new MarketplaceAuthError("Mercado Livre rejected the access token.", "unauthorized");
  }
  let body: MlErrorBody = {};
  try {
    body = (await response.json()) as MlErrorBody;
  } catch {
    // no body
  }
  if (response.status >= 400 && response.status < 500) {
    // Seen in practice: { cause: 374, message: "BODY_INVALID_FIELDS",
    // error: "The field family name is invalid" } -> the readable text is in `error`.
    const causes = causeMessages(body.cause);
    const readable = [body.error, body.message].find((text) => text && /\s/.test(text));
    throw new MarketplaceValidationError(
      causes.length
        ? causes
        : [readable || body.message || body.error || `${what}: HTTP ${response.status}`],
    );
  }
  throw new MarketplaceApiError(`${what} failed.`, response.status, body.error ?? null);
}

export async function getCategoryAttributes(
  fetchFn: FetchFn,
  accessToken: string,
  categoryId: string,
): Promise<AttributeDefinition[]> {
  const response = await mlFetch(
    fetchFn,
    `${ML_API_BASE}/categories/${encodeURIComponent(categoryId)}/attributes`,
    { headers: bearer(accessToken) },
  );
  if (!response.ok) await failure(response, "Category attributes");
  return normalizeCategoryAttributes(await response.json());
}

const itemAttributesSchema = z.array(
  z
    .object({
      id: z.string(),
      value_id: z.union([z.string(), z.number()]).nullish(),
      value_name: z.string().nullish(),
    })
    .passthrough(),
);

export async function getListingForEdit(
  fetchFn: FetchFn,
  accessToken: string,
  externalId: string,
): Promise<EditableListing> {
  const id = encodeURIComponent(externalId);
  const itemResponse = await mlFetch(
    fetchFn,
    `${ML_API_BASE}/items/${id}?include_internal_attributes=true`,
    { headers: bearer(accessToken) },
  );
  if (!itemResponse.ok) await failure(itemResponse, "Item");
  const body = (await itemResponse.json()) as Record<string, unknown>;
  const listing = normalizeItem(body);
  const attributes: AttributeValue[] = itemAttributesSchema
    .catch([])
    .parse(body.attributes ?? [])
    .map((attribute) => ({
      id: attribute.id,
      valueId: attribute.value_id == null ? null : String(attribute.value_id),
      valueName: attribute.value_name ?? null,
    }));

  const descriptionResponse = await mlFetch(fetchFn, `${ML_API_BASE}/items/${id}/description`, {
    headers: bearer(accessToken),
  });
  let description: string | null = null;
  if (descriptionResponse.ok) {
    const data = (await descriptionResponse.json()) as { plain_text?: string };
    description = data.plain_text ?? "";
  } else if (descriptionResponse.status !== 404) {
    await failure(descriptionResponse, "Description");
  }

  const isUserProducts = listing.listingModel === "user_products";
  return {
    listing,
    attributes,
    description,
    rules: {
      // Title: never on User Products; on traditional items only before the first sale.
      titleEditable: !isUserProducts && (listing.soldQuantity ?? 0) === 0,
      // family_name via PUT /items was refused on a real UP item (2026-10-09:
      // 400 "The field family name is invalid"). It is changed for the whole
      // family through PUT /user-products-families/{family_id} (not built yet).
      familyNameEditable: false,
      titleLockReason: isUserProducts
        ? "user_products"
        : (listing.soldQuantity ?? 0) > 0
          ? "has_sales"
          : null,
    },
  };
}

/** ML request body for a patch (prices go in currency units, not cents). */
export function toItemBody(patch: ListingPatch): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  if (patch.title !== undefined) body.title = patch.title;
  if (patch.familyName !== undefined) body.family_name = patch.familyName;
  if (patch.priceCents !== undefined) body.price = patch.priceCents / 100;
  if (patch.status !== undefined) body.status = patch.status;
  if (patch.attributes?.length) {
    body.attributes = patch.attributes.map((attribute) => ({
      id: attribute.id,
      value_id: attribute.valueId,
      value_name: attribute.valueName,
    }));
  }
  return body;
}

/** Warnings in a successful response (e.g. price ignored by price automation). */
function readWarnings(body: unknown): string[] {
  const warnings = (body as { warnings?: unknown } | null)?.warnings;
  if (!Array.isArray(warnings)) return [];
  return warnings
    .map((warning) =>
      typeof warning === "string"
        ? warning
        : ((warning as { message?: string; code?: string }).message ??
          (warning as { code?: string }).code ??
          ""),
    )
    .filter(Boolean);
}

export async function updateListing(
  fetchFn: FetchFn,
  accessToken: string,
  externalId: string,
  patch: ListingPatch,
): Promise<{ warnings: string[] }> {
  const body = toItemBody(patch);
  if (Object.keys(body).length === 0) return { warnings: [] };
  const response = await mlFetch(
    fetchFn,
    `${ML_API_BASE}/items/${encodeURIComponent(externalId)}`,
    {
      method: "PUT",
      headers: { ...bearer(accessToken), "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  if (!response.ok) await failure(response, "Item update");
  let result: unknown = null;
  try {
    result = await response.json();
  } catch {
    // empty body
  }
  // General notices about the item (e.g. shipping setup); translated when known.
  return { warnings: readWarnings(result).map(translateMlMessage) };
}

export async function updateListingDescription(
  fetchFn: FetchFn,
  accessToken: string,
  externalId: string,
  text: string,
  exists: boolean,
): Promise<void> {
  const base = `${ML_API_BASE}/items/${encodeURIComponent(externalId)}/description`;
  const response = await mlFetch(fetchFn, exists ? `${base}?api_version=2` : base, {
    method: exists ? "PUT" : "POST",
    headers: { ...bearer(accessToken), "content-type": "application/json" },
    body: JSON.stringify({ plain_text: text }),
  });
  if (!response.ok) await failure(response, "Description update");
}

/**
 * Stock of a listing without multi-origin: PUT /items/{id} { available_quantity }.
 * For User Products, Mercado Livre replicates it to every item of the same
 * user_product_id. 0 pauses the item (out_of_stock); > 0 reactivates it unless
 * paused by the seller. Full (fulfillment) stock can't be changed via API.
 * https://developers.mercadolivre.com.br/pt_br/estoque-distribuido
 * https://developers.mercadolivre.com.br/pt_br/produto-sincronizacao-de-publicacoes
 */
export async function setListingStock(
  fetchFn: FetchFn,
  accessToken: string,
  externalId: string,
  quantity: number,
): Promise<void> {
  if (!Number.isInteger(quantity) || quantity < 0) {
    throw new RangeError("Stock quantity must be a whole number >= 0.");
  }
  const response = await mlFetch(
    fetchFn,
    `${ML_API_BASE}/items/${encodeURIComponent(externalId)}`,
    {
      method: "PUT",
      headers: { ...bearer(accessToken), "content-type": "application/json" },
      body: JSON.stringify({ available_quantity: quantity }),
    },
  );
  if (!response.ok) await failure(response, "Stock update");
}
