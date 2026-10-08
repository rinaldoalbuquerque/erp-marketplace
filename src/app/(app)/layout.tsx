import { Suspense } from "react";

import { LogoutButton } from "@/components/auth/logout-button";
import { requireMember } from "@/server/auth/session";

/**
 * Layout of the internal (logged-in) area. Temporary header: the real layout
 * and side menu are the next task in PLANO.md.
 * The session is read inside <Suspense> (required by Cache Components).
 */
export default function AppLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="flex min-h-screen flex-col bg-gray-50">
      <header className="flex items-center justify-between border-b border-gray-200 bg-white px-6 py-3">
        <span className="font-semibold text-gray-900">ERP Marketplace</span>
        <Suspense fallback={null}>
          <UserMenu />
        </Suspense>
      </header>
      <main className="flex-1 p-6">{children}</main>
    </div>
  );
}

async function UserMenu() {
  const member = await requireMember();
  return (
    <div className="flex items-center gap-4 text-sm text-gray-700">
      <span>
        {member.fullName} · {member.organizationName}
      </span>
      <LogoutButton />
    </div>
  );
}
