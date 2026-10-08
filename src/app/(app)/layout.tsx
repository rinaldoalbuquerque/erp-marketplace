import { Suspense } from "react";

import { LogoutButton } from "@/components/auth/logout-button";
import { AppShell } from "@/components/layout/app-shell";
import { SideNav } from "@/components/layout/side-nav";
import { ThemeToggle } from "@/components/theme-toggle";
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
        <>
          <Suspense fallback={<span className="h-5 w-40 animate-pulse rounded bg-surface-2" />}>
            <OrganizationName />
          </Suspense>
          <div className="flex items-center gap-3">
            <ThemeToggle />
            <Suspense fallback={null}>
              <UserBox />
            </Suspense>
          </div>
        </>
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

async function OrganizationName() {
  const member = await requireMember();
  return (
    <span className="truncate font-display text-lg font-semibold text-ink">
      {member.organizationName}
    </span>
  );
}

function initials(fullName: string) {
  const parts = fullName.trim().split(/\s+/);
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";
  return (first + last).toUpperCase();
}

async function UserBox() {
  const member = await requireMember();
  return (
    <div className="flex items-center gap-3">
      <div className="hidden items-center gap-2.5 sm:flex">
        <span
          className="flex size-9 items-center justify-center rounded-full bg-brand font-display text-sm font-semibold text-on-brand"
          aria-hidden="true"
        >
          {initials(member.fullName)}
        </span>
        <span className="text-sm leading-tight">
          <span className="block font-medium text-ink">{member.fullName}</span>
          <span className="block text-xs text-muted">{ROLE_LABELS[member.role]}</span>
        </span>
      </div>
      <LogoutButton />
    </div>
  );
}

function NavSkeleton() {
  return (
    <div className="flex flex-col gap-1.5" aria-hidden="true">
      {Array.from({ length: 7 }, (_, index) => (
        <div key={index} className="h-9 animate-pulse rounded-lg bg-sidebar-hover" />
      ))}
    </div>
  );
}
