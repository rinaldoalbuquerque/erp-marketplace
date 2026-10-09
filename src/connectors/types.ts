// Contract every marketplace connector implements (CLAUDE.md: "Conectores de
// marketplace"). The rest of the ERP only talks to this interface; everything
// marketplace-specific lives in src/connectors/<marketplace>/.
// It grows phase by phase (listings in 2A, orders in 3...).

import type { CanonicalListing, PublishModel } from "@/domain/listings/canonical";
import type { AttributeDefinition, AttributeValue } from "@/domain/listings/attributes";

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
  /** Seller uses multi-origin stock (needs another stock endpoint). */
  multiWarehouse: boolean;
};

/** Variation of a listing (traditional ML listings with a "variations" array). */
export type MarketplaceListingVariation = {
  externalId: string;
  attributes: Array<{ name: string; value: string }>;
  priceCents: number | null;
  availableQuantity: number | null;
  soldQuantity: number | null;
  sellerSku: string | null;
};

/** A listing in a marketplace-neutral shape (what the ERP stores in `listings`). */
export type MarketplaceListing = {
  externalId: string;
  title: string;
  status: string;
  subStatus: string[];
  priceCents: number | null;
  currency: string | null;
  availableQuantity: number | null;
  soldQuantity: number | null;
  permalink: string | null;
  thumbnailUrl: string | null;
  categoryId: string | null;
  listingTypeId: string | null;
  condition: string | null;
  listingModel: ListingModel;
  userProductId: string | null;
  familyId: string | null;
  familyName: string | null;
  sellerSku: string | null;
  /** Shipping logistic, e.g. "fulfillment" (Full: stock managed by the marketplace). */
  logisticType: string | null;
  externalUpdatedAt: Date | null;
  variations: MarketplaceListingVariation[];
  /** Full original payload (kept for the canonical model and editing). */
  raw: unknown;
};

/** One entry per requested id: the listing, or why it could not be read. */
export type ListingFetchResult =
  { externalId: string; listing: MarketplaceListing } | { externalId: string; error: string };

/** One sold line of an order (neutral shape). */
export type MarketplaceOrderItem = {
  externalItemId: string;
  /** Variation id, or "" when the listing has no variations. */
  variationKey: string;
  title: string;
  quantity: number;
  unitPriceCents: number | null;
  saleFeeCents: number | null;
  sellerSku: string | null;
};

/** A sale in a marketplace-neutral shape (what the ERP stores in `orders`). */
export type MarketplaceOrder = {
  externalId: string;
  packId: string | null;
  status: string;
  tags: string[];
  totalCents: number | null;
  currency: string | null;
  buyerNickname: string | null;
  shippingId: string | null;
  dateCreated: Date;
  /** Sale confirmed (the marketplace discounted its stock); null while not confirmed. */
  dateClosed: Date | null;
  externalUpdatedAt: Date | null;
  items: MarketplaceOrderItem[];
  raw: unknown;
};

/** Shipment of an order (neutral shape). */
export type MarketplaceShipment = {
  externalId: string;
  status: string | null;
  substatus: string | null;
  /** e.g. me2 (labels only exist for me2) */
  mode: string | null;
  /** e.g. xd_drop_off, cross_docking, self_service, fulfillment */
  logisticType: string | null;
  trackingNumber: string | null;
  /** Label released only from this moment (substatus buffered) */
  labelAvailableAt: Date | null;
  raw: unknown;
};

/** Dispatch deadline promised to the buyer. */
export type ShipmentSla = { expectedDate: Date | null; status: string | null };

export type LabelFormat = "pdf" | "zpl";

/** Label file as returned by the marketplace. */
export type LabelFile = { contentType: string; data: ArrayBuffer };

/** Category suggested from a product name. */
export type CategorySuggestion = {
  categoryId: string;
  categoryName: string;
  domainName: string | null;
  /** Attribute values the marketplace inferred from the text (e.g. brand). */
  attributes: AttributeValue[];
};

/** Marketplace fee to sell at a price, per listing type. */
export type FeeQuote = {
  listingTypeId: string;
  listingTypeName: string | null;
  saleFeeCents: number;
  percentageFee: number | null;
  fixedFeeCents: number | null;
};

export type UploadedPicture = { id: string; url: string | null };

/** Any listing (own or another seller's) read into the canonical model. */
export type ListingForCopy = {
  listing: CanonicalListing;
  /** Seller of the source listing (to know whether picture ids can be reused). */
  sellerId: string | null;
  listingModel: ListingModel;
  /** Traditional listing with variations (not copied yet in 2D). */
  hasVariations: boolean;
  permalink: string | null;
  title: string;
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
  /** Ids of every listing of the seller (all statuses). */
  listListingIds(accessToken: string, externalUserId: string): Promise<string[]>;
  /** Reads listings by id (the connector batches the calls). */
  getListings(accessToken: string, externalIds: string[]): Promise<ListingFetchResult[]>;
  /** Sets the available quantity of a listing (not for Full / multi-origin). */
  setListingStock(accessToken: string, externalId: string, quantity: number): Promise<void>;

  // Orders (Phase 3)
  /** One order, fresh from the marketplace. */
  getOrder(accessToken: string, externalOrderId: string): Promise<MarketplaceOrder>;
  /** Orders of the seller changed in [from, to] (catch-up when notifications are missed). */
  searchOrdersUpdated(
    accessToken: string,
    externalUserId: string,
    from: Date,
    to: Date,
  ): Promise<MarketplaceOrder[]>;
  getShipment(accessToken: string, externalShipmentId: string): Promise<MarketplaceShipment>;

  // Copy / migrate / replicate (Phase 2D)
  getListingForCopy(accessToken: string, externalId: string): Promise<ListingForCopy>;

  // Creating listings (Phase 2C)
  suggestCategories(accessToken: string, query: string): Promise<CategorySuggestion[]>;
  uploadPicture(accessToken: string, file: Blob, filename: string): Promise<UploadedPicture>;
  quoteFees(
    accessToken: string,
    input: { categoryId: string; priceCents: number; listingTypeIds: string[] },
  ): Promise<FeeQuote[]>;
  /** Asks the marketplace to check a listing without publishing (throws MarketplaceValidationError). */
  validateListing(
    accessToken: string,
    listing: CanonicalListing,
    model: PublishModel,
  ): Promise<void>;
  /** Publishes a new listing (the description is sent afterwards with updateListingDescription). */
  publishListing(
    accessToken: string,
    listing: CanonicalListing,
    model: PublishModel,
  ): Promise<MarketplaceListing>;
  /** Null when the marketplace has no deadline for it (cancelled, Full...). */
  getShipmentSla(accessToken: string, externalShipmentId: string): Promise<ShipmentSla | null>;
  /** Labels of up to LABELS_PER_CALL shipments in one file. */
  getShippingLabels(
    accessToken: string,
    externalShipmentIds: string[],
    format: LabelFormat,
  ): Promise<LabelFile>;

  // Editing (Phase 2B)
  /** Technical sheet of a category, in the neutral shape. */
  getCategoryAttributes(accessToken: string, categoryId: string): Promise<AttributeDefinition[]>;
  /** Fresh copy of one listing for editing (incl. attribute values and description). */
  getListingForEdit(accessToken: string, externalId: string): Promise<EditableListing>;
  /** Sends only the fields present in `patch`. Warnings = parts the marketplace ignored. */
  updateListing(
    accessToken: string,
    externalId: string,
    patch: ListingPatch,
  ): Promise<{ warnings: string[] }>;
  /** Replaces (or creates, when `exists` is false) the plain-text description. */
  updateListingDescription(
    accessToken: string,
    externalId: string,
    text: string,
    exists: boolean,
  ): Promise<void>;
}

/** A listing as needed by the edit screen. */
export type EditableListing = {
  listing: MarketplaceListing;
  attributes: AttributeValue[];
  /** Plain text; null when the listing has no description yet. */
  description: string | null;
  /** Editing rules the marketplace imposes on this listing. */
  rules: {
    titleEditable: boolean;
    familyNameEditable: boolean;
    /** Why the title is locked (shown to the user). */
    titleLockReason: "user_products" | "has_sales" | null;
  };
};

/** Changes to send. Absent fields are not touched. */
export type ListingPatch = {
  title?: string;
  /** User Products: the title is generated from it. */
  familyName?: string;
  priceCents?: number;
  status?: "active" | "paused" | "closed";
  attributes?: AttributeValue[];
};

/** The marketplace refused the request with field-level reasons (shown to the user). */
export class MarketplaceValidationError extends Error {
  constructor(readonly causes: string[]) {
    super(`Marketplace refused the change: ${causes.join("; ")}`);
    this.name = "MarketplaceValidationError";
  }
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
