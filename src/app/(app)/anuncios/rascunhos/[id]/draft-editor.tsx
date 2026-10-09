"use client";

import { ArrowLeft, ArrowRight, CheckCircle2, ImagePlus, Rocket, Save, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";

import { AttributeField } from "@/components/listings/attribute-field";
import { FormSection, SelectField, TextareaField } from "@/components/ui/fields";
import { Field } from "@/components/ui/form";
import type { CategorySuggestion, FeeQuote } from "@/connectors/types";
import {
  fromInput,
  toInput,
  type AttributeDefinition,
  type AttributeInput,
  type AttributeValue,
} from "@/domain/listings/attributes";
import {
  LISTING_CONDITIONS,
  LISTING_TYPES,
  type CanonicalListing,
  type ListingTypeId,
  type PublishModel,
} from "@/domain/listings/canonical";
import { centsToInput, formatCents, parseBrlToCents } from "@/domain/products/money";

import {
  categoryAttributesAction,
  publishDraftAction,
  quoteFeesAction,
  saveDraftAction,
  suggestCategoriesAction,
  uploadPictureAction,
  validateDraftAction,
} from "../actions";

type Message = { tone: "success" | "error" | "signal"; lines: string[] };

const MAX_SIDE = 1920; // ML keeps pictures up to 1920 px

/** Resizes a picture in the browser (keeps uploads small; ML resizes above 1920 px anyway). */
async function shrink(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) return file;
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  if (scale === 1 && file.size < 3 * 1024 * 1024) return file;
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", 0.9),
  );
  return blob ?? file;
}

const FAILURES: Record<string, string> = {
  not_found: "Rascunho não encontrado.",
  reconnect: "A conta precisa ser reconectada em Contas de marketplace.",
  marketplace_error: "O Mercado Livre não respondeu. Tente de novo.",
  locked: "Este rascunho já foi publicado (ou está sendo publicado) e não pode mais ser alterado.",
  writes_disabled:
    "As alterações estão bloqueadas para esta conta. Libere em Contas de marketplace para publicar.",
  invalid: "Arquivo inválido (use JPG ou PNG de até 10 MB).",
};

export function DraftEditor({
  draftId,
  model,
  editable,
  allowWrites,
  initial,
  initialDefinitions,
  lastErrors,
  sku,
}: {
  draftId: string;
  model: PublishModel;
  editable: boolean;
  allowWrites: boolean;
  initial: CanonicalListing;
  initialDefinitions: AttributeDefinition[] | null;
  lastErrors: string[];
  /** costCents only when the member may see costs */
  sku: { code: string; costCents: number | null; stockOnHand: number } | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<Message | null>(
    lastErrors.length
      ? { tone: "error", lines: ["Última tentativa recusada pelo Mercado Livre:", ...lastErrors] }
      : null,
  );
  const [errors, setErrors] = useState<Record<string, string>>({});

  const [familyName, setFamilyName] = useState(initial.familyName);
  const [title, setTitle] = useState(initial.title);
  const [description, setDescription] = useState(initial.description);
  const [condition, setCondition] = useState(initial.condition);
  const [listingTypeId, setListingTypeId] = useState<ListingTypeId>(initial.listingTypeId);
  const [price, setPrice] = useState(centsToInput(initial.priceCents));
  const [quantity, setQuantity] = useState(String(initial.availableQuantity));
  const [pictures, setPictures] = useState(initial.pictures);
  const [warrantyType, setWarrantyType] = useState(initial.warranty.type ?? "");
  const [warrantyTime, setWarrantyTime] = useState(initial.warranty.time ?? "");

  const [categoryId, setCategoryId] = useState(initial.categoryId);
  const [categoryName, setCategoryName] = useState(initial.categoryName);
  const [definitions, setDefinitions] = useState(initialDefinitions);
  const [query, setQuery] = useState(initial.familyName || initial.title);
  const [suggestions, setSuggestions] = useState<CategorySuggestion[] | null>(null);
  const [quotes, setQuotes] = useState<FeeQuote[] | null>(null);

  // Attribute values: by definition when the category is known, loose otherwise.
  const byId = useMemo(
    () => new Map(initial.attributes.map((value) => [value.id, value])),
    [initial.attributes],
  );
  const [loose, setLoose] = useState<AttributeValue[]>(initial.attributes);
  const [inputs, setInputs] = useState<Record<string, AttributeInput>>(() =>
    Object.fromEntries(
      (initialDefinitions ?? []).map((definition) => [
        definition.id,
        toInput(definition, byId.get(definition.id)),
      ]),
    ),
  );

  const { main, advanced } = useMemo(() => {
    const editableDefs = (definitions ?? []).filter((definition) => !definition.readOnly);
    return {
      main: editableDefs
        .filter((definition) => !definition.hidden)
        .sort((a, b) => Number(b.required) - Number(a.required)),
      advanced: editableDefs.filter((definition) => definition.hidden),
    };
  }, [definitions]);

  /** Current form -> canonical listing (null + field errors when something is invalid). */
  function collect(): CanonicalListing | null {
    const fieldErrors: Record<string, string> = {};
    const priceCents = price.trim() ? parseBrlToCents(price) : null;
    if (price.trim() && (priceCents === null || priceCents <= 0)) {
      fieldErrors.price = "Preço inválido (ex.: 29,90).";
    }
    const available = Number(quantity);
    if (!Number.isInteger(available) || available < 0) {
      fieldErrors.quantity = "Quantidade inválida.";
    }
    let attributes: AttributeValue[] = loose;
    if (definitions) {
      attributes = [];
      for (const definition of definitions) {
        if (definition.readOnly) continue;
        const input = inputs[definition.id] ?? { value: "" };
        const check = fromInput(definition, input);
        if (!check.ok) fieldErrors[`attr.${definition.id}`] = check.error;
        else if (check.value) attributes.push(check.value);
      }
    }
    setErrors(fieldErrors);
    if (Object.keys(fieldErrors).length) {
      setMessage({ tone: "error", lines: ["Confira os campos marcados."] });
      return null;
    }
    return {
      familyName: familyName.trim(),
      title: title.trim(),
      description,
      categoryId,
      categoryName,
      condition,
      listingTypeId,
      priceCents,
      availableQuantity: available,
      pictures,
      attributes,
      warranty: { type: warrantyType.trim() || null, time: warrantyTime.trim() || null },
    };
  }

  async function persist(listing: CanonicalListing): Promise<boolean> {
    const saved = await saveDraftAction(draftId, listing);
    if (saved === "saved") return true;
    setMessage({
      tone: "error",
      lines: [
        saved === "invalid" ? "Dados inválidos." : (FAILURES[saved] ?? "Não foi possível salvar."),
      ],
    });
    return false;
  }

  function save() {
    const listing = collect();
    if (!listing) return;
    startTransition(async () => {
      if (await persist(listing)) {
        setMessage({ tone: "success", lines: ["Rascunho salvo."] });
        router.refresh();
      }
    });
  }

  function validate() {
    const listing = collect();
    if (!listing) return;
    startTransition(async () => {
      if (!(await persist(listing))) return;
      const result = await validateDraftAction(draftId);
      switch (result.status) {
        case "valid":
          setMessage({
            tone: "success",
            lines: ["O Mercado Livre validou o anúncio: pode publicar."],
          });
          break;
        case "incomplete":
          setMessage({ tone: "error", lines: ["Falta preencher:", ...result.missing] });
          break;
        case "refused":
          setMessage({ tone: "error", lines: ["O Mercado Livre apontou:", ...result.errors] });
          break;
        default:
          setMessage({ tone: "error", lines: [FAILURES[result.status] ?? "Erro."] });
      }
      router.refresh();
    });
  }

  function publish() {
    const listing = collect();
    if (!listing) return;
    const ok = window.confirm(
      "Publicar este anúncio no Mercado Livre agora? Ele fica visível para compradores assim que o Mercado Livre aprovar.",
    );
    if (!ok) return;
    startTransition(async () => {
      if (!(await persist(listing))) return;
      const result = await publishDraftAction(draftId);
      switch (result.status) {
        case "published":
          setMessage({
            tone: "success",
            lines: [
              `Anúncio publicado: ${result.externalId}.`,
              ...(sku ? [`Vinculado ao SKU ${sku.code}.`] : []),
              ...(result.descriptionFailed
                ? ["A descrição não foi aceita agora; ajuste na tela de edição do anúncio."]
                : []),
            ],
          });
          break;
        case "incomplete":
          setMessage({ tone: "error", lines: ["Falta preencher:", ...result.missing] });
          break;
        case "refused":
          setMessage({ tone: "error", lines: ["O Mercado Livre recusou:", ...result.errors] });
          break;
        case "unconfirmed":
          setMessage({
            tone: "signal",
            lines: [
              "O Mercado Livre não confirmou a publicação. Confira em Anúncios (ou no painel do ML) antes de tentar de novo, para não duplicar.",
            ],
          });
          break;
        default:
          setMessage({ tone: "error", lines: [FAILURES[result.status] ?? "Erro."] });
      }
      router.refresh();
    });
  }

  function suggest() {
    startTransition(async () => {
      const result = await suggestCategoriesAction(draftId, query);
      if (result.status !== "ok") {
        setMessage({ tone: "error", lines: [FAILURES[result.status] ?? "Erro."] });
        return;
      }
      setSuggestions(result.suggestions);
      if (!result.suggestions.length) {
        setMessage({
          tone: "signal",
          lines: ["Nenhuma categoria sugerida: tente outras palavras."],
        });
      }
    });
  }

  function chooseCategory(suggestion: CategorySuggestion) {
    startTransition(async () => {
      const result = await categoryAttributesAction(draftId, suggestion.categoryId);
      if (result.status !== "ok") {
        setMessage({ tone: "error", lines: [FAILURES[result.status] ?? "Erro."] });
        return;
      }
      // Keep what is already filled; add what ML inferred from the text (e.g. brand).
      const known = new Map<string, AttributeValue>();
      for (const value of suggestion.attributes) known.set(value.id, value);
      for (const value of loose) known.set(value.id, value);
      for (const definition of definitions ?? []) {
        const check = fromInput(definition, inputs[definition.id] ?? { value: "" });
        if (check.ok && check.value) known.set(definition.id, check.value);
      }
      setInputs(
        Object.fromEntries(
          result.definitions.map((definition) => [
            definition.id,
            toInput(definition, known.get(definition.id)),
          ]),
        ),
      );
      setLoose([...known.values()]);
      setDefinitions(result.definitions);
      setCategoryId(suggestion.categoryId);
      setCategoryName(
        suggestion.domainName
          ? `${suggestion.categoryName} (${suggestion.domainName})`
          : suggestion.categoryName,
      );
      setSuggestions(null);
      setQuotes(null);
    });
  }

  function upload(files: FileList | null) {
    if (!files?.length) return;
    startTransition(async () => {
      for (const file of [...files]) {
        const form = new FormData();
        form.append("file", await shrink(file), file.name.replace(/\.\w+$/, ".jpg"));
        const result = await uploadPictureAction(draftId, form);
        if (result.status !== "ok") {
          setMessage({
            tone: "error",
            lines: [FAILURES[result.status] ?? "Erro ao enviar a foto."],
          });
          return;
        }
        setPictures(result.listing.pictures);
      }
      setMessage({ tone: "success", lines: ["Foto(s) enviada(s) ao Mercado Livre."] });
    });
  }

  function movePicture(index: number, delta: number) {
    setPictures((current) => {
      const next = [...current];
      const [item] = next.splice(index, 1);
      next.splice(Math.max(0, Math.min(next.length, index + delta)), 0, item!);
      return next;
    });
  }

  function simulate() {
    const priceCents = parseBrlToCents(price);
    if (!categoryId || !priceCents) {
      setMessage({
        tone: "signal",
        lines: ["Escolha a categoria e informe o preço para simular."],
      });
      return;
    }
    startTransition(async () => {
      const result = await quoteFeesAction(draftId, categoryId, priceCents);
      if (result.status !== "ok") {
        setMessage({ tone: "error", lines: [FAILURES[result.status] ?? "Erro."] });
        return;
      }
      setQuotes(result.quotes);
    });
  }

  const priceCents = parseBrlToCents(price);
  const disabled = !editable || pending;

  return (
    <div className="flex max-w-4xl flex-col gap-5">
      <fieldset disabled={!editable} className="flex flex-col gap-5">
        <FormSection title="Produto">
          <div className="sm:col-span-2">
            {model === "user_products" ? (
              <Field
                label="Nome da família *"
                name="familyName"
                value={familyName}
                onChange={(event) => setFamilyName(event.target.value)}
                hint="Nome genérico do produto (ex.: “Borracha Panela de Pressão 4,5 L”). No modelo User Products o Mercado Livre monta o título a partir dele e da ficha técnica."
              />
            ) : (
              <Field
                label="Título *"
                name="title"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
              />
            )}
          </div>
          <SelectField
            label="Condição"
            name="condition"
            options={Object.entries(LISTING_CONDITIONS).map(([value, label]) => ({ value, label }))}
            value={condition}
            onChange={(event) => setCondition(event.target.value as "new" | "used")}
          />
        </FormSection>

        <section className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-5">
          <h2 className="font-display text-base font-semibold text-ink">Categoria *</h2>
          {categoryId ? (
            <p className="text-sm text-ink">
              {categoryName ?? categoryId}{" "}
              <span className="text-xs text-muted tabular-nums">({categoryId})</span>
            </p>
          ) : (
            <p className="text-sm text-muted">Ainda não escolhida.</p>
          )}
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Descreva o produto para o Mercado Livre sugerir a categoria"
              aria-label="Texto para sugerir a categoria"
              className="h-10 flex-1 rounded-lg border border-border bg-surface px-3 text-ink outline-none focus:border-brand focus:ring-3 focus:ring-brand/20"
            />
            <button
              type="button"
              onClick={suggest}
              disabled={disabled || !query.trim()}
              className="h-10 rounded-lg border border-border bg-surface px-4 text-sm font-medium text-ink hover:bg-surface-2 disabled:opacity-60"
            >
              Sugerir categoria
            </button>
          </div>
          {suggestions?.length ? (
            <ul className="flex flex-col gap-2">
              {suggestions.map((suggestion) => (
                <li key={suggestion.categoryId}>
                  <button
                    type="button"
                    onClick={() => chooseCategory(suggestion)}
                    disabled={disabled}
                    className="w-full rounded-lg border border-border px-3 py-2 text-left text-sm hover:border-brand hover:bg-surface-2"
                  >
                    <span className="font-medium text-ink">{suggestion.categoryName}</span>
                    {suggestion.domainName ? (
                      <span className="text-muted"> · {suggestion.domainName}</span>
                    ) : null}
                    <span className="ml-2 text-xs text-muted tabular-nums">
                      {suggestion.categoryId}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          {categoryId && definitions && categoryId !== initial.categoryId ? (
            <p className="text-xs text-muted">
              Ao trocar de categoria, a ficha técnica abaixo muda; o que já estava preenchido foi
              mantido quando existe na nova categoria.
            </p>
          ) : null}
        </section>

        <section className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-5">
          <h2 className="font-display text-base font-semibold text-ink">Fotos *</h2>
          {pictures.length ? (
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {pictures.map((picture, index) => (
                <li key={picture.id} className="flex flex-col gap-1">
                  <div className="flex aspect-square items-center justify-center overflow-hidden rounded-lg border border-border bg-bg">
                    {picture.url ? (
                      // eslint-disable-next-line @next/next/no-img-element -- ML-hosted preview
                      <img src={picture.url} alt={`Foto ${index + 1}`} className="object-contain" />
                    ) : (
                      <span className="px-2 text-center text-xs text-muted">{picture.id}</span>
                    )}
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-muted">
                      {index === 0 ? "Principal" : `${index + 1}ª`}
                    </span>
                    <span className="flex gap-1">
                      <button
                        type="button"
                        aria-label="Mover para a esquerda"
                        onClick={() => movePicture(index, -1)}
                        className="text-muted hover:text-ink"
                      >
                        <ArrowLeft className="size-4" />
                      </button>
                      <button
                        type="button"
                        aria-label="Mover para a direita"
                        onClick={() => movePicture(index, 1)}
                        className="text-muted hover:text-ink"
                      >
                        <ArrowRight className="size-4" />
                      </button>
                      <button
                        type="button"
                        aria-label="Remover foto"
                        onClick={() =>
                          setPictures((current) => current.filter((item) => item.id !== picture.id))
                        }
                        className="text-muted hover:text-danger"
                      >
                        <Trash2 className="size-4" />
                      </button>
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          ) : null}
          <label className="inline-flex w-fit cursor-pointer items-center gap-2 rounded-lg border border-border bg-surface px-4 py-2 text-sm font-medium text-ink hover:bg-surface-2">
            <ImagePlus className="size-4" aria-hidden="true" />
            Adicionar fotos
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              multiple
              className="sr-only"
              disabled={disabled}
              onChange={(event) => {
                upload(event.target.files);
                event.target.value = "";
              }}
            />
          </label>
          <p className="text-xs text-muted">
            As fotos vão direto para o Mercado Livre (até 12; a primeira é a principal). Fundo
            branco e produto inteiro ajudam na aprovação. Remover ou reordenar vale ao salvar.
          </p>
        </section>

        {definitions === null ? (
          <p className="rounded-xl border border-dashed border-border bg-surface p-5 text-sm text-muted">
            Escolha a categoria para preencher a ficha técnica.
          </p>
        ) : (
          <>
            {main.length ? (
              <FormSection
                title="Ficha técnica"
                description="Campos com * são obrigatórios na categoria."
              >
                {main.map((definition) => (
                  <AttributeField
                    key={definition.id}
                    definition={definition}
                    input={inputs[definition.id] ?? { value: "" }}
                    error={errors[`attr.${definition.id}`]}
                    onChange={(next) =>
                      setInputs((current) => ({ ...current, [definition.id]: next }))
                    }
                  />
                ))}
              </FormSection>
            ) : null}
            {advanced.length ? (
              <details className="rounded-xl border border-border bg-surface p-5">
                <summary className="cursor-pointer font-display text-base font-semibold text-ink">
                  Avançado ({advanced.length} atributos que o Mercado Livre não mostra no formulário
                  dele)
                </summary>
                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  {advanced.map((definition) => (
                    <AttributeField
                      key={definition.id}
                      definition={definition}
                      input={inputs[definition.id] ?? { value: "" }}
                      error={errors[`attr.${definition.id}`]}
                      onChange={(next) =>
                        setInputs((current) => ({ ...current, [definition.id]: next }))
                      }
                    />
                  ))}
                </div>
              </details>
            ) : null}
          </>
        )}

        <section className="rounded-xl border border-border bg-surface p-5">
          <TextareaField
            label="Descrição"
            name="description"
            rows={8}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            hint="Somente texto simples: sem negrito, cores ou HTML (regra do Mercado Livre)."
          />
        </section>

        <FormSection title="Preço e estoque">
          <Field
            label="Preço (R$) *"
            name="price"
            inputMode="decimal"
            value={price}
            onChange={(event) => {
              setPrice(event.target.value);
              setQuotes(null);
            }}
            error={errors.price}
          />
          <Field
            label="Quantidade inicial"
            name="quantity"
            inputMode="numeric"
            value={quantity}
            onChange={(event) => setQuantity(event.target.value)}
            error={errors.quantity}
            hint={
              sku
                ? `Estoque do SKU ${sku.code} no ERP: ${sku.stockOnHand}. Se a sincronização de estoque estiver ligada, o ERP ajusta depois de publicar.`
                : undefined
            }
          />
          <SelectField
            label="Tipo de anúncio"
            name="listingTypeId"
            options={Object.entries(LISTING_TYPES).map(([value, label]) => ({ value, label }))}
            value={listingTypeId}
            onChange={(event) => setListingTypeId(event.target.value as ListingTypeId)}
          />
          <div className="flex items-end">
            <button
              type="button"
              onClick={simulate}
              disabled={pending}
              className="h-10 rounded-lg border border-border bg-surface px-4 text-sm font-medium text-ink hover:bg-surface-2 disabled:opacity-60"
            >
              Simular tarifa
            </button>
          </div>
          {quotes ? (
            <div className="sm:col-span-2">
              <table className="w-full text-sm">
                <thead className="text-left text-muted">
                  <tr>
                    <th className="py-1 font-medium">Tipo</th>
                    <th className="py-1 text-right font-medium">Tarifa do ML</th>
                    <th className="py-1 text-right font-medium">Você recebe*</th>
                    {sku?.costCents != null ? (
                      <th className="py-1 text-right font-medium">Margem (sem frete)</th>
                    ) : null}
                  </tr>
                </thead>
                <tbody>
                  {quotes.map((quote) => {
                    const receive = (priceCents ?? 0) - quote.saleFeeCents;
                    const margin = sku?.costCents != null ? receive - sku.costCents : null;
                    return (
                      <tr
                        key={quote.listingTypeId}
                        className={quote.listingTypeId === listingTypeId ? "font-medium" : ""}
                      >
                        <td className="py-1 text-ink">
                          {LISTING_TYPES[quote.listingTypeId as ListingTypeId] ??
                            quote.listingTypeName ??
                            quote.listingTypeId}
                        </td>
                        <td className="py-1 text-right text-ink tabular-nums">
                          {formatCents(quote.saleFeeCents)}
                          {quote.percentageFee !== null ? ` (${quote.percentageFee}%)` : ""}
                        </td>
                        <td className="py-1 text-right text-ink tabular-nums">
                          {formatCents(receive)}
                        </td>
                        {margin !== null ? (
                          <td
                            className={`py-1 text-right tabular-nums ${margin < 0 ? "text-signal-ink" : "text-ink"}`}
                          >
                            {formatCents(margin)}
                          </td>
                        ) : null}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <p className="mt-1 text-xs text-muted">
                * Preço menos a tarifa de venda informada pelo Mercado Livre. Não inclui frete nem
                impostos.
              </p>
            </div>
          ) : null}
        </FormSection>

        <FormSection title="Garantia">
          <Field
            label="Tipo de garantia"
            name="warrantyType"
            value={warrantyType}
            onChange={(event) => setWarrantyType(event.target.value)}
            hint="Ex.: Garantia do vendedor, Garantia de fábrica, Sem garantia."
          />
          <Field
            label="Tempo de garantia"
            name="warrantyTime"
            value={warrantyTime}
            onChange={(event) => setWarrantyTime(event.target.value)}
            hint="Ex.: 90 dias."
          />
        </FormSection>
      </fieldset>

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
        {editable ? (
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={save}
              disabled={pending}
              className="inline-flex h-10 items-center gap-2 rounded-lg border border-border bg-surface px-4 text-sm font-medium text-ink hover:bg-surface-2 disabled:opacity-60"
            >
              <Save className="size-4" aria-hidden="true" />
              Salvar rascunho
            </button>
            <button
              type="button"
              onClick={validate}
              disabled={pending}
              className="inline-flex h-10 items-center gap-2 rounded-lg border border-border bg-surface px-4 text-sm font-medium text-ink hover:bg-surface-2 disabled:opacity-60"
            >
              <CheckCircle2 className="size-4" aria-hidden="true" />
              Validar no Mercado Livre
            </button>
            <button
              type="button"
              onClick={publish}
              disabled={pending || !allowWrites}
              title={allowWrites ? undefined : FAILURES.writes_disabled}
              className="inline-flex h-10 items-center gap-2 rounded-lg bg-brand px-4 text-sm font-semibold text-on-brand hover:bg-brand-hover disabled:opacity-60"
            >
              <Rocket className="size-4" aria-hidden="true" />
              {pending ? "Aguarde…" : "Publicar"}
            </button>
            {!allowWrites ? (
              <span className="self-center text-xs text-signal-ink">
                Para publicar, libere as alterações desta conta em{" "}
                <Link href="/contas" className="underline">
                  Contas
                </Link>
                .
              </span>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
