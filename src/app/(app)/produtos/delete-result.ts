import type { DeleteProductsResult } from "@/server/products/delete-service";

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/** Query string with the result, shown as a notice on the product list. */
export function resultQuery(result: DeleteProductsResult) {
  return `excluidos=${result.deleted}&arquivados=${result.archived}&desvinculados=${result.unlinkedListings}&falhas=${result.failed}`;
}

/** Reads the result back from the list page query (null when there is none). */
export function resultFromQuery(
  params: Record<string, string | string[] | undefined>,
): DeleteProductsResult | null {
  const number = (key: string) => {
    const value = params[key];
    return typeof value === "string" && /^\d{1,4}$/.test(value) ? Number(value) : 0;
  };
  if (params.excluidos === undefined && params.arquivados === undefined) return null;
  return {
    deleted: number("excluidos"),
    archived: number("arquivados"),
    unlinkedListings: number("desvinculados"),
    failed: number("falhas"),
  };
}

/** Text of a delete result. */
export function resultText(result: DeleteProductsResult): string {
  const parts: string[] = [];
  if (result.deleted) {
    parts.push(`${plural(result.deleted, "produto excluído", "produtos excluídos")}.`);
  }
  if (result.archived) {
    parts.push(
      result.archived === 1
        ? "1 produto arquivado em vez de excluído: tem vendas ou movimentações de estoque, que precisam continuar no histórico."
        : `${result.archived} produtos arquivados em vez de excluídos: têm vendas ou movimentações de estoque, que precisam continuar no histórico.`,
    );
  }
  if (result.unlinkedListings) {
    parts.push(
      `${plural(result.unlinkedListings, "anúncio ficou", "anúncios ficaram")} sem SKU (continua${result.unlinkedListings === 1 ? "" : "m"} no Mercado Livre).`,
    );
  }
  if (result.failed) {
    parts.push(
      result.failed === 1
        ? "1 produto não pôde ser excluído agora; tente de novo."
        : `${result.failed} produtos não puderam ser excluídos agora; tente de novo.`,
    );
  }
  return parts.join(" ") || "Nada foi excluído.";
}
