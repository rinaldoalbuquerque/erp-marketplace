import { z } from "zod";

import { requirePermission } from "@/server/auth/session";
import { getFiscalProvider } from "@/server/fiscal/invoice-service";
import { getAccessToken, ReconnectRequiredError } from "@/server/marketplaces/token-service";
import { getTenantContext } from "@/server/tenant/tenant-db";

// Downloads the DANFE (PDF) or the XML of an invoice, through the provider.

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ invoiceId: string; tipo: string }> },
) {
  const member = await requirePermission("orders.view");
  const { invoiceId, tipo } = await params;
  if (!z.uuid().safeParse(invoiceId).success || (tipo !== "danfe" && tipo !== "xml")) {
    return new Response("Not found", { status: 404 });
  }
  const { tdb } = await getTenantContext(member);
  const invoice = await tdb.invoice.findFirst({
    where: { id: invoiceId },
    select: {
      number: true,
      danfePath: true,
      xmlPath: true,
      marketplaceAccountId: true,
      account: { select: { marketplace: true, externalUserId: true } },
    },
  });
  const path = tipo === "danfe" ? invoice?.danfePath : invoice?.xmlPath;
  if (!invoice || !path) return new Response("Not found", { status: 404 });

  let token: string;
  try {
    token = await getAccessToken(member.organizationId, invoice.marketplaceAccountId);
  } catch (error) {
    if (error instanceof ReconnectRequiredError) {
      return new Response("Reconecte a conta do Mercado Livre.", { status: 409 });
    }
    throw error;
  }
  const file = await getFiscalProvider(invoice.account.marketplace).download(
    { accessToken: token, sellerId: invoice.account.externalUserId },
    path,
  );
  const extension = tipo === "danfe" ? "pdf" : "xml";
  return new Response(file.data, {
    headers: {
      "content-type": file.contentType,
      "content-disposition": `attachment; filename="nf-${invoice.number ?? "sem-numero"}.${extension}"`,
      "cache-control": "no-store",
    },
  });
}
