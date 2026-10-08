import type { Metadata } from "next";

import { LogoutButton } from "@/components/auth/logout-button";

export const metadata: Metadata = { title: "Sem acesso" };

/** Logged-in users without an organization (sign-up closed, no invitation yet). */
export default function NoAccessPage() {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold text-ink">Sua conta ainda não tem acesso</h1>
      <p className="text-sm text-ink">
        Seu e-mail foi confirmado, mas sua conta não está vinculada a nenhuma empresa. O acesso é
        liberado por convite: fale com o responsável pelo sistema.
      </p>
      <LogoutButton />
    </div>
  );
}
