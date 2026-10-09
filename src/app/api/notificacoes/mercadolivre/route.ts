import { env } from "@/server/env";
import { notificationSchema, recordNotification } from "@/server/orders/order-sync";
import { processOrdersInBackground } from "@/server/orders/schedule";

// Mercado Livre notifications (callback URL registered in the ML application).
// Docs: https://developers.mercadolivre.com.br/pt_br/produto-receba-notificacoes
// ML wants HTTP 200 within 500 ms: record the notice, answer, and fetch the
// order afterwards (next/server `after`). No login here (excluded in proxy.ts):
// the body only says WHAT to fetch; data always comes from ML with our token.

export const maxDuration = 60;

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return new Response(null, { status: 200 }); // not from ML: nothing to retry
  }
  const parsed = notificationSchema.safeParse(body);
  const applicationId =
    body && typeof body === "object" && "application_id" in body
      ? String((body as { application_id: unknown }).application_id)
      : null;
  // Other applications' notices (or junk) are acknowledged and dropped.
  if (!parsed.success || (env.ML_CLIENT_ID && applicationId !== env.ML_CLIENT_ID)) {
    return new Response(null, { status: 200 });
  }

  // If the database is down this throws -> 500 -> ML retries for 1 hour.
  await recordNotification("mercadolivre", parsed.data);
  processOrdersInBackground(30_000);
  return new Response(null, { status: 200 });
}
