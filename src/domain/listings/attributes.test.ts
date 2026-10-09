import { describe, expect, it } from "vitest";

import {
  diffAttributes,
  fromInput,
  toInput,
  type AttributeDefinition,
} from "@/domain/listings/attributes";

function definition(overrides: Partial<AttributeDefinition> & { id: string }): AttributeDefinition {
  return {
    name: overrides.id,
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
    ...overrides,
  };
}

const brand = definition({ id: "BRAND", values: [{ id: "15438", name: "Shure" }], required: true });
const color = definition({
  id: "COLOR",
  valueType: "list",
  values: [
    { id: "52049", name: "Preto" },
    { id: "52028", name: "Azul" },
  ],
});
const width = definition({
  id: "WIDTH",
  valueType: "number_unit",
  units: [
    { id: "cm", name: "cm" },
    { id: "mm", name: "mm" },
  ],
  defaultUnit: "cm",
});
const voltage = definition({
  id: "IS_BIVOLT",
  valueType: "boolean",
  values: [
    { id: "242085", name: "Sim" },
    { id: "242084", name: "Não" },
  ],
});
const capacity = definition({ id: "CAPACITY", valueType: "number" });

describe("fromInput", () => {
  it("list and boolean must match an option (sent with its id)", () => {
    expect(fromInput(color, { value: "azul" })).toEqual({
      ok: true,
      value: { id: "COLOR", valueId: "52028", valueName: "Azul" },
    });
    expect(fromInput(voltage, { value: "Sim" })).toMatchObject({
      ok: true,
      value: { valueId: "242085" },
    });
    expect(fromInput(color, { value: "Roxo" })).toMatchObject({ ok: false });
  });

  it("number_unit joins number and unit", () => {
    expect(fromInput(width, { value: "10,5", unit: "cm" })).toEqual({
      ok: true,
      value: { id: "WIDTH", valueId: null, valueName: "10.5 cm" },
    });
    expect(fromInput(width, { value: "10" })).toMatchObject({ value: { valueName: "10 cm" } });
    expect(fromInput(width, { value: "dez", unit: "cm" })).toMatchObject({ ok: false });
    expect(fromInput(width, { value: "10", unit: "pol" })).toMatchObject({ ok: false });
  });

  it("number accepts comma decimals", () => {
    expect(fromInput(capacity, { value: "1,5" })).toMatchObject({ value: { valueName: "1.5" } });
    expect(fromInput(capacity, { value: "1,5 L" })).toMatchObject({ ok: false });
  });

  it("free text reuses a known value id when it matches", () => {
    expect(fromInput(brand, { value: "shure" })).toMatchObject({ value: { valueId: "15438" } });
    expect(fromInput(brand, { value: "Outra" })).toMatchObject({
      value: { valueId: null, valueName: "Outra" },
    });
  });

  it("'não se aplica' is -1/null and not allowed for required attributes", () => {
    expect(fromInput(color, { value: "", notApplicable: true })).toEqual({
      ok: true,
      value: { id: "COLOR", valueId: "-1", valueName: null },
    });
    expect(fromInput(brand, { value: "", notApplicable: true })).toMatchObject({ ok: false });
  });

  it("respects the maximum length", () => {
    const short = definition({ id: "MODEL", maxLength: 5 });
    expect(fromInput(short, { value: "123456" })).toMatchObject({ ok: false });
  });
});

describe("toInput", () => {
  it("splits number and unit and marks N/A", () => {
    expect(toInput(width, { id: "WIDTH", valueId: null, valueName: "10.5 cm" })).toEqual({
      value: "10,5",
      unit: "cm",
    });
    expect(toInput(color, { id: "COLOR", valueId: "-1", valueName: null })).toEqual({
      value: "",
      notApplicable: true,
    });
  });
});

describe("diffAttributes", () => {
  const current = [
    { id: "BRAND", valueId: "15438", valueName: "Shure" },
    { id: "COLOR", valueId: "52049", valueName: "Preto" },
    { id: "WIDTH", valueId: null, valueName: "10 cm" },
  ];
  const definitions = [brand, color, width, capacity];

  it("returns only what changed", () => {
    const { changes, errors } = diffAttributes(definitions, current, {
      BRAND: { value: "Shure" },
      COLOR: { value: "Azul" },
      WIDTH: { value: "10", unit: "cm" },
      CAPACITY: { value: "" },
    });
    expect(errors).toEqual({});
    expect(changes.map((change) => [change.id, change.after.valueName])).toEqual([
      ["COLOR", "Azul"],
    ]);
  });

  it("emptying an optional attribute removes it; a required one is an error", () => {
    const { changes, errors } = diffAttributes(definitions, current, {
      BRAND: { value: "" },
      COLOR: { value: "" },
    });
    expect(errors).toEqual({ BRAND: "Obrigatório." });
    expect(changes).toEqual([
      {
        id: "COLOR",
        before: current[1],
        after: { id: "COLOR", valueId: null, valueName: null },
      },
    ]);
  });

  it("never sends read-only attributes and reports format errors", () => {
    const fixed = definition({ id: "LINE", readOnly: true });
    const { changes, errors } = diffAttributes([...definitions, fixed], current, {
      LINE: { value: "Outro" },
      CAPACITY: { value: "muito" },
    });
    expect(changes).toEqual([]);
    expect(errors.CAPACITY).toBeTruthy();
  });
});
