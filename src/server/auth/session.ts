import "server-only";

import { redirect } from "next/navigation";
import { cache } from "react";

import { ROUTES } from "@/lib/auth/routes";
import { db } from "@/server/db";
import { createSupabaseServerClient } from "@/server/supabase";

import type { MembershipRole } from "@/generated/prisma/client";

export type AuthUser = {
  id: string;
  email: string;
};

export type CurrentMember = {
  user: AuthUser;
  fullName: string;
  organizationId: string;
  organizationName: string;
  role: MembershipRole;
};

/**
 * The logged-in user, or null. Verifies the token signature (getClaims),
 * never trusts the cookie as-is. Deduplicated per request.
 */
export const getAuthUser = cache(async (): Promise<AuthUser | null> => {
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
