import type { MarketplaceConnector } from "../types";
import type { FetchFn } from "./http";
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
  };
}
