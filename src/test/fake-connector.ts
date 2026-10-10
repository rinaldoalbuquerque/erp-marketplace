import type { MarketplaceConnector } from "@/connectors/types";

const notUsed = (name: string) => async () => {
  throw new Error(`fake connector: ${name} not expected in this test`);
};

/**
 * Complete MarketplaceConnector for tests: every method throws unless the test
 * overrides it, so a test only spells out the calls it expects.
 */
export function fakeConnector(overrides: Partial<MarketplaceConnector> = {}): MarketplaceConnector {
  return {
    id: "mercadolivre",
    label: "Mercado Livre",
    buildAuthorizationUrl: () => "",
    exchangeCode: notUsed("exchangeCode"),
    refreshTokens: notUsed("refreshTokens"),
    getAccountProfile: notUsed("getAccountProfile"),
    listListingIds: notUsed("listListingIds"),
    getListings: notUsed("getListings"),
    setListingStock: notUsed("setListingStock"),
    getOrder: notUsed("getOrder"),
    searchOrdersUpdated: notUsed("searchOrdersUpdated"),
    getShipment: notUsed("getShipment"),
    getShipmentSla: notUsed("getShipmentSla"),
    getShippingLabels: notUsed("getShippingLabels"),
    getListingForCopy: notUsed("getListingForCopy"),
    resolveCatalogProduct: async () => null,
    suggestCategories: notUsed("suggestCategories"),
    uploadPicture: notUsed("uploadPicture"),
    quoteFees: notUsed("quoteFees"),
    validateListing: notUsed("validateListing"),
    publishListing: notUsed("publishListing"),
    getCategoryAttributes: notUsed("getCategoryAttributes"),
    getListingForEdit: notUsed("getListingForEdit"),
    updateListing: notUsed("updateListing"),
    updateListingDescription: notUsed("updateListingDescription"),
    ...overrides,
  };
}
