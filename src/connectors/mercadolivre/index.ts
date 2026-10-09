import type { MarketplaceConnector } from "../types";
import {
  getCategoryAttributes,
  getListingForEdit,
  setListingStock,
  updateListing,
  updateListingDescription,
} from "./editing";
import type { FetchFn } from "./http";
import { getListings, listListingIds } from "./items";
import {
  buildAuthorizationUrl,
  exchangeCode,
  refreshTokens,
  type MercadoLivreAppConfig,
} from "./oauth";
import { getAccountProfile } from "./users";

export type { MercadoLivreAppConfig } from "./oauth";

/** Mercado Livre Brasil (MLB) connector. Config comes from the server (env), never hard-coded. */
export function createMercadoLivreConnector(
  config: MercadoLivreAppConfig,
  fetchFn: FetchFn = fetch,
): MarketplaceConnector {
  return {
    id: "mercadolivre",
    label: "Mercado Livre",
    buildAuthorizationUrl: (input) => buildAuthorizationUrl(config, input),
    exchangeCode: (input) => exchangeCode(config, fetchFn, input),
    refreshTokens: (refreshToken) => refreshTokens(config, fetchFn, refreshToken),
    getAccountProfile: (accessToken) => getAccountProfile(fetchFn, accessToken),
    listListingIds: (accessToken, externalUserId) =>
      listListingIds(fetchFn, accessToken, externalUserId),
    getListings: (accessToken, externalIds) => getListings(fetchFn, accessToken, externalIds),
    getCategoryAttributes: (accessToken, categoryId) =>
      getCategoryAttributes(fetchFn, accessToken, categoryId),
    getListingForEdit: (accessToken, externalId) =>
      getListingForEdit(fetchFn, accessToken, externalId),
    updateListing: (accessToken, externalId, patch) =>
      updateListing(fetchFn, accessToken, externalId, patch),
    setListingStock: (accessToken, externalId, quantity) =>
      setListingStock(fetchFn, accessToken, externalId, quantity),
    updateListingDescription: (accessToken, externalId, text, exists) =>
      updateListingDescription(fetchFn, accessToken, externalId, text, exists),
  };
}
