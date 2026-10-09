import type { ItemStockStatus } from "./stock-rules";

// Texts for order screens (pt-BR). ML order statuses:
// https://developers.mercadolivre.com.br/pt_br/gerenciamento-de-vendas ("Status da order").

const ORDER_STATUS_LABELS: Record<string, string> = {
  confirmed: "Confirmado",
  payment_required: "Aguardando pagamento",
  payment_in_process: "Pagamento em análise",
  partially_paid: "Pago em parte",
  paid: "Pago",
  partially_refunded: "Devolvido em parte",
  pending_cancel: "Cancelando",
  cancelled: "Cancelado",
  invalid: "Inválido",
};

export function orderStatusLabel(status: string): string {
  return ORDER_STATUS_LABELS[status] ?? status;
}

export const ITEM_STOCK_LABELS: Record<ItemStockStatus, string> = {
  waiting: "Aguardando confirmação",
  deducted: "Estoque baixado",
  restored: "Estoque devolvido",
  not_applicable: "Não baixa estoque",
  missing_sku: "Sem SKU vinculado",
};
