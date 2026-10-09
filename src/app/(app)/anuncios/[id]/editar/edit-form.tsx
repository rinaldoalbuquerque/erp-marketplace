"use client";

import { Save } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";

import { Field } from "@/components/ui/form";
import { FormSection, SelectField, TextareaField } from "@/components/ui/fields";
import type { AttributeDefinition, AttributeInput } from "@/domain/listings/attributes";

import { saveListingEditAction, type EditPayload } from "./actions";

export type EditFormInitial = {
  versionStamp: string | null;
  title: string;
  familyName: string;
  price: string;
  status: "active" | "paused" | "closed" | string;
  description: string;
  attributes: Record<string, AttributeInput>;
  /** Display values of read-only attributes. */
  readOnlyValues: Record<string, string>;
};

const STATUS_OPTIONS = [
  { value: "active", label: "Ativo" },
  { value: "paused", label: "Pausado" },
  { value: "closed", label: "Finalizado (não pode ser reativado)" },
];

type Message = { tone: "success" | "error" | "signal"; lines: string[] };

/** Field for one attribute, chosen by its type. */
function AttributeField({
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

export function EditListingForm({
  listingId,
  initial,
  definitions,
  rules,
  canClose,
}: {
  listingId: string;
  initial: EditFormInitial;
  definitions: AttributeDefinition[];
  rules: { titleEditable: boolean; familyNameEditable: boolean };
  canClose: boolean;
}) {
  const router = useRouter();
  const [title, setTitle] = useState(initial.title);
  const [familyName, setFamilyName] = useState(initial.familyName);
  const [price, setPrice] = useState(initial.price);
  const [status, setStatus] = useState(initial.status);
  const [description, setDescription] = useState(initial.description);
  const [attributes, setAttributes] = useState(initial.attributes);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<Message | null>(null);
  const [pending, startTransition] = useTransition();

  const { main, advanced, readOnly } = useMemo(() => {
    const editable = definitions.filter((definition) => !definition.readOnly);
    return {
      main: editable
        .filter((definition) => !definition.hidden)
        .sort((a, b) => Number(b.required) - Number(a.required)),
      advanced: editable.filter((definition) => definition.hidden),
      readOnly: definitions.filter(
        (definition) => definition.readOnly && initial.readOnlyValues[definition.id],
      ),
    };
  }, [definitions, initial.readOnlyValues]);

  const statusOptions = canClose
    ? STATUS_OPTIONS
    : STATUS_OPTIONS.filter((option) => option.value !== "closed");

  function save() {
    setMessage(null);
    if (status === "closed" && initial.status !== "closed") {
      const ok = window.confirm(
        "Finalizar o anúncio no Mercado Livre? Um anúncio finalizado não pode ser reativado.",
      );
      if (!ok) return;
    }
    const payload: EditPayload = {
      versionStamp: initial.versionStamp,
      price,
      description,
      // Only attributes the user touched: an untouched legacy value that is no
      // longer in the category's option list must not block saving.
      attributes: Object.fromEntries(
        Object.entries(attributes).filter(
          ([id, input]) => JSON.stringify(input) !== JSON.stringify(initial.attributes[id]),
        ),
      ),
      ...(rules.titleEditable ? { title } : {}),
      ...(rules.familyNameEditable ? { familyName } : {}),
      ...(status === "active" || status === "paused" || status === "closed" ? { status } : {}),
    };
    startTransition(async () => {
      const result = await saveListingEditAction(listingId, payload);
      setErrors({});
      switch (result.status) {
        case "saved":
          setMessage(
            result.warnings.length
              ? {
                  tone: "signal",
                  lines: ["Salvo, mas o Mercado Livre ignorou parte:", ...result.warnings],
                }
              : { tone: "success", lines: ["Alterações salvas no Mercado Livre."] },
          );
          router.refresh();
          break;
        case "no_changes":
          setMessage({ tone: "signal", lines: ["Nada mudou: não havia o que enviar."] });
          break;
        case "invalid":
          setErrors(result.fieldErrors);
          setMessage({ tone: "error", lines: ["Confira os campos marcados."] });
          break;
        case "refused":
          setMessage({ tone: "error", lines: ["O Mercado Livre recusou:", ...result.causes] });
          break;
        case "conflict":
          setMessage({
            tone: "error",
            lines: [
              "O anúncio foi alterado no Mercado Livre depois que você abriu esta tela. Nada foi enviado. Recarregue a página para ver a versão atual.",
            ],
          });
          break;
        case "writes_disabled":
          setMessage({ tone: "error", lines: ["As alterações estão bloqueadas para esta conta."] });
          break;
        case "forbidden":
          setMessage({ tone: "error", lines: ["Seu perfil não permite finalizar anúncios."] });
          break;
        case "reconnect":
          setMessage({
            tone: "error",
            lines: ["A conta precisa ser reconectada em Contas de marketplace."],
          });
          break;
        default:
          setMessage({ tone: "error", lines: ["O Mercado Livre não respondeu. Tente de novo."] });
      }
    });
  }

  const setAttribute = (id: string, next: AttributeInput) =>
    setAttributes((current) => ({ ...current, [id]: next }));

  return (
    <div className="flex max-w-4xl flex-col gap-5">
      <FormSection title="Anúncio">
        {rules.familyNameEditable ? (
          <div className="sm:col-span-2">
            <Field
              label="Nome da família"
              name="familyName"
              value={familyName}
              onChange={(event) => setFamilyName(event.target.value)}
              error={errors.familyName}
              hint="No modelo User Products o título é gerado pelo Mercado Livre a partir do nome da família e dos atributos."
            />
          </div>
        ) : (
          <div className="sm:col-span-2">
            <Field
              label="Título"
              name="title"
              value={title}
              disabled={!rules.titleEditable}
              onChange={(event) => setTitle(event.target.value)}
              error={errors.title}
              hint={
                rules.titleEditable
                  ? undefined
                  : "O título não pode mudar depois da primeira venda (regra do Mercado Livre)."
              }
            />
          </div>
        )}
        <Field
          label="Preço (R$)"
          name="price"
          inputMode="decimal"
          value={price}
          onChange={(event) => setPrice(event.target.value)}
          error={errors.price}
          hint="Anúncios com automatização de preços ativa no Mercado Livre não aceitam alteração de preço."
        />
        <SelectField
          label="Status"
          name="status"
          options={
            statusOptions.some((option) => option.value === initial.status)
              ? statusOptions
              : [{ value: initial.status, label: initial.status }, ...statusOptions]
          }
          value={status}
          onChange={(event) => setStatus(event.target.value)}
        />
      </FormSection>

      <section className="rounded-xl border border-border bg-surface p-5">
        <TextareaField
          label="Descrição"
          name="description"
          rows={10}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          error={errors.description}
          hint="Somente texto simples: sem negrito, cores ou HTML (regra do Mercado Livre). Quebras de linha são mantidas."
        />
      </section>

      {main.length ? (
        <FormSection
          title="Ficha técnica"
          description="Campos com * são obrigatórios na categoria."
        >
          {main.map((definition) => (
            <AttributeField
              key={definition.id}
              definition={definition}
              input={attributes[definition.id] ?? { value: "" }}
              error={errors[`attr.${definition.id}`]}
              onChange={(next) => setAttribute(definition.id, next)}
            />
          ))}
        </FormSection>
      ) : null}

      {advanced.length ? (
        <details className="rounded-xl border border-border bg-surface p-5">
          <summary className="cursor-pointer font-display text-base font-semibold text-ink">
            Avançado ({advanced.length} atributos que o Mercado Livre não mostra no formulário dele)
          </summary>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            {advanced.map((definition) => (
              <AttributeField
                key={definition.id}
                definition={definition}
                input={attributes[definition.id] ?? { value: "" }}
                error={errors[`attr.${definition.id}`]}
                onChange={(next) => setAttribute(definition.id, next)}
              />
            ))}
          </div>
        </details>
      ) : null}

      {readOnly.length ? (
        <section className="rounded-xl border border-border bg-surface p-5 text-sm">
          <p className="mb-2 font-medium text-ink">Definidos pelo Mercado Livre (não editáveis)</p>
          <dl className="grid gap-x-4 gap-y-1 sm:grid-cols-2">
            {readOnly.map((definition) => (
              <div key={definition.id} className="flex gap-2">
                <dt className="text-muted">{definition.name}:</dt>
                <dd className="text-ink">{initial.readOnlyValues[definition.id]}</dd>
              </div>
            ))}
          </dl>
        </section>
      ) : null}

      <div className="sticky bottom-0 z-10 -mx-4 flex flex-col gap-3 border-t border-border bg-bg/95 px-4 py-3 backdrop-blur lg:-mx-8 lg:px-8">
        {message ? (
          <div
            role={message.tone === "error" ? "alert" : "status"}
            className={`rounded-lg border-l-4 px-3 py-2 text-sm ${
              message.tone === "error"
                ? "border-danger bg-danger-soft text-danger"
                : message.tone === "signal"
                  ? "border-signal bg-signal-soft text-signal-ink"
                  : "border-success bg-success-soft text-success"
            }`}
          >
            {message.lines.map((line) => (
              <p key={line}>{line}</p>
            ))}
          </div>
        ) : null}
        <div>
          <button
            type="button"
            onClick={save}
            disabled={pending}
            className="inline-flex h-10 items-center gap-2 rounded-lg bg-brand px-4 text-sm font-semibold text-on-brand hover:bg-brand-hover disabled:opacity-60"
          >
            <Save className="size-4" aria-hidden="true" />
            {pending ? "Enviando ao Mercado Livre…" : "Salvar no Mercado Livre"}
          </button>
        </div>
      </div>
    </div>
  );
}
