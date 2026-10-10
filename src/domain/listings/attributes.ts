// Technical sheet (attributes) in a marketplace-neutral shape. Connectors map
// their category attributes into AttributeDefinition; the edit form is built
// from it; changes go back as AttributeValue[] (start of the canonical model).

export type AttributeValueType = "string" | "number" | "number_unit" | "boolean" | "list" | "other";

export type AttributeDefinition = {
  id: string;
  name: string;
  valueType: AttributeValueType;
  /** Known values (suggestions for string/number; the only options for list/boolean). */
  values: Array<{ id: string; name: string }>;
  units: Array<{ id: string; name: string }>;
  defaultUnit: string | null;
  required: boolean;
  /** Required depending on the item (marketplace decides). */
  conditionalRequired: boolean;
  /** Not shown in the marketplace's own form, but can be set via API. */
  hidden: boolean;
  /** Fixed/inferred/internal: shown but not editable. */
  readOnly: boolean;
  multivalued: boolean;
  maxLength: number | null;
  /** Group name for sections in the form. */
  group: string | null;
};

/** Value of one attribute on a listing. valueId "-1" + valueName null = "não se aplica". */
export type AttributeValue = { id: string; valueId: string | null; valueName: string | null };

export const NOT_APPLICABLE_ID = "-1";

/** Form input state for one attribute (strings, as typed). */
export type AttributeInput = { value: string; unit?: string; notApplicable?: boolean };

/** Current listing value -> form input. */
export function toInput(
  definition: AttributeDefinition,
  current: AttributeValue | undefined,
): AttributeInput {
  if (!current) return { value: "" };
  if (current.valueId === NOT_APPLICABLE_ID && !current.valueName) {
    return { value: "", notApplicable: true };
  }
  const name = current.valueName ?? "";
  if (definition.valueType === "number_unit") {
    const match = name.match(/^\s*(-?\d+(?:[.,]\d+)?)\s*(.*)$/);
    if (match) {
      return {
        value: (match[1] ?? "").replace(".", ","),
        unit: (match[2] ?? "").trim() || undefined,
      };
    }
  }
  return { value: name };
}

export type InputCheck = { ok: true; value: AttributeValue | null } | { ok: false; error: string };

/**
 * Form input -> value to send. Returns value null when the field is empty
 * (nothing to set). Validates the format for the attribute type.
 */
export function fromInput(definition: AttributeDefinition, input: AttributeInput): InputCheck {
  if (input.notApplicable) {
    if (definition.required)
      return { ok: false, error: "Obrigatório: não pode ser “não se aplica”." };
    return { ok: true, value: { id: definition.id, valueId: NOT_APPLICABLE_ID, valueName: null } };
  }
  const raw = input.value.trim();
  if (!raw) return { ok: true, value: null };
  if (definition.maxLength && raw.length > definition.maxLength) {
    return { ok: false, error: `No máximo ${definition.maxLength} caracteres.` };
  }

  const known = definition.values.find((option) => option.name.toLowerCase() === raw.toLowerCase());
  switch (definition.valueType) {
    case "list":
    case "boolean":
      if (!known) return { ok: false, error: "Escolha uma opção da lista." };
      return { ok: true, value: { id: definition.id, valueId: known.id, valueName: known.name } };
    case "number": {
      if (!/^-?\d+(?:[.,]\d+)?$/.test(raw)) return { ok: false, error: "Informe um número." };
      return {
        ok: true,
        value: { id: definition.id, valueId: null, valueName: raw.replace(",", ".") },
      };
    }
    case "number_unit": {
      if (!/^-?\d+(?:[.,]\d+)?$/.test(raw)) return { ok: false, error: "Informe um número." };
      const unit = input.unit?.trim() || definition.defaultUnit;
      if (!unit) return { ok: false, error: "Escolha a unidade." };
      if (
        definition.units.length &&
        !definition.units.some((option) => option.id === unit || option.name === unit)
      ) {
        return { ok: false, error: "Escolha uma unidade da lista." };
      }
      return {
        ok: true,
        value: { id: definition.id, valueId: null, valueName: `${raw.replace(",", ".")} ${unit}` },
      };
    }
    default:
      // Free text: reuse the known value id when the text matches one exactly.
      return {
        ok: true,
        value: known
          ? { id: definition.id, valueId: known.id, valueName: known.name }
          : { id: definition.id, valueId: null, valueName: raw },
      };
  }
}

/** Same meaning? (ids win when both have one; otherwise compare names ignoring case). */
export function sameValue(a: AttributeValue | undefined, b: AttributeValue | undefined): boolean {
  if (!a || !b) return !a && !b;
  if (a.valueId && b.valueId) return a.valueId === b.valueId;
  return (a.valueName ?? "").trim().toLowerCase() === (b.valueName ?? "").trim().toLowerCase();
}

export type AttributeChange = {
  id: string;
  before: AttributeValue | undefined;
  after: AttributeValue;
};

/**
 * Attributes to send: only those that changed. An emptied field becomes an
 * explicit removal (valueId/valueName null), which the marketplace refuses for
 * required attributes (caught as a validation error).
 */
export function diffAttributes(
  definitions: AttributeDefinition[],
  current: AttributeValue[],
  inputs: Record<string, AttributeInput>,
): { changes: AttributeChange[]; errors: Record<string, string> } {
  const byId = new Map(current.map((value) => [value.id, value]));
  const changes: AttributeChange[] = [];
  const errors: Record<string, string> = {};
  for (const definition of definitions) {
    if (definition.readOnly) continue;
    const input = inputs[definition.id];
    if (!input) continue;
    const before = byId.get(definition.id);
    const checked = fromInput(definition, input);
    if (!checked.ok) {
      errors[definition.id] = checked.error;
      continue;
    }
    if (checked.value === null) {
      if (before && (before.valueId || before.valueName)) {
        if (definition.required) {
          errors[definition.id] = "Obrigatório.";
          continue;
        }
        changes.push({
          id: definition.id,
          before,
          after: { id: definition.id, valueId: null, valueName: null },
        });
      }
      continue;
    }
    if (!sameValue(before, checked.value))
      changes.push({ id: definition.id, before, after: checked.value });
  }
  return { changes, errors };
}

// ---- Presentation helpers for the technical sheet forms (2B edit, 2C new) ----

/** Label of an attribute field: "*" required; "(pode ser obrigatório)" when the marketplace decides. */
export function attributeLabel(definition: AttributeDefinition): string {
  if (definition.required) return `${definition.name} *`;
  if (definition.conditionalRequired) return `${definition.name} (pode ser obrigatório)`;
  return definition.name;
}

/** Extra help for attributes whose marketplace name is hard to recognize. */
const ATTRIBUTE_HINTS: Record<string, string> = {
  GTIN: "EAN / código de barras. Sem código? Preencha “Motivo de GTIN vazio” em Avançado.",
  EMPTY_GTIN_REASON: "Use só quando o produto não tem código de barras (GTIN/EAN).",
  SELLER_SKU: "Seu código interno do produto.",
};

export function attributeHint(definition: AttributeDefinition): string | undefined {
  return ATTRIBUTE_HINTS[definition.id];
}

/** Form order: required, then "may be required", then the rest (stable otherwise). */
export function sortForForm(definitions: AttributeDefinition[]): AttributeDefinition[] {
  const rank = (definition: AttributeDefinition) =>
    definition.required ? 0 : definition.conditionalRequired ? 1 : 2;
  return [...definitions].sort((a, b) => rank(a) - rank(b));
}

/**
 * Attribute ids named in marketplace refusals, e.g. ML:
 * "The attributes [GTIN] are required for category [MLB192369]..." -> ["GTIN"]
 * Only ids present in `known` are returned (the category id is ignored).
 */
export function attributeIdsInErrors(errors: string[], known: Set<string>): string[] {
  const found = new Set<string>();
  for (const error of errors) {
    for (const match of error.matchAll(/\[([^\]]+)\]/g)) {
      for (const id of match[1]!.split(",")) {
        const clean = id.trim();
        if (known.has(clean)) found.add(clean);
      }
    }
  }
  return [...found];
}
