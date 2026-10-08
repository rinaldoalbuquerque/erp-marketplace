import type { Metadata } from "next";

export const metadata: Metadata = { title: "Termos de Uso" };

// TODO: replace with the final text provided by the owner.
export default function TermsPage() {
  return (
    <article className="flex flex-col gap-3 text-sm text-ink">
      <h1 className="text-2xl font-semibold text-ink">Termos de Uso</h1>
      <p className="rounded-md bg-signal-soft px-3 py-2 text-signal-ink">
        Texto provisório: os Termos de Uso definitivos ainda serão publicados.
      </p>
      <p>
        Ao criar uma conta, você concorda em usar o sistema de forma lícita, manter suas credenciais
        em sigilo e respeitar as regras dos marketplaces conectados.
      </p>
    </article>
  );
}
