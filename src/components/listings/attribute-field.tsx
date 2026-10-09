"use client";

import { Field } from "@/components/ui/form";
import { SelectField } from "@/components/ui/fields";
import type { AttributeDefinition, AttributeInput } from "@/domain/listings/attributes";

// Shared by the edit screen (2B) and the new listing screen (2C).

/** Field for one attribute, chosen by its type. */
export function AttributeField({
  definition,
  input,
  error,
  onChange,
}: {
  definition: AttributeDefinition;
  input: AttributeInput;
  error?: string;
  onChange: (next: AttributeInput) => void;
}) {
  const label = `${definition.name}${definition.required ? " *" : ""}`;
  const notApplicable = Boolean(input.notApplicable);
  const naToggle = definition.required ? null : (
    <label className="flex items-center gap-1.5 text-xs text-muted">
      <input
        type="checkbox"
        checked={notApplicable}
        onChange={(event) => onChange({ value: "", notApplicable: event.target.checked })}
      />
      Não se aplica
    </label>
  );

  if (definition.valueType === "list" || definition.valueType === "boolean") {
    return (
      <div className="flex flex-col gap-1">
        <SelectField
          label={label}
          name={`attr-${definition.id}`}
          options={definition.values.map((option) => ({ value: option.name, label: option.name }))}
          placeholder="—"
          value={notApplicable ? "" : input.value}
          disabled={notApplicable}
          onChange={(event) => onChange({ value: event.target.value })}
          error={error}
        />
        {naToggle}
      </div>
    );
  }

  if (definition.valueType === "number_unit") {
    return (
      <div className="flex flex-col gap-1">
        <div className="grid grid-cols-[1fr_auto] items-end gap-2">
          <Field
            label={label}
            name={`attr-${definition.id}`}
            inputMode="decimal"
            value={notApplicable ? "" : input.value}
            disabled={notApplicable}
            onChange={(event) => onChange({ ...input, value: event.target.value })}
            error={error}
          />
          <select
            aria-label={`Unidade de ${definition.name}`}
            value={input.unit ?? definition.defaultUnit ?? ""}
            disabled={notApplicable}
            onChange={(event) => onChange({ ...input, unit: event.target.value })}
            className={`mb-px h-10 rounded-lg border border-border bg-surface px-2 text-ink ${error ? "mb-6" : ""}`}
          >
            {definition.units.map((unit) => (
              <option key={unit.id} value={unit.id}>
                {unit.name}
              </option>
            ))}
          </select>
        </div>
        {naToggle}
      </div>
    );
  }

  const listId = definition.values.length ? `attr-values-${definition.id}` : undefined;
  return (
    <div className="flex flex-col gap-1">
      <Field
        label={label}
        name={`attr-${definition.id}`}
        list={listId}
        inputMode={definition.valueType === "number" ? "decimal" : undefined}
        maxLength={definition.maxLength ?? undefined}
        value={notApplicable ? "" : input.value}
        disabled={notApplicable}
        onChange={(event) => onChange({ value: event.target.value })}
        error={error}
      />
      {listId ? (
        <datalist id={listId}>
          {definition.values.slice(0, 200).map((option) => (
            <option key={option.id} value={option.name} />
          ))}
        </datalist>
      ) : null}
      {naToggle}
    </div>
  );
}
