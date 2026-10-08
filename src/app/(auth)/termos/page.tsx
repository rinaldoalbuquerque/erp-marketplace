import type { Metadata } from "next";

export const metadata: Metadata = { title: "Termos de Uso" };

// TODO: replace with the final text provided by the owner.
export default function TermsPage() {
  return (
    <article className="flex flex-col gap-3 text-sm text-gray-700">
      <h1 className="text-lg font-semibold text-gray-900">Termos de Uso</h1>
      <p className="rounded-md bg-yellow-50 px-3 py-2 text-yellow-800">
        Texto provisório: os Termos de Uso definitivos ainda serão publicados.
      </p>
      <p>
        Ao criar uma conta, você concorda em usar o sistema de forma lícita, manter suas credenciais
        em sigilo e respeitar as regras dos marketplaces conectados.
      </p>
    </article>
  );
}
