import { describe, expect, it } from "vitest";

import {
  attributeHint,
  attributeIdsInErrors,
  attributeLabel,
  sortForForm,
  type AttributeDefinition,
} from "@/domain/listings/attributes";

const definition = (id: string, extra: Partial<AttributeDefinition> = {}): AttributeDefinition => ({
  id,
  name: id,
  valueType: "string",
  values: [],
  units: [],
  defaultUnit: null,
  required: false,
  conditionalRequired: false,
  hidden: false,
  readOnly: false,
  multivalued: false,
  maxLength: null,
  group: null,
  ...extra,
});

describe("attribute form helpers", () => {
  it("marks required and conditionally required fields", () => {
    expect(attributeLabel(definition("BRAND", { name: "Marca", required: true }))).toBe("Marca *");
    expect(
      attributeLabel(
        definition("GTIN", { name: "Código universal de produto", conditionalRequired: true }),
      ),
    ).toBe("Código universal de produto (pode ser obrigatório)");
    expect(attributeLabel(definition("COLOR", { name: "Cor" }))).toBe("Cor");
  });

  it("explains GTIN", () => {
    expect(attributeHint(definition("GTIN"))).toContain("EAN");
    expect(attributeHint(definition("COLOR"))).toBeUndefined();
  });

  it("orders required, then may-be-required, then the rest", () => {
    const sorted = sortForForm([
      definition("COLOR"),
      definition("GTIN", { conditionalRequired: true }),
      definition("BRAND", { required: true }),
    ]);
    expect(sorted.map((item) => item.id)).toEqual(["BRAND", "GTIN", "COLOR"]);
  });

  it("finds the attribute ids named in a Mercado Livre refusal", () => {
    const known = new Set(["GTIN", "BRAND"]);
    expect(
      attributeIdsInErrors(
        [
          "The attributes [GTIN] are required for category [MLB192369]. Check the attribute is present in the attributes list.",
        ],
        known,
      ),
    ).toEqual(["GTIN"]);
    expect(attributeIdsInErrors(["The attributes [GTIN, BRAND] are required"], known)).toEqual([
      "GTIN",
      "BRAND",
    ]);
    expect(attributeIdsInErrors(["Preço inválido"], known)).toEqual([]);
  });
});
