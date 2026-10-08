import { describe, expect, it } from "vitest";

import { isValidCfop, missingFiscalFields, onlyDigits, ORIGINS } from "@/domain/products/fiscal";
import { isValidGtin } from "@/domain/products/gtin";
import { centsToInput, formatCents, parseBrlToCents } from "@/domain/products/money";
import {
  normalizeSkuCode,
  productSchema,
  skuSchema,
  variationLabel,
} from "@/domain/products/schemas";
import { fieldErrors } from "@/lib/auth/schemas";

describe("isValidGtin", () => {
  it.each(["73513537", "036000291452", "4006381333931", "00012345600012"])("accepts %s", (code) => {
    expect(isValidGtin(code)).toBe(true);
  });

  it.each(["4006381333932", "1234567", "400638133393A", "123456789012345", ""])(
    "rejects %s",
    (code) => {
      expect(isValidGtin(code)).toBe(false);
    },
  );
});

describe("fiscal", () => {
  it("has the 9 NF-e origin codes", () => {
    expect(ORIGINS.map((origin) => origin.code)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it("keeps digits only", () => {
    expect(onlyDigits("6109.10.00")).toBe("61091000");
  });

  it("validates CFOP", () => {
    expect(isValidCfop("5102")).toBe(true);
    expect(isValidCfop("6108")).toBe(true);
    expect(isValidCfop("4102")).toBe(false);
    expect(isValidCfop("510")).toBe(false);
  });

  it("lists missing fiscal fields", () => {
    expect(missingFiscalFields({ ncm: null, origin: null, defaultCfop: null })).toEqual([
      "NCM",
      "origem",
      "CFOP",
    ]);
    expect(missingFiscalFields({ ncm: "61091000", origin: 0, defaultCfop: "5102" })).toEqual([]);
  });
});

describe("money", () => {
  it.each([
    ["12,50", 1250],
    ["12,5", 1250],
    ["1.234,56", 123456],
    ["R$ 10", 1000],
    ["0,99", 99],
    ["1234", 123400],
  ])("parses %s", (input, cents) => {
    expect(parseBrlToCents(input)).toBe(cents);
  });

  it.each(["abc", "12,345", "1,2,3", "-5", "12.5"])("rejects %s", (input) => {
    expect(parseBrlToCents(input)).toBeNull();
  });

  it("formats cents", () => {
    expect(formatCents(123456).replace(/\s/g, " ")).toBe("R$ 1.234,56");
    expect(centsToInput(1250)).toBe("12,50");
    expect(centsToInput(null)).toBe("");
  });
});

describe("productSchema", () => {
  it("trims and turns empty optional fields into null", () => {
    expect(productSchema.parse({ name: " Camiseta ", brand: " ", description: "" })).toEqual({
      name: "Camiseta",
      brand: null,
      description: null,
    });
  });

  it("requires a name", () => {
    const result = productSchema.safeParse({ name: " ", brand: "", description: "" });
    expect(result.success).toBe(false);
  });
});

const emptySku = {
  code: "cam-az-m",
  ean: "",
  ncm: "",
  cest: "",
  origin: "",
  unit: "UN",
  defaultCfop: "",
  weightGrams: "",
  heightCm: "",
  widthCm: "",
  lengthCm: "",
  location: "",
  cost: "",
};

describe("skuSchema", () => {
  it("normalizes a minimal SKU", () => {
    expect(skuSchema.parse(emptySku)).toEqual({
      code: "CAM-AZ-M",
      ean: null,
      variation: null,
      ncm: null,
      cest: null,
      origin: null,
      unit: "UN",
      defaultCfop: null,
      weightGrams: null,
      heightCm: null,
      widthCm: null,
      lengthCm: null,
      location: null,
      costCents: null,
    });
  });

  it("parses a complete SKU", () => {
    const result = skuSchema.parse({
      ...emptySku,
      ean: "4006381333931",
      variationName1: "Cor",
      variationValue1: "Azul",
      variationName2: "Tamanho",
      variationValue2: "M",
      ncm: "6109.10.00",
      cest: "28.038.00",
      origin: "0",
      defaultCfop: "5102",
      weightGrams: "250",
      heightCm: "3",
      widthCm: "25",
      lengthCm: "30",
      location: " Prateleira A3 ",
      cost: "18,90",
    });
    expect(result).toMatchObject({
      ean: "4006381333931",
      variation: [
        { name: "Cor", value: "Azul" },
        { name: "Tamanho", value: "M" },
      ],
      ncm: "61091000",
      cest: "2803800",
      origin: 0,
      defaultCfop: "5102",
      weightGrams: 250,
      location: "Prateleira A3",
      costCents: 1890,
    });
  });

  it.each([
    ["code", { code: " " }],
    ["code", { code: "CAM AZ" }],
    ["code", { code: "CAMISETA-AÇÃO" }],
    ["ean", { ean: "4006381333932" }],
    ["ncm", { ncm: "6109" }],
    ["cest", { cest: "123" }],
    ["origin", { origin: "9" }],
    ["unit", { unit: "XYZ" }],
    ["defaultCfop", { defaultCfop: "9999" }],
    ["weightGrams", { weightGrams: "0" }],
    ["heightCm", { heightCm: "2,5" }],
    ["cost", { cost: "doze" }],
  ])("reports an error on %s", (field, override) => {
    const result = skuSchema.safeParse({ ...emptySku, ...override });
    expect(result.success).toBe(false);
    if (!result.success) expect(fieldErrors(result.error)[field]).toBeTruthy();
  });

  it("requires both name and value in a variation", () => {
    const result = skuSchema.safeParse({ ...emptySku, variationName1: "Cor" });
    expect(result.success).toBe(false);
    if (!result.success) expect(fieldErrors(result.error).variationValue1).toBeTruthy();
  });

  it("normalizes SKU codes", () => {
    expect(normalizeSkuCode("  cam-az-m ")).toBe("CAM-AZ-M");
  });
});

describe("variationLabel", () => {
  it("joins attributes", () => {
    expect(
      variationLabel([
        { name: "Cor", value: "Azul" },
        { name: "Tamanho", value: "M" },
      ]),
    ).toBe("Cor: Azul / Tamanho: M");
    expect(variationLabel(null)).toBe("Sem variação");
  });
});
