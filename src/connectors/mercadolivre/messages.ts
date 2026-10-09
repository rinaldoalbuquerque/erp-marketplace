// Portuguese text for Mercado Livre messages seen in practice. Unknown messages
// are shown as they come.

const KNOWN: Array<[RegExp, string]> = [
  // Seen on 2026-10-09 on every item update of the test account.
  [/user has not mode me1/i, "A conta não tem o Mercado Envios 1 (ME1) ativado."],
  [
    /free shipping costs exceeds sale/i,
    "O custo do frete grátis é maior que o preço de venda do anúncio.",
  ],
];

export function translateMlMessage(message: string): string {
  const known = KNOWN.find(([pattern]) => pattern.test(message));
  return known ? `${known[1]} (${message})` : message;
}
