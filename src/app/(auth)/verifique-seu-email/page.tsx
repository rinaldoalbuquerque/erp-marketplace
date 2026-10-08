import type { Metadata } from "next";
import Link from "next/link";

import { ROUTES } from "@/lib/auth/routes";

import { ResendConfirmationForm } from "./resend-form";

export const metadata: Metadata = { title: "Confirme seu e-mail" };

export default function CheckEmailPage() {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold text-gray-900">Confirme seu e-mail</h1>
      <p className="text-sm text-gray-700">
        Enviamos um link de confirmação para o seu e-mail. Abra o link para ativar a conta. Depois
        disso você já pode entrar.
      </p>
      <p className="text-sm text-gray-700">
        Não recebeu? Confira a caixa de spam ou peça um novo link:
      </p>
      <ResendConfirmationForm />
      <p className="text-center text-sm text-gray-600">
        <Link href={ROUTES.login} className="text-blue-600 hover:underline">
          Voltar para o login
        </Link>
      </p>
    </div>
  );
}
