import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { GENERIC_ERROR, LINK_INVALID } from "@/lib/auth/error-messages";
import { ROUTES } from "@/lib/auth/routes";

import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Entrar" };

/** Messages shown when another page sends the user here (?erro=...). */
const NOTICES: Record<string, string> = {
  "link-invalido": LINK_INVALID,
  "tente-novamente": GENERIC_ERROR,
  // Confirmation link opened in another browser (PKCE): logging in finishes the setup.
  "entre-para-continuar":
    "Se você acabou de confirmar seu e-mail, entre com seu e-mail e senha para continuar.",
};

export default function LoginPage({ searchParams }: PageProps<"/entrar">) {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold text-ink">Entrar</h1>
      <Suspense fallback={<p className="text-sm text-muted">Carregando…</p>}>
        <LoginContent searchParams={searchParams} />
      </Suspense>
      <div className="flex flex-col gap-1 text-center text-sm text-muted">
        <Link href={ROUTES.forgotPassword} className="text-brand hover:underline">
          Esqueci minha senha
        </Link>
        <p>
          Não tem conta?{" "}
          <Link href={ROUTES.signup} className="text-brand hover:underline">
            Criar conta
          </Link>
        </p>
      </div>
    </div>
  );
}

async function LoginContent({ searchParams }: Pick<PageProps<"/entrar">, "searchParams">) {
  const params = await searchParams;
  const erro = typeof params.erro === "string" ? params.erro : undefined;
  const next = typeof params.next === "string" ? params.next : undefined;
  return <LoginForm next={next} notice={erro ? NOTICES[erro] : undefined} />;
}
