// Fiscal layer (CLAUDE.md: FiscalProvider). The rest of the ERP only talks to
// this interface; implementations: Mercado Livre's issuer (Faturador) now, XML
// import (plan B) and an own issuer later. Invoices are stored in `invoices`,
// whoever issued them.

/** Who is calling: the seller account at the provider and a valid access token. */
export type FiscalContext = { accessToken: string; sellerId: string };

/** A sale invoice (NF-e) in a provider-neutral shape. */
export type InvoiceDocument = {
  externalId: string;
  /** Provider status, e.g. "authorized" */
  status: string;
  number: number | null;
  series: string | null;
  /** 44-digit access key */
  accessKey: string | null;
  amountCents: number | null;
  issuedAt: Date | null;
  /** Provider paths to download the DANFE (PDF) and the XML */
  danfePath: string | null;
  xmlPath: string | null;
  raw: unknown;
};

/** The provider refused to issue (readable reason for the user). */
export class InvoiceRefusedError extends Error {
  constructor(
    readonly code: string | null,
    readonly reason: string,
  ) {
    super(`Invoice refused: ${reason}`);
    this.name = "InvoiceRefusedError";
  }
}

export type InvoiceReadiness = { ok: boolean; restrictions: string[] };

export type FiscalFile = { contentType: string; data: ArrayBuffer };

export interface FiscalProvider {
  readonly id: "mercadolivre";
  /** Invoice of an order (also those issued outside the ERP); null when there is none. */
  findInvoiceForOrder(ctx: FiscalContext, externalOrderId: string): Promise<InvoiceDocument | null>;
  /** Issues ONE invoice for the given orders (a cart goes complete, in one call). */
  issueForOrders(ctx: FiscalContext, externalOrderIds: string[]): Promise<InvoiceDocument>;
  /** Whether a listing has the fiscal data the provider needs. */
  checkListing(
    ctx: FiscalContext,
    externalItemId: string,
    variationId?: string | null,
  ): Promise<InvoiceReadiness>;
  /** Downloads the DANFE (PDF) or the XML of an invoice. */
  download(ctx: FiscalContext, path: string): Promise<FiscalFile>;
}
