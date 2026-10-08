import "server-only";

import { db } from "@/server/db";

import { provisionUser, type ProvisionUserInput, type ProvisioningStore } from "./provisioning";

/** provisionUser() backed by the real database (Prisma, one transaction). */
export function provisionUserInDatabase(input: ProvisionUserInput) {
  return provisionUser(input, (work) =>
    db.$transaction(async (tx) => {
      const store: ProvisioningStore = {
        async lockUser(userId) {
          // Transaction-scoped lock keyed by the user id; released on commit/rollback.
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${userId}))`;
        },
        async hasMembership(userId) {
          return (await tx.membership.count({ where: { userId } })) > 0;
        },
        async createOwnerAccount(account) {
          await tx.profile.upsert({
            where: { id: account.userId },
            create: {
              id: account.userId,
              fullName: account.fullName,
              phone: account.phone,
              termsAcceptedAt: account.termsAcceptedAt,
            },
            update: {},
          });
          await tx.organization.create({
            data: {
              name: account.organizationName,
              memberships: { create: { userId: account.userId, role: "owner" } },
            },
          });
        },
      };
      return work(store);
    }),
  );
}
