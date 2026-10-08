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
      <h1 className="text-lg font-semibold text-gray-900">Criar conta</h1>
      <Suspense fallback={<p className="text-sm text-gray-500">Carregando…</p>}>
        <SignupGate />
      </Suspense>
      <p className="text-center text-sm text-gray-600">
        Já tem conta?{" "}
        <Link href={ROUTES.login} className="text-blue-600 hover:underline">
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
    return (
      <p className="rounded-md bg-gray-100 px-3 py-2 text-sm text-gray-700">{SIGNUP_CLOSED}</p>
    );
  }
  return <SignupForm />;
}
