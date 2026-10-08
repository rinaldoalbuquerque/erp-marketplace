import { z } from "zod";

/**
 * Data saved in Supabase Auth's user_metadata at sign-up (see the signup action).
 * It is validated again here because anyone holding the public key could call
 * Supabase directly and put anything in it.
 */
export const signupMetadataSchema = z.object({
  full_name: z.string().trim().min(2).max(120),
  phone: z.string().regex(/^\+55[1-9]{2}9\d{8}$/),
  terms_accepted_at: z.iso.datetime(),
});
export type SignupMetadata = z.infer<typeof signupMetadataSchema>;

export type OwnerAccountInput = {
  userId: string;
  fullName: string;
  phone: string;
  termsAcceptedAt: Date;
  organizationName: string;
};

/** Database operations needed by provisioning (Prisma implementation in provisioning-store.ts). */
export interface ProvisioningStore {
  /** Serializes provisioning per user (two clicks on the e-mail link at once). */
  lockUser(userId: string): Promise<void>;
  hasMembership(userId: string): Promise<boolean>;
  /** Creates profile + organization + owner membership. */
  createOwnerAccount(input: OwnerAccountInput): Promise<void>;
}

export type ProvisioningResult =
  "already_provisioned" | "created" | "signup_closed" | "invalid_metadata";

export type ProvisionUserInput = {
  userId: string;
  metadata: unknown;
  allowPublicSignup: boolean;
};

/**
 * Makes sure a confirmed user has a profile, an organization and an "owner"
 * membership. Idempotent: running it again never duplicates anything.
 * `runInTransaction` must run everything in one database transaction.
 */
export async function provisionUser(
  input: ProvisionUserInput,
  runInTransaction: <T>(work: (store: ProvisioningStore) => Promise<T>) => Promise<T>,
): Promise<ProvisioningResult> {
  return runInTransaction(async (store) => {
    await store.lockUser(input.userId);

    if (await store.hasMembership(input.userId)) return "already_provisioned";

    // Closed sign-up: users without an organization get no access
    // (invitations will create memberships for them later).
    if (!input.allowPublicSignup) return "signup_closed";

    const parsed = signupMetadataSchema.safeParse(input.metadata);
    if (!parsed.success) return "invalid_metadata";

    const { full_name, phone, terms_accepted_at } = parsed.data;
    await store.createOwnerAccount({
      userId: input.userId,
      fullName: full_name,
      phone,
      termsAcceptedAt: new Date(terms_accepted_at),
      organizationName: defaultOrganizationName(full_name),
    });
    return "created";
  });
}

/** "Maria Silva" -> "Empresa de Maria". The owner can rename it later. */
export function defaultOrganizationName(fullName: string): string {
  const firstName = fullName.trim().split(/\s+/)[0] ?? "";
  return firstName ? `Empresa de ${firstName}` : "Minha empresa";
}
