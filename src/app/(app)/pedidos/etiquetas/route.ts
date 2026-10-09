import { z } from "zod";

import { requirePermission } from "@/server/auth/session";
import { MAX_LABELS, printLabels } from "@/server/orders/labels";
import { getTenantContext } from "@/server/tenant/tenant-db";

// Downloads the shipping labels of the selected orders (form POST from
// /pedidos). Errors go back to the page with a message.

export const maxDuration = 60;

const inputSchema = z.object({
  orderIds: z.array(z.uuid()).min(1).max(500),
  format: z.enum(["pdf", "zpl"]),
  back: z.string().startsWith("/pedidos").max(500),
});

const MESSAGES = {
  none_printable:
    "Nenhum dos pedidos marcados pode ser impresso agora (só envios prontos para imprimir ou já impressos; Full não tem etiqueta).",
  many_accounts: "Marque pedidos de uma conta por vez (filtre pela conta).",
  too_many: `No máximo ${MAX_LABELS} etiquetas por vez.`,
  reconnect: "O Mercado Livre não aceita mais a autorização. Reconecte a conta.",
  marketplace_error: "O Mercado Livre não respondeu. Tente de novo em instantes.",
} as const;

function backWith(back: string, message: string) {
  const url = new URL(back, "http://local");
  url.searchParams.set("etiqueta-erro", message);
  return new Response(null, { status: 303, headers: { location: url.pathname + url.search } });
}

export async function POST(request: Request) {
  const member = await requirePermission("orders.fulfill");
  const form = await request.formData();
  const parsed = inputSchema.safeParse({
    orderIds: form.getAll("orderIds"),
    format: form.get("format"),
    back: form.get("back") ?? "/pedidos",
  });
  if (!parsed.success) return backWith("/pedidos", "Marque ao menos um pedido.");
  const { orderIds, format, back } = parsed.data;

  const { tdb } = await getTenantContext(member);
  const result = await printLabels(tdb, member.organizationId, orderIds, format);
  if (result.status === "refused") return backWith(back, result.message);
  if (result.status !== "ok") return backWith(back, MESSAGES[result.status]);

  const type = result.file.contentType;
  const extension = type.includes("pdf") ? "pdf" : type.includes("zip") ? "zip" : "txt";
  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "");
  return new Response(result.file.data, {
    headers: {
      "content-type": type,
      "content-disposition": `attachment; filename="etiquetas-${stamp}.${extension}"`,
      "cache-control": "no-store",
    },
  });
}
