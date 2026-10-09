import type { FiscalProvider } from "@/fiscal/types";

const notUsed = (name: string) => async () => {
  throw new Error(`fake fiscal provider: ${name} not expected in this test`);
};

/**
 * Complete FiscalProvider for tests. By default no order has an invoice and
 * everything else throws, so a test only spells out the calls it expects.
 */
export function fakeFiscalProvider(overrides: Partial<FiscalProvider> = {}): FiscalProvider {
  return {
    id: "mercadolivre",
    findInvoiceForOrder: async () => null,
    issueForOrders: notUsed("issueForOrders"),
    checkListing: notUsed("checkListing"),
    download: notUsed("download"),
    ...overrides,
  };
}
