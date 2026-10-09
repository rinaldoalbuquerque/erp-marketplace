"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requirePermission } from "@/server/auth/session";
import {
  checkInvoiceReadiness,
  issueInvoices,
  type IssueOutcome,
  type ReadinessRow,
} from "@/server/fiscal/invoice-service";

const idsSchema = z.array(z.uuid()).min(1).max(50);

export type CheckResult = { ok: true; rows: ReadinessRow[] } | { ok: false; message: string };

/** Step 1 (read only): can the listings of these orders be invoiced? */
export async function checkInvoicesAction(orderIds: string[]): Promise<CheckResult> {
  const member = await requirePermission("invoices.issue");
  const parsed = idsSchema.safeParse(orderIds);
  if (!parsed.success) return { ok: false, message: "Marque de 1 a 50 pedidos." };
  const rows = await checkInvoiceReadiness(member.organizationId, parsed.data);
  if (rows === "reconnect") {
    return {
      ok: false,
      message: "O Mercado Livre não aceita mais a autorização. Reconecte a conta.",
    };
  }
  return { ok: true, rows };
}

export type IssueActionResult =
  { ok: true; outcomes: IssueOutcome[] } | { ok: false; message: string };

const ISSUE_MESSAGES = {
  reconnect: "O Mercado Livre não aceita mais a autorização. Reconecte a conta.",
  not_found: "Pedidos não encontrados.",
  many_accounts: "Marque pedidos de uma conta por vez (filtre pela conta).",
} as const;

/** Step 2: issues the invoices (one per cart). Called only after the user confirms. */
export async function issueInvoicesAction(orderIds: string[]): Promise<IssueActionResult> {
  const member = await requirePermission("invoices.issue");
  const parsed = idsSchema.safeParse(orderIds);
  if (!parsed.success) return { ok: false, message: "Marque de 1 a 50 pedidos." };
  try {
    const result = await issueInvoices(member.organizationId, member.user.id, parsed.data);
    revalidatePath("/pedidos");
    if (result.status !== "done") return { ok: false, message: ISSUE_MESSAGES[result.status] };
    return { ok: true, outcomes: result.outcomes };
  } catch (error) {
    console.error("Invoice issue failed", {
      error: error instanceof Error ? error.message : "unknown",
    });
    return {
      ok: false,
      message:
        "Erro inesperado ao emitir. Confira no painel do Mercado Livre se a nota saiu antes de tentar de novo.",
    };
  }
}
