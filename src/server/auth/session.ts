import "server-only";

import { redirect } from "next/navigation";
import { connection } from "next/server";
import { cache } from "react";

import { can, type Permission, type Role } from "@/domain/auth/permissions";
import { ROUTES } from "@/lib/auth/routes";
import { db } from "@/server/db";
import { createSupabaseServerClient } from "@/server/supabase";

export type AuthUser = {
  id: string;
  email: string;
};

export type CurrentMember = {
  user: AuthUser;
  fullName: string;
  organizationId: string;
  organizationName: string;
  role: Role;
};

/**
 * The logged-in user, or null. Verifies the token signature (getClaims),
 * never trusts the cookie as-is. Deduplicated per request.
 */
export const getAuthUser = cache(async (): Promise<AuthUser | null> => {
  // Session checks are always request-time: getClaims() compares the token
  // expiry with the clock (Date.now), which Cache Components forbids while
  // prerendering. https://nextjs.org/docs/messages/blocking-prerender-current-time
  await connection();
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (error || !claims?.sub) return null;
  return { id: claims.sub, email: typeof claims.email === "string" ? claims.email : "" };
});

/** Logged-in user; redirects to login otherwise. */
export async function requireAuthUser(): Promise<AuthUser> {
  const user = await getAuthUser();
  if (!user) redirect(ROUTES.login);
  return user;
}

/**
 * Logged-in user with their organization. Use this in every internal page and
 * Server Action: it is the entry point of the data layer (filter by organizationId).
 * Users without an organization are sent to the "no access" page.
 */
export const requireMember = cache(async (): Promise<CurrentMember> => {
  const user = await requireAuthUser();
  // For now a user belongs to one organization (the first one created).
  // Switching between organizations comes with the SaaS phase.
  const membership = await db.membership.findFirst({
    where: { userId: user.id },
    orderBy: { createdAt: "asc" },
    include: { organization: true, user: true },
  });
  if (!membership) redirect(ROUTES.noAccess);
  return {
    user,
    fullName: membership.user.fullName,
    organizationId: membership.organizationId,
    organizationName: membership.organization.name,
    role: membership.role,
  };
});

/**
 * Logged-in member who has `permission`; otherwise sends them to the
 * "no permission" page. Use at the top of protected pages and Server Actions:
 *   const member = await requirePermission("listings.delete");
 */
export async function requirePermission(permission: Permission): Promise<CurrentMember> {
  const member = await requireMember();
  if (!can(member.role, permission)) redirect(ROUTES.forbidden);
  return member;
}
