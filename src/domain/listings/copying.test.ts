import { describe, expect, it } from "vitest";

import { adjustPrice, parseListingRef } from "@/domain/listings/copying";

describe("parseListingRef", () => {
  it("accepts ids and listing links", () => {
    expect(parseListingRef("MLB4932931475")).toBe("MLB4932931475");
    expect(parseListingRef(" mlb-4932931475 ")).toBe("MLB4932931475");
    expect(
      parseListingRef(
        "https://produto.mercadolivre.com.br/MLB-4932931475-borracha-vedaco-panela-_JM#position=1",
      ),
    ).toBe("MLB4932931475");
    expect(parseListingRef("https://www.mercadolivre.com.br/p/MLB12345678")).toBe("MLB12345678");
  });

  it("rejects text without a listing id", () => {
    expect(parseListingRef("borracha panela")).toBeNull();
    expect(parseListingRef("MLB12")).toBeNull();
  });
});

describe("adjustPrice", () => {
  it("applies a percentage", () => {
    expect(adjustPrice(2990, { percent: 10, roundTo90: false })).toBe(3289);
    expect(adjustPrice(2990, { percent: -5, roundTo90: false })).toBe(2841);
    expect(adjustPrice(2990, { percent: 0, roundTo90: false })).toBe(2990);
  });

  it("rounds to the nearest ,90", () => {
    expect(adjustPrice(3289, { percent: 0, roundTo90: true })).toBe(3290);
    expect(adjustPrice(3247, { percent: 0, roundTo90: true })).toBe(3290);
    expect(adjustPrice(3305, { percent: 0, roundTo90: true })).toBe(3290);
    expect(adjustPrice(3345, { percent: 0, roundTo90: true })).toBe(3390);
  });

  it("never goes below R$ 1,00", () => {
    expect(adjustPrice(50, { percent: -90, roundTo90: true })).toBe(100);
  });
});
