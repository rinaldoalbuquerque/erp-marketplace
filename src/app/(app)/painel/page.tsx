import type { Metadata } from "next";
import { Suspense } from "react";

import { requireMember } from "@/server/auth/session";

export const metadata: Metadata = { title: "Painel" };

export default function DashboardPage({ searchParams }: PageProps<"/painel">) {
  return (
    <Suspense fallback={<p className="text-sm text-muted">Carregando…</p>}>
      <Dashboard searchParams={searchParams} />
    </Suspense>
  );
}

async function Dashboard({ searchParams }: Pick<PageProps<"/painel">, "searchParams">) {
  // Every internal page starts with requireMember(): login + organization check.
  const member = await requireMember();
  const params = await searchParams;
  const notice =
    params["senha-alterada"] === "1"
      ? "Senha alterada com sucesso."
      : params["bem-vindo"] === "1"
        ? "E-mail confirmado. Sua conta está pronta!"
        : null;

  return (
    <div className="flex flex-col gap-4">
      {notice ? (
        <p role="status" className="rounded-md bg-success-soft px-3 py-2 text-sm text-success">
          {notice}
        </p>
      ) : null}
      <h1 className="text-2xl font-semibold text-ink">Olá, {member.fullName.split(" ")[0]}!</h1>
      <p className="text-ink">
        Você está em <strong>{member.organizationName}</strong>. Os módulos do ERP aparecerão aqui.
      </p>
    </div>
  );
}
