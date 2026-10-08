import { describe, expect, it } from "vitest";

import {
  defaultOrganizationName,
  provisionUser,
  type OwnerAccountInput,
  type ProvisioningStore,
} from "@/server/auth/provisioning";

/** In-memory fake of the database, with transaction-like rollback on error. */
function createFakeDatabase() {
  const accounts: OwnerAccountInput[] = [];
  const locks: string[] = [];

  const run = async <T>(work: (store: ProvisioningStore) => Promise<T>): Promise<T> => {
    const snapshot = accounts.length;
    const store: ProvisioningStore = {
      async lockUser(userId) {
        locks.push(userId);
      },
      async hasMembership(userId) {
        return accounts.some((account) => account.userId === userId);
      },
      async createOwnerAccount(input) {
        accounts.push(input);
      },
    };
    try {
      return await work(store);
    } catch (error) {
      accounts.length = snapshot;
      throw error;
    }
  };

  return { accounts, locks, run };
}

const userId = "8b0f3f8e-1d7c-4b8a-9a52-1b0c7c1a2f10";
const metadata = {
  full_name: "Maria Silva",
  phone: "+5511987654321",
  terms_accepted_at: "2026-10-07T12:00:00.000Z",
};

describe("provisionUser", () => {
  it("creates profile, organization and owner membership on first confirmation", async () => {
    const fake = createFakeDatabase();
    const result = await provisionUser({ userId, metadata, allowPublicSignup: true }, fake.run);

    expect(result).toBe("created");
    expect(fake.accounts).toEqual([
      {
        userId,
        fullName: "Maria Silva",
        phone: "+5511987654321",
        termsAcceptedAt: new Date("2026-10-07T12:00:00.000Z"),
        organizationName: "Empresa de Maria",
      },
    ]);
    expect(fake.locks).toEqual([userId]);
  });

  it("is idempotent: a second run does not duplicate anything", async () => {
    const fake = createFakeDatabase();
    await provisionUser({ userId, metadata, allowPublicSignup: true }, fake.run);
    const second = await provisionUser({ userId, metadata, allowPublicSignup: true }, fake.run);

    expect(second).toBe("already_provisioned");
    expect(fake.accounts).toHaveLength(1);
  });

  it("keeps existing members working after sign-up is closed", async () => {
    const fake = createFakeDatabase();
    await provisionUser({ userId, metadata, allowPublicSignup: true }, fake.run);
    const result = await provisionUser({ userId, metadata, allowPublicSignup: false }, fake.run);
    expect(result).toBe("already_provisioned");
  });

  it("creates nothing when public sign-up is closed", async () => {
    const fake = createFakeDatabase();
    const result = await provisionUser({ userId, metadata, allowPublicSignup: false }, fake.run);

    expect(result).toBe("signup_closed");
    expect(fake.accounts).toHaveLength(0);
  });

  it.each([
    ["missing metadata", undefined],
    ["empty object", {}],
    ["invalid phone", { ...metadata, phone: "11987654321" }],
    ["missing terms date", { ...metadata, terms_accepted_at: undefined }],
    ["blank name", { ...metadata, full_name: " " }],
  ])("rejects tampered or incomplete metadata (%s)", async (_label, badMetadata) => {
    const fake = createFakeDatabase();
    const result = await provisionUser(
      { userId, metadata: badMetadata, allowPublicSignup: true },
      fake.run,
    );

    expect(result).toBe("invalid_metadata");
    expect(fake.accounts).toHaveLength(0);
  });
});

describe("defaultOrganizationName", () => {
  it.each([
    ["Maria Silva", "Empresa de Maria"],
    ["  João  ", "Empresa de João"],
    ["", "Minha empresa"],
  ])("%j -> %j", (name, expected) => {
    expect(defaultOrganizationName(name)).toBe(expected);
  });
});
