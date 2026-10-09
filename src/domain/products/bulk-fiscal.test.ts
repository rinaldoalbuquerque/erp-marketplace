import { describe, expect, it } from "vitest";

import { bulkFiscalSchema, describePatch } from "@/domain/products/bulk-fiscal";
import { fieldErrors } from "@/lib/auth/schemas";

describe("bulkFiscalSchema", () => {
  it("keeps only the filled fields", () => {
    expect(
      bulkFiscalSchema.parse({
        ncm: "7013.37.00",
        origin: "",
        cest: "",
        unit: "",
        defaultCfop: "",
      }),
    ).toEqual({
      ncm: "70133700",
    });
    expect(bulkFiscalSchema.parse({ origin: "0" })).toEqual({ origin: 0 });
  });

  it("parses every field", () => {
    expect(
      bulkFiscalSchema.parse({
        ncm: "70133700",
        cest: "28.038.00",
        origin: "2",
        unit: "CX",
        defaultCfop: "5102",
      }),
    ).toEqual({ ncm: "70133700", cest: "2803800", origin: 2, unit: "CX", defaultCfop: "5102" });
  });

  it("refuses an empty form", () => {
    const result = bulkFiscalSchema.safeParse({ ncm: "", origin: "" });
    expect(result.success).toBe(false);
    if (!result.success) expect(fieldErrors(result.error).form).toMatch(/pelo menos um campo/);
  });

  it.each([
    ["ncm", { ncm: "7013" }],
    ["cest", { cest: "123" }],
    ["origin", { origin: "9" }],
    ["unit", { unit: "XYZ" }],
    ["defaultCfop", { defaultCfop: "4102" }],
  ])("refuses an invalid %s", (field, input) => {
    const result = bulkFiscalSchema.safeParse(input);
    expect(result.success).toBe(false);
    if (!result.success) expect(fieldErrors(result.error)[field]).toBeTruthy();
  });
});

describe("describePatch", () => {
  it("describes the change for the confirmation", () => {
    expect(describePatch({ ncm: "70133700", origin: 0 })).toBe("NCM 70133700, origem 0");
  });
});
