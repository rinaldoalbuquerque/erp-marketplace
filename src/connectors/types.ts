// Contract every marketplace connector implements (CLAUDE.md: "Conectores de
// marketplace"). The rest of the ERP only talks to this interface; everything
// marketplace-specific lives in src/connectors/<marketplace>/.
// It grows phase by phase (listings in 2A, orders in 3...).

export type MarketplaceId = "mercadolivre";

/** Listing format of a seller account (see CLAUDE.md, Mercado Livre User Products). */
export type ListingModel = "traditional" | "user_products" | "unknown";

export type OAuthTokens = {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
  scopes: string | null;
  /** Seller id the tokens belong to. */
  externalUserId: string;
};

export type AccountProfile = {
  externalUserId: string;
  nickname: string;
  siteId: string | null;
  listingModel: ListingModel;
};

export interface MarketplaceConnector {
  readonly id: MarketplaceId;
  /** Human name for the UI. */
  readonly label: string;
  /** URL that sends the seller to the marketplace to authorize the ERP. */
  buildAuthorizationUrl(input: { state: string; codeChallenge: string }): string;
  /** Exchanges the authorization code (returned to the redirect URI) for tokens. */
  exchangeCode(input: { code: string; codeVerifier: string }): Promise<OAuthTokens>;
  /** Gets new tokens. Throws MarketplaceAuthError when the seller must reconnect. */
  refreshTokens(refreshToken: string): Promise<OAuthTokens>;
  /** Who the tokens belong to and which listing model the account uses. */
  getAccountProfile(accessToken: string): Promise<AccountProfile>;
}

/** The authorization is no longer valid: the seller must connect the account again. */
export class MarketplaceAuthError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = "MarketplaceAuthError";
  }
}

/** Any other failure talking to the marketplace (network, 5xx, unexpected answer). */
export class MarketplaceApiError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly code: string | null = null,
  ) {
    super(message);
    this.name = "MarketplaceApiError";
  }
}
