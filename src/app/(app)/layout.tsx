import { Suspense } from "react";

import { LogoutButton } from "@/components/auth/logout-button";
import { AppShell } from "@/components/layout/app-shell";
import { SideNav } from "@/components/layout/side-nav";
import { ROLE_LABELS } from "@/domain/auth/permissions";
import { navForRole } from "@/lib/navigation";
import { requireMember } from "@/server/auth/session";

/**
 * Layout of the internal (logged-in) area: side menu + top bar.
 * Parts that read the session sit inside <Suspense> (required by Cache Components),
 * so the frame shows instantly and the user-specific parts stream in.
 * Pages still call requireMember()/requirePermission() themselves.
 */
export default function AppLayout({ children }: LayoutProps<"/">) {
  return (
    <AppShell
      sidebar={
        <Suspense fallback={<NavSkeleton />}>
          <RoleNav />
        </Suspense>
      }
      header={
        <Suspense fallback={<span className="text-sm text-gray-400">Carregando…</span>}>
          <TopBar />
        </Suspense>
      }
    >
      {children}
    </AppShell>
  );
}

async function RoleNav() {
  const member = await requireMember();
  return <SideNav sections={navForRole(member.role)} />;
}

async function TopBar() {
  const member = await requireMember();
  return (
    <>
      <span className="truncate font-medium text-gray-900">{member.organizationName}</span>
      <div className="flex items-center gap-3 text-sm text-gray-700">
        <span className="hidden text-right sm:block">
          {member.fullName}
          <span className="block text-xs text-gray-500">{ROLE_LABELS[member.role]}</span>
        </span>
        <LogoutButton />
      </div>
    </>
  );
}

function NavSkeleton() {
  return (
    <div className="flex flex-col gap-2" aria-hidden="true">
      {Array.from({ length: 7 }, (_, index) => (
        <div key={index} className="h-8 animate-pulse rounded-md bg-gray-100" />
      ))}
    </div>
  );
}
