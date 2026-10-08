import type { Metadata } from "next";
import Link from "next/link";

import { ROUTES } from "@/lib/auth/routes";

import { ForgotPasswordForm } from "./forgot-password-form";

export const metadata: Metadata = { title: "Esqueci minha senha" };

export default function ForgotPasswordPage() {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold text-ink">Esqueci minha senha</h1>
      <p className="text-sm text-ink">
        Informe seu e-mail. Se houver uma conta, enviaremos um link para você criar uma nova senha.
      </p>
      <ForgotPasswordForm />
      <p className="text-center text-sm text-muted">
        <Link href={ROUTES.login} className="text-brand hover:underline">
          Voltar para o login
        </Link>
      </p>
    </div>
  );
}
