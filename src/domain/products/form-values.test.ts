import { describe, expect, it } from "vitest";

import { skuToFormValues } from "@/domain/products/form-values";
import { skuSchema } from "@/domain/products/schemas";

describe("skuToFormValues", () => {
  it("round-trips: editing and saving without changes keeps the same data", () => {
    const saved = {
      code: "CAM-AZ-M",
      ean: "4006381333931",
      variation: [
        { name: "Cor", value: "Azul" },
        { name: "Tamanho", value: "M" },
      ],
      ncm: "61091000",
      cest: "2803800",
      origin: 0,
      unit: "PC",
      defaultCfop: "5102",
      weightGrams: 250,
      heightCm: 3,
      widthCm: 25,
      lengthCm: 30,
      location: "Prateleira A3",
      costCents: 123456,
    };
    expect(skuSchema.parse(skuToFormValues(saved))).toEqual(saved);
  });

  it("round-trips an SKU with only the required fields", () => {
    const saved = {
      code: "X1",
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
    };
    expect(skuSchema.parse(skuToFormValues(saved))).toEqual(saved);
  });
});
