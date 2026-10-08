// UI labels for listing statuses (marketplace raw values -> Portuguese).

export type StatusTone = "success" | "muted" | "signal" | "danger";

const STATUS: Record<string, { label: string; tone: StatusTone }> = {
  active: { label: "Ativo", tone: "success" },
  paused: { label: "Pausado", tone: "muted" },
  closed: { label: "Finalizado", tone: "muted" },
  under_review: { label: "Em revisão", tone: "signal" },
  inactive: { label: "Inativo", tone: "muted" },
  payment_required: { label: "Pagamento pendente", tone: "signal" },
  not_yet_active: { label: "Ainda não ativo", tone: "muted" },
};

export function listingStatusLabel(status: string): { label: string; tone: StatusTone } {
  return STATUS[status] ?? { label: status, tone: "muted" };
}

export const LISTING_MODEL_SHORT = {
  traditional: "Tradicional",
  user_products: "UP",
  unknown: "—",
} as const;
