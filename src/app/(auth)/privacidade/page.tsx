import type { Metadata } from "next";

export const metadata: Metadata = { title: "Política de Privacidade" };

// TODO: replace with the final text provided by the owner (LGPD review in the SaaS phase).
export default function PrivacyPage() {
  return (
    <article className="flex flex-col gap-3 text-sm text-gray-700">
      <h1 className="text-lg font-semibold text-gray-900">Política de Privacidade</h1>
      <p className="rounded-md bg-yellow-50 px-3 py-2 text-yellow-800">
        Texto provisório: a Política de Privacidade definitiva ainda será publicada.
      </p>
      <p>
        Coletamos nome, e-mail e celular para criar e proteger sua conta. Esses dados não são
        vendidos nem compartilhados para fins de marketing.
      </p>
    </article>
  );
}
