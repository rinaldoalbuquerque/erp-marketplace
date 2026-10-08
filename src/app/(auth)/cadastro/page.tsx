import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";

import { SIGNUP_CLOSED } from "@/lib/auth/error-messages";
import { ROUTES } from "@/lib/auth/routes";
import { env } from "@/server/env";

import { SignupForm } from "./signup-form";

export const metadata: Metadata = { title: "Criar conta" };

export default function SignupPage() {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold text-ink">Criar conta</h1>
      <Suspense fallback={<p className="text-sm text-muted">Carregando…</p>}>
        <SignupGate />
      </Suspense>
      <p className="text-center text-sm text-muted">
        Já tem conta?{" "}
        <Link href={ROUTES.login} className="text-brand hover:underline">
          Entrar
        </Link>
      </p>
    </div>
  );
}

/** Reads ALLOW_PUBLIC_SIGNUP at request time (not baked in at build time). */
async function SignupGate() {
  await connection();
  if (!env.ALLOW_PUBLIC_SIGNUP) {
    return <p className="rounded-md bg-surface-2 px-3 py-2 text-sm text-ink">{SIGNUP_CLOSED}</p>;
  }
  return <SignupForm />;
}
