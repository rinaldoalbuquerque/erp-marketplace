import { describe, expect, it } from "vitest";

import { listingWhere } from "@/server/listings/queries";

describe("listingWhere", () => {
  it("only hides listings removed from the system by default", () => {
    expect(listingWhere({})).toEqual({ removedAt: null });
  });

  it("filters by accounts, status and family", () => {
    expect(listingWhere({ accountIds: ["a", "b"], status: "pausado", familyId: "F1" })).toEqual({
      removedAt: null,
      marketplaceAccountId: { in: ["a", "b"] },
      status: "paused",
      familyId: "F1",
    });
  });

  it("'sem estoque' filters by quantity, not status", () => {
    expect(listingWhere({ status: "sem-estoque" })).toEqual({
      removedAt: null,
      availableQuantity: 0,
    });
  });

  it("only unmapped listings", () => {
    expect(listingWhere({ unmapped: true })).toEqual({ removedAt: null, mappings: { none: {} } });
  });

  it("searches title, SKU, family and the MLB id (normalized)", () => {
    const where = listingWhere({ search: "mlb-123" });
    expect(where.OR).toContainEqual({ externalId: { contains: "MLB123" } });
    expect(where.OR).toContainEqual({ title: { contains: "mlb-123", mode: "insensitive" } });
  });

  it("never adds an empty id filter that would match everything", () => {
    const where = listingWhere({ search: "ç" });
    expect(where.OR).not.toContainEqual({ externalId: { contains: "" } });
  });

  it("ignores a blank search", () => {
    expect(listingWhere({ search: "   " })).toEqual({ removedAt: null });
  });
});
