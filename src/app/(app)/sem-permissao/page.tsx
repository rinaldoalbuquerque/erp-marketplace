import type { Metadata } from "next";
import Link from "next/link";

import { ROUTES } from "@/lib/auth/routes";

export const metadata: Metadata = { title: "Sem permissão" };

/** Where requirePermission() sends members whose role doesn't allow an action. */
export default function ForbiddenPage() {
  return (
    <div className="flex max-w-lg flex-col gap-4">
      <h1 className="text-2xl font-semibold text-gray-900">Você não tem permissão para isso</h1>
      <p className="text-gray-700">
        Seu perfil de acesso não permite abrir esta página ou fazer esta ação. Se precisar, peça ao
        responsável pela empresa para ajustar seu perfil.
      </p>
      <Link href={ROUTES.home} className="text-blue-600 hover:underline">
        Voltar para o painel
      </Link>
    </div>
  );
}
