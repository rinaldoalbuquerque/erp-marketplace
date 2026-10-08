"use client";

import { useActionState } from "react";

import { FormSection, SelectField, TextareaField } from "@/components/ui/fields";
import { Field, FormMessage, SubmitButton } from "@/components/ui/form";
import { ORIGINS, UNITS } from "@/domain/products/fiscal";
import { initialFormState, type FormState } from "@/lib/auth/form-state";

type Action = (prev: FormState, formData: FormData) => Promise<FormState>;
type Values = Record<string, string>;

const ORIGIN_OPTIONS = ORIGINS.map((origin) => ({
  value: String(origin.code),
  label: origin.label,
}));
const UNIT_OPTIONS = UNITS.map((unit) => ({ value: unit.code, label: unit.label }));

/** Field value after an error (what the user typed) or the saved value. */
function pick(state: FormState, defaults: Values, name: string) {
  return state.values?.[name] ?? defaults[name] ?? "";
}

function ProductFields({ state, defaults }: { state: FormState; defaults: Values }) {
  const errors = state.fieldErrors ?? {};
  return (
    <FormSection title="Produto">
      <div className="sm:col-span-2">
        <Field
          label="Nome"
          name="name"
          required
          maxLength={200}
          defaultValue={pick(state, defaults, "name")}
          error={errors.name}
        />
      </div>
      <Field
        label="Marca (opcional)"
        name="brand"
        maxLength={80}
        defaultValue={pick(state, defaults, "brand")}
        error={errors.brand}
      />
      <div className="sm:col-span-2">
        <TextareaField
          label="Descrição (opcional)"
          name="description"
          maxLength={5000}
          defaultValue={pick(state, defaults, "description")}
          error={errors.description}
        />
      </div>
    </FormSection>
  );
}

function SkuFields({
  state,
  defaults,
  canSeeCost,
  showInitialStock,
}: {
  state: FormState;
  defaults: Values;
  canSeeCost: boolean;
  showInitialStock: boolean;
}) {
  const errors = state.fieldErrors ?? {};
  const value = (name: string) => pick(state, defaults, name);

  return (
    <>
      <FormSection title="Identificação">
        <Field
          label="Código SKU"
          name="code"
          required
          maxLength={60}
          autoCapitalize="characters"
          placeholder="Ex.: CAM-AZ-M"
          defaultValue={value("code")}
          error={errors.code}
          hint="Letras, números e - _ . / (salvo em maiúsculas)."
        />
        <Field
          label="EAN / GTIN (opcional)"
          name="ean"
          inputMode="numeric"
          maxLength={20}
          defaultValue={value("ean")}
          error={errors.ean}
          hint="Código de barras de 8, 12, 13 ou 14 dígitos."
        />
      </FormSection>

      <FormSection
        title="Variação"
        description="Deixe em branco se o produto não tem variações. Ex.: Cor / Azul, Tamanho / M."
      >
        {([1, 2, 3] as const).map((slot) => (
          <div key={slot} className="grid grid-cols-2 gap-3 sm:col-span-2">
            <Field
              label={`Atributo ${slot}`}
              name={`variationName${slot}`}
              maxLength={40}
              placeholder={slot === 1 ? "Cor" : slot === 2 ? "Tamanho" : ""}
              defaultValue={value(`variationName${slot}`)}
              error={errors[`variationName${slot}`]}
            />
            <Field
              label={`Valor ${slot}`}
              name={`variationValue${slot}`}
              maxLength={60}
              placeholder={slot === 1 ? "Azul" : slot === 2 ? "M" : ""}
              defaultValue={value(`variationValue${slot}`)}
              error={errors[`variationValue${slot}`]}
            />
          </div>
        ))}
      </FormSection>

      <FormSection
        title="Fiscal"
        description="Usados na emissão da NF-e. Na dúvida, confirme com seu contador."
      >
        <Field
          label="NCM"
          name="ncm"
          inputMode="numeric"
          maxLength={10}
          placeholder="0000.00.00"
          defaultValue={value("ncm")}
          error={errors.ncm}
        />
        <Field
          label="CEST (opcional)"
          name="cest"
          inputMode="numeric"
          maxLength={9}
          placeholder="00.000.00"
          defaultValue={value("cest")}
          error={errors.cest}
        />
        <div className="sm:col-span-2">
          <SelectField
            label="Origem da mercadoria"
            name="origin"
            options={ORIGIN_OPTIONS}
            placeholder="Selecione…"
            defaultValue={value("origin")}
            error={errors.origin}
          />
        </div>
        <SelectField
          label="Unidade"
          name="unit"
          options={UNIT_OPTIONS}
          defaultValue={value("unit") || "UN"}
          error={errors.unit}
        />
        <Field
          label="CFOP padrão"
          name="defaultCfop"
          inputMode="numeric"
          maxLength={5}
          placeholder="5102"
          defaultValue={value("defaultCfop")}
          error={errors.defaultCfop}
        />
      </FormSection>

      <FormSection
        title="Envio"
        description="Peso e medidas do pacote. O Mercado Livre usa para calcular o frete."
      >
        <Field
          label="Peso (g)"
          name="weightGrams"
          inputMode="numeric"
          defaultValue={value("weightGrams")}
          error={errors.weightGrams}
        />
        <Field
          label="Altura (cm)"
          name="heightCm"
          inputMode="numeric"
          defaultValue={value("heightCm")}
          error={errors.heightCm}
        />
        <Field
          label="Largura (cm)"
          name="widthCm"
          inputMode="numeric"
          defaultValue={value("widthCm")}
          error={errors.widthCm}
        />
        <Field
          label="Comprimento (cm)"
          name="lengthCm"
          inputMode="numeric"
          defaultValue={value("lengthCm")}
          error={errors.lengthCm}
        />
      </FormSection>

      <FormSection title="Separação e estoque">
        <Field
          label="Localização (opcional)"
          name="location"
          maxLength={60}
          placeholder="Ex.: Prateleira A3"
          defaultValue={value("location")}
          error={errors.location}
        />
        {showInitialStock ? (
          <Field
            label="Estoque inicial (opcional)"
            name="initialStock"
            inputMode="numeric"
            defaultValue={value("initialStock")}
            error={errors.initialStock}
            hint="Registrado como entrada no histórico."
          />
        ) : null}
        {canSeeCost ? (
          <Field
            label="Custo unitário (R$)"
            name="cost"
            inputMode="decimal"
            placeholder="0,00"
            defaultValue={value("cost")}
            error={errors.cost}
          />
        ) : null}
      </FormSection>
    </>
  );
}

export function NewProductForm({
  action,
  canSeeCost,
  canAdjustStock,
}: {
  action: Action;
  canSeeCost: boolean;
  canAdjustStock: boolean;
}) {
  const [state, formAction] = useActionState(action, initialFormState);
  return (
    <form action={formAction} className="flex max-w-3xl flex-col gap-5" noValidate>
      <FormMessage state={state} />
      <ProductFields state={state} defaults={{}} />
      <SkuFields
        state={state}
        defaults={{}}
        canSeeCost={canSeeCost}
        showInitialStock={canAdjustStock}
      />
      <div>
        <SubmitButton pendingText="Salvando…">Criar produto</SubmitButton>
      </div>
    </form>
  );
}

export function EditProductForm({ action, defaults }: { action: Action; defaults: Values }) {
  const [state, formAction] = useActionState(action, initialFormState);
  return (
    <form action={formAction} className="flex flex-col gap-4" noValidate>
      <FormMessage state={state} />
      <ProductFields state={state} defaults={defaults} />
      <div>
        <SubmitButton pendingText="Salvando…">Salvar produto</SubmitButton>
      </div>
    </form>
  );
}

export function SkuForm({
  action,
  defaults,
  canSeeCost,
  showInitialStock,
  submitLabel,
}: {
  action: Action;
  defaults: Values;
  canSeeCost: boolean;
  showInitialStock: boolean;
  submitLabel: string;
}) {
  const [state, formAction] = useActionState(action, initialFormState);
  return (
    <form action={formAction} className="flex max-w-3xl flex-col gap-5" noValidate>
      <FormMessage state={state} />
      <SkuFields
        state={state}
        defaults={defaults}
        canSeeCost={canSeeCost}
        showInitialStock={showInitialStock}
      />
      <div>
        <SubmitButton pendingText="Salvando…">{submitLabel}</SubmitButton>
      </div>
    </form>
  );
}
