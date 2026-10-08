import { z } from "zod";

import {
  MarketplaceApiError,
  MarketplaceAuthError,
  type AccountProfile,
  type ListingModel,
} from "../types";
import { ML_API_BASE, mlFetch, readErrorBody, type FetchFn } from "./http";

// GET /users/me with the token in the Authorization header.
// Docs: https://developers.mercadolivre.com.br/pt_br/autenticacao-e-autorizacao ("Enviar access token no header")
// User Products sellers carry the tag "user_product_seller" in the /users API:
// https://developers.mercadolivre.com.br/pt_br/user-products
//
// Confirmed on a real MLB account (2026-10-08): /users/me returns `tags` (array
// of strings, e.g. ["normal","business","eshop","user_product_seller"]), `id`,
// `nickname` and `site_id`. We rely only on these, tolerant to absence.

export const USER_PRODUCT_SELLER_TAG = "user_product_seller";

const usersMeSchema = z.object({
  id: z.union([z.number(), z.string()]),
  nickname: z.string().optional(),
  site_id: z.string().optional(),
  tags: z.array(z.string()).optional(),
});

export function listingModelFromTags(tags: readonly string[] | undefined): ListingModel {
  if (!tags) return "unknown";
  return tags.includes(USER_PRODUCT_SELLER_TAG) ? "user_products" : "traditional";
}

export async function getAccountProfile(
  fetchFn: FetchFn,
  accessToken: string,
): Promise<AccountProfile> {
  const response = await mlFetch(fetchFn, `${ML_API_BASE}/users/me`, {
    headers: { accept: "application/json", authorization: `Bearer ${accessToken}` },
  });
  if (response.status === 401) {
    throw new MarketplaceAuthError("Mercado Livre rejected the access token.", "unauthorized");
  }
  if (!response.ok) {
    const error = await readErrorBody(response);
    throw new MarketplaceApiError(
      "Could not read the Mercado Livre account.",
      response.status,
      error.error ?? null,
    );
  }
  const parsed = usersMeSchema.safeParse(await response.json());
  if (!parsed.success) {
    throw new MarketplaceApiError("Unexpected /users/me response.", response.status);
  }
  const user = parsed.data;
  return {
    externalUserId: String(user.id),
    nickname: user.nickname ?? String(user.id),
    siteId: user.site_id ?? null,
    listingModel: listingModelFromTags(user.tags),
  };
}
