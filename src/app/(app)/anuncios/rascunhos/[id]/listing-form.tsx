"use client";

import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  ImagePlus,
  Plus,
  Rocket,
  Save,
  Trash2,
  X,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";

import { AttributeField } from "@/components/listings/attribute-field";
import { shrinkImage } from "@/components/listings/shrink-image";
import type { CategorySuggestion, FeeQuote } from "@/connectors/types";
import {
  attributeIdsInErrors,
  fromInput,
  sortForForm,
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
import { formatCents, parseBrlToCents } from "@/domain/products/money";
import type { VariantOutcome } from "@/server/listings/draft-service";

import {
  categoryAttributesAction,
  publishDraftAction,
  quoteFeesAction,
  saveDraftAction,
  saveDraftMetaAction,
  suggestCategoriesAction,
  uploadVariantPictureAction,
  validateDraftAction,
} from "../actions";
import {
  combinations,
  comboKey,
  listingFromRows,
  ROW_ATTRIBUTE_IDS,
  rowsFromListing,
  SIMPLE_KEY,
  syncRows,
  type Row,
} from "./form-model";

type Message = { tone: "success" | "error" | "signal"; lines: string[] };

export type AccountOption = {
  id: string;
  nickname: string;
  listingModel: string;
  allowWrites: boolean;
};

const FAMILY_NAME_MAX = 60; // ML max_title_length in most domains
const WARRANTY_TYPES = ["Garantia do vendedor", "Garantia de fábrica", "Sem garantia"];

const OUTCOME_TEXT = {
  published: "publicada",
  already: "já estava publicada",
  refused: "recusada",
  unconfirmed: "sem confirmação do Mercado Livre",
  not_sent: "não enviada",
} as const;

const FAILURES: Record<string, string> = {
  not_found: "Rascunho não encontrado.",
  reconnect: "A conta precisa ser reconectada em Contas de marketplace.",
  marketplace_error: "O Mercado Livre não respondeu. Tente de novo.",
  locked: "Este rascunho já foi publicado (ou está sendo publicado) e não pode mais ser alterado.",
  writes_disabled:
    "As alterações estão bloqueadas para esta conta. Libere em Contas de marketplace para publicar.",
  invalid: "Arquivo inválido (use JPG ou PNG de até 10 MB).",
  account_unavailable: "Essa conta não está conectada.",
};

const outcomeLine = (variant: VariantOutcome) =>
  `• ${variant.label}: ${OUTCOME_TEXT[variant.status]}${variant.externalId ? ` (${variant.externalId})` : ""}${variant.error ? ` — ${variant.error}` : ""}`;

const INPUT =
  "h-9 rounded-lg border border-border bg-surface px-2 text-sm text-ink disabled:opacity-60";

function Section({
  title,
  children,
  actions,
}: {
  title: string;
  children: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-border bg-surface">
      <div className="flex items-center justify-between gap-2 border-b border-border px-5 py-3">
        <h2 className="font-display text-base font-semibold text-ink">{title}</h2>
        {actions}
      </div>
      <div className="flex flex-col gap-4 p-5">{children}</div>
    </section>
  );
}

function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1 sm:grid-cols-[11rem_1fr] sm:items-center sm:gap-4">
      <span className="text-sm text-muted">{label}</span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/** Column header with "Editar em massa" (one value for every unlocked row). */
function BulkHeader({
  label,
  onBulk,
  disabled,
}: {
  label: string;
  onBulk?: () => void;
  disabled?: boolean;
}) {
  return (
    <th className="px-2 py-2 text-left font-medium">
      <span className="block text-ink">{label}</span>
      {onBulk && !disabled ? (
        <button
          type="button"
          onClick={onBulk}
          className="text-xs font-normal text-brand hover:underline"
        >
          Editar em massa
        </button>
      ) : null}
    </th>
  );
}

const rowLabel = (row: Row, ids: string[]) =>
  row.key === SIMPLE_KEY
    ? "Anúncio"
    : ids
        .map((id) => row.attributes.find((attribute) => attribute.id === id)?.valueName)
        .filter(Boolean)
        .join(" / ") || "Variante";

/** The new listing screen: one page in sections (basic data, attributes, variants, photos, sale, description). */
export function ListingForm({
  draftId,
  editable,
  initial,
  initialDefinitions,
  lastErrors,
  varyingIds = [],
  simpleSkuCode,
  skuCodes,
  published,
  accounts,
  initialAccountId,
  initialSupplierUrl,
  costCents,
  origin,
}: {
  draftId: string;
  editable: boolean;
  initial: CanonicalListing;
  initialDefinitions: AttributeDefinition[] | null;
  lastErrors: string[];
  /** "Nova variação": attributes that vary inside the family (must be filled). */
  varyingIds?: string[];
  /** Code of the draft's SKU (simple listing). */
  simpleSkuCode: string | null;
  /** SKU codes suggested on the SKU fields. */
  skuCodes: string[];
  /** Variant key -> marketplace id of the variants already published (locked). */
  published: Record<string, string>;
  accounts: AccountOption[];
  initialAccountId: string;
  initialSupplierUrl: string | null;
  /** Cost of the draft's SKU (only when the member may see costs). */
  costCents: number | null;
  /** "new": opened from Novo anúncio (closing goes to Anúncios); "list": from Rascunhos. */
  origin: "new" | "list";
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<Message | null>(
    lastErrors.length
      ? { tone: "error", lines: ["Última tentativa recusada pelo Mercado Livre:", ...lastErrors] }
      : null,
  );
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Basic data
  const [accountId, setAccountId] = useState(initialAccountId);
  // Kept as it was saved (the field is no longer shown on the screen).
  const supplierUrl = initialSupplierUrl ?? "";
  const [askClose, setAskClose] = useState(false);
  const listHref = origin === "new" ? "/anuncios" : "/anuncios/rascunhos";
  const [familyName, setFamilyName] = useState(initial.familyName);
  const [title, setTitle] = useState(initial.title);
  const [condition, setCondition] = useState(initial.condition);
  const [description, setDescription] = useState(initial.description);
  const account = accounts.find((item) => item.id === accountId);
  const model: PublishModel =
    account?.listingModel === "user_products" ? "user_products" : "traditional";

  // Category and technical sheet
  const [categoryId, setCategoryId] = useState(initial.categoryId);
  const [categoryName, setCategoryName] = useState(initial.categoryName);
  const [definitions, setDefinitions] = useState(initialDefinitions);
  const [categoryOpen, setCategoryOpen] = useState(!initial.categoryId);
  const [query, setQuery] = useState(initial.familyName || initial.title);
  const [suggestions, setSuggestions] = useState<CategorySuggestion[] | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const initialById = useMemo(
    () => new Map(initial.attributes.map((value) => [value.id, value])),
    [initial.attributes],
  );
  const [loose, setLoose] = useState<AttributeValue[]>(initial.attributes);
  const [inputs, setInputs] = useState<Record<string, AttributeInput>>(() =>
    Object.fromEntries(
      (initialDefinitions ?? []).map((definition) => [
        definition.id,
        toInput(definition, initialById.get(definition.id)),
      ]),
    ),
  );

  // Variants
  const [kind, setKind] = useState<"simple" | "variants">(
    initial.variants.length ? "variants" : "simple",
  );
  const [variationIds, setVariationIds] = useState(initial.variationAttributeIds);
  const [rows, setRows] = useState<Row[]>(() => rowsFromListing(initial, simpleSkuCode));
  const [options, setOptions] = useState<Record<string, AttributeValue[]>>(() => {
    const result: Record<string, AttributeValue[]> = {};
    for (const id of initial.variationAttributeIds) {
      const seen = new Map<string, AttributeValue>();
      for (const variant of initial.variants) {
        const value = variant.attributes.find((attribute) => attribute.id === id);
        if (value?.valueName) seen.set(value.valueName.toLowerCase(), value);
      }
      result[id] = [...seen.values()];
    }
    return result;
  });
  const [pickerFor, setPickerFor] = useState<string | null>(null);
  const [customOption, setCustomOption] = useState("");
  const [uploading, setUploading] = useState<string | null>(null);
  const [quotes, setQuotes] = useState<FeeQuote[] | null>(null);
  const anyPublished = Object.keys(published).length > 0;

  const byId = useMemo(
    () => new Map((definitions ?? []).map((definition) => [definition.id, definition])),
    [definitions],
  );

  // Technical sheet split: what the rows edit, what varies, required, and "Mais atributos".
  const { varying, required, more } = useMemo(() => {
    const editableDefs = (definitions ?? []).filter(
      (definition) => !definition.readOnly && !ROW_ATTRIBUTE_IDS.has(definition.id),
    );
    const inRows = (id: string) => kind === "variants" && variationIds.includes(id);
    const isVarying = (id: string) => kind === "simple" && varyingIds.includes(id);
    const rest = editableDefs.filter(
      (definition) => !inRows(definition.id) && !isVarying(definition.id),
    );
    return {
      varying: editableDefs.filter((definition) => isVarying(definition.id)),
      required: sortForForm(
        rest.filter(
          (definition) =>
            !definition.hidden && (definition.required || definition.conditionalRequired),
        ),
      ),
      more: rest.filter(
        (definition) =>
          definition.hidden || (!definition.required && !definition.conditionalRequired),
      ),
    };
  }, [definitions, kind, variationIds, varyingIds]);

  const candidates = (definitions ?? []).filter(
    (definition) => definition.allowsVariations && !definition.readOnly,
  );
  const emptyGtinReasons = byId.get("EMPTY_GTIN_REASON")?.values ?? [];

  // ---------- rows helpers ----------
  const locked = (row: Row) => !editable || Boolean(published[row.key]);
  const updateRow = (key: string, change: Partial<Row>) =>
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...change } : row)));
  const bulk = (field: keyof Row, label: string) => () => {
    const value = window.prompt(`${label}: valor para todas as variantes`);
    if (value === null) return;
    setRows((current) => current.map((row) => (locked(row) ? row : { ...row, [field]: value })));
  };

  function applyOptions(nextIds: string[], nextOptions: Record<string, AttributeValue[]>) {
    const active = nextIds.filter((id) => (nextOptions[id] ?? []).length > 0);
    const combos = combinations(active, nextOptions);
    setRows((current) => {
      const synced = syncRows(current, active, combos);
      // Rows already published are never dropped.
      const keptPublished = current.filter(
        (row) => published[row.key] && !synced.some((item) => item.key === row.key),
      );
      return [...keptPublished, ...synced];
    });
  }

  function toggleOption(id: string, value: AttributeValue) {
    const current = options[id] ?? [];
    const exists = current.some(
      (item) => item.valueName?.toLowerCase() === value.valueName?.toLowerCase(),
    );
    const next = {
      ...options,
      [id]: exists
        ? current.filter((item) => item.valueName?.toLowerCase() !== value.valueName?.toLowerCase())
        : [...current, value],
    };
    setOptions(next);
    applyOptions(variationIds, next);
  }

  function addVariation(id: string) {
    if (variationIds.includes(id) || variationIds.length >= 5) return;
    const next = [...variationIds, id];
    setVariationIds(next);
    setOptions((current) => ({ ...current, [id]: current[id] ?? [] }));
    setPickerFor(id);
  }

  function removeVariation(id: string) {
    const nextIds = variationIds.filter((item) => item !== id);
    const nextOptions = { ...options };
    delete nextOptions[id];
    setVariationIds(nextIds);
    setOptions(nextOptions);
    setRows((current) =>
      current.map((row) => ({
        ...row,
        attributes: row.attributes.filter((attribute) => attribute.id !== id),
      })),
    );
    applyOptions(nextIds, nextOptions);
    if (pickerFor === id) setPickerFor(null);
  }

  function switchKind(next: "simple" | "variants") {
    if (next === kind) return;
    setKind(next);
    if (next === "simple") {
      const first = rows[0];
      setRows(
        first
          ? [{ ...first, key: SIMPLE_KEY, attributes: [] }]
          : rowsFromListing(initial, simpleSkuCode),
      );
    }
    // To variants: rows appear as options are chosen (the simple row is the template).
  }

  // ---------- collect / persist ----------
  function collect(): CanonicalListing | null {
    const fieldErrors: Record<string, string> = {};
    let attributes: AttributeValue[] = loose;
    if (definitions) {
      attributes = [];
      for (const definition of definitions) {
        if (definition.readOnly || ROW_ATTRIBUTE_IDS.has(definition.id)) continue;
        if (kind === "variants" && variationIds.includes(definition.id)) continue;
        const check = fromInput(definition, inputs[definition.id] ?? { value: "" });
        if (!check.ok) fieldErrors[`attr.${definition.id}`] = check.error;
        else if (check.value) attributes.push(check.value);
      }
    }
    for (const definition of varying) {
      const input = inputs[definition.id];
      if (!input?.notApplicable && !input?.value.trim()) {
        fieldErrors[`attr.${definition.id}`] = "Preencha: é o que muda nesta variação.";
      }
    }
    if (kind === "variants" && rows.length === 0) {
      fieldErrors.variants = "Escolha as opções das variantes (ex.: as cores).";
    }
    const built = listingFromRows(
      {
        familyName: familyName.trim(),
        title: title.trim(),
        categoryId,
        categoryName,
        condition,
        attributes,
        description,
      },
      kind,
      variationIds,
      kind === "variants" ? rows : rows.slice(0, 1),
    );
    if ("errors" in built) Object.assign(fieldErrors, built.errors);
    setErrors(fieldErrors);
    if (Object.keys(fieldErrors).length || !("listing" in built)) {
      setMessage({ tone: "error", lines: ["Confira os campos marcados em vermelho."] });
      return null;
    }
    return built.listing;
  }

  async function persist(listing: CanonicalListing): Promise<boolean> {
    const meta = await saveDraftMetaAction(draftId, { supplierUrl, accountId });
    if (meta !== "saved") {
      setMessage({
        tone: "error",
        lines: [meta === "invalid" ? "Link do fornecedor inválido." : (FAILURES[meta] ?? "Erro.")],
      });
      return false;
    }
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

  function markRefused(messages: string[]) {
    const ids = attributeIdsInErrors(messages, new Set(byId.keys()));
    if (!ids.length) return;
    setErrors((current) => ({
      ...current,
      ...Object.fromEntries(ids.map((id) => [`attr.${id}`, "O Mercado Livre exige este campo."])),
    }));
    if (ids.some((id) => more.some((definition) => definition.id === id))) setMoreOpen(true);
  }

  function save() {
    const listing = collect();
    if (!listing) return;
    startTransition(async () => {
      if (await persist(listing)) {
        setMessage({ tone: "success", lines: ["Rascunho salvo."] });
        // New listing: ask where to go (draft list or close back to Anúncios).
        if (origin === "new") setAskClose(true);
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
            lines: [
              "O Mercado Livre validou o anúncio: pode publicar.",
              ...(result.warnings.length
                ? [
                    "Avisos gerais do Mercado Livre (não impedem a publicação):",
                    ...result.warnings.map((warning) => `• ${warning}`),
                  ]
                : []),
            ],
          });
          break;
        case "incomplete":
          setMessage({ tone: "error", lines: ["Falta preencher:", ...result.missing] });
          break;
        case "refused":
          setMessage({
            tone: "error",
            lines: ["O Mercado Livre apontou (campos marcados em vermelho):", ...result.errors],
          });
          markRefused(result.errors);
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
    const count = listing.variants.length;
    const ok = window.confirm(
      count
        ? `Publicar ${count} variantes no Mercado Livre agora? Cada uma vira um anúncio da mesma família.`
        : "Publicar este anúncio no Mercado Livre agora? Ele fica visível para compradores assim que o Mercado Livre aprovar.",
    );
    if (!ok) return;
    startTransition(async () => {
      if (!(await persist(listing))) return;
      const result = await publishDraftAction(draftId);
      switch (result.status) {
        case "partial":
          setMessage({
            tone: "signal",
            lines: [
              `Publicadas ${result.listingIds.length} de ${result.variants.length} variantes. Corrija as que faltaram e publique de novo: só elas serão enviadas.`,
              ...result.variants.map(outcomeLine),
            ],
          });
          markRefused(result.variants.flatMap((variant) => (variant.error ? [variant.error] : [])));
          break;
        case "published": {
          const lines = [
            result.variants.length
              ? `Família publicada: ${result.variants.length} variantes.`
              : `Anúncio publicado: ${result.externalId}.`,
            ...result.variants.map(outcomeLine),
            ...(result.descriptionFailed
              ? ["A descrição não foi aceita agora; ajuste na edição do anúncio."]
              : []),
            ...(result.family === "same" ? ["Tudo ficou na mesma família no Mercado Livre."] : []),
            ...(result.family === "unknown"
              ? ["O Mercado Livre ainda não informou a família; confira em alguns minutos."]
              : []),
          ];
          // All good: close the page and go back to the list (warnings keep it open).
          if (result.family !== "different" && !result.descriptionFailed) {
            const mlb = result.externalId ?? result.variants[0]?.externalId ?? "";
            router.push(`${listHref}?aviso=publicado${mlb ? `&mlb=${mlb}` : ""}`);
            return;
          }
          setMessage(
            result.family === "different"
              ? {
                  tone: "signal",
                  lines: [
                    ...lines,
                    "Atenção: o Mercado Livre não deixou tudo na mesma família (algum atributo principal ficou diferente).",
                  ],
                }
              : { tone: "success", lines },
          );
          break;
        }
        case "incomplete":
          setMessage({ tone: "error", lines: ["Falta preencher:", ...result.missing] });
          break;
        case "refused":
          setMessage({ tone: "error", lines: ["O Mercado Livre recusou:", ...result.errors] });
          markRefused(result.errors);
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

  // ---------- category ----------
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
          ? `${suggestion.domainName} > ${suggestion.categoryName}`
          : suggestion.categoryName,
      );
      setSuggestions(null);
      setCategoryOpen(false);
      setQuotes(null);
    });
  }

  // ---------- pictures ----------
  function upload(key: string, files: FileList) {
    setUploading(key);
    startTransition(async () => {
      const added: CanonicalListing["pictures"] = [];
      for (const file of [...files]) {
        const form = new FormData();
        form.append("file", await shrinkImage(file), file.name.replace(/\.\w+$/, ".jpg"));
        const result = await uploadVariantPictureAction(draftId, form);
        if (result.status !== "ok") {
          setMessage({
            tone: "error",
            lines: [FAILURES[result.status] ?? "Erro ao enviar a foto."],
          });
          break;
        }
        added.push(result.picture);
      }
      setRows((current) =>
        current.map((row) =>
          row.key === key ? { ...row, pictures: [...row.pictures, ...added].slice(0, 12) } : row,
        ),
      );
      setUploading(null);
    });
  }

  function movePicture(key: string, index: number, delta: number) {
    setRows((current) =>
      current.map((row) => {
        if (row.key !== key) return row;
        const next = [...row.pictures];
        const [item] = next.splice(index, 1);
        next.splice(Math.max(0, Math.min(next.length, index + delta)), 0, item!);
        return { ...row, pictures: next };
      }),
    );
  }

  function copyPictures(from: Row, target: string) {
    setRows((current) =>
      current.map((row) =>
        row.key !== from.key && !locked(row) && (target === "all" || target === row.key)
          ? { ...row, pictures: [...from.pictures] }
          : row,
      ),
    );
  }

  function simulate() {
    const priceCents = parseBrlToCents(rows[0]?.price ?? "");
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

  const shownRows = kind === "variants" ? rows : rows.slice(0, 1);
  const err = (row: Row, field: string) => errors[`row.${row.key}.${field}`];
  const attributeField = (definition: AttributeDefinition) => (
    <AttributeField
      key={definition.id}
      definition={definition}
      input={inputs[definition.id] ?? { value: "" }}
      error={errors[`attr.${definition.id}`]}
      onChange={(next) => setInputs((current) => ({ ...current, [definition.id]: next }))}
    />
  );
  const firstPrice = parseBrlToCents(rows[0]?.price ?? "");

  return (
    <div className="flex max-w-6xl flex-col gap-5">
      <datalist id="sku-codes">
        {skuCodes.map((code) => (
          <option key={code} value={code} />
        ))}
      </datalist>

      <fieldset disabled={!editable} className="flex min-w-0 flex-col gap-5">
        {/* 1. Informação básica */}
        <Section title="Informação básica">
          <FieldRow label="Conta *">
            <select
              value={accountId}
              onChange={(event) => setAccountId(event.target.value)}
              disabled={anyPublished}
              className={`${INPUT} w-full max-w-md`}
            >
              {accounts.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.nickname}
                  {item.listingModel === "user_products" ? " (User Products)" : ""}
                  {item.allowWrites ? "" : " — alterações bloqueadas"}
                </option>
              ))}
            </select>
          </FieldRow>
          <FieldRow label={model === "user_products" ? "Nome da família *" : "Título *"}>
            <div className="flex max-w-2xl items-center gap-2">
              <input
                value={model === "user_products" ? familyName : title}
                onChange={(event) =>
                  model === "user_products"
                    ? setFamilyName(event.target.value)
                    : setTitle(event.target.value)
                }
                className={`${INPUT} w-full`}
              />
              <span
                className={`text-xs tabular-nums ${
                  (model === "user_products" ? familyName : title).length > FAMILY_NAME_MAX
                    ? "text-signal-ink"
                    : "text-muted"
                }`}
              >
                {(model === "user_products" ? familyName : title).length}/{FAMILY_NAME_MAX}
              </span>
            </div>
          </FieldRow>
          <FieldRow label="Categoria *">
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center gap-3">
                <span className={`text-sm ${categoryId ? "text-ink" : "text-muted"}`}>
                  {categoryName ?? (categoryId ? categoryId : "Nenhuma categoria escolhida")}
                  {categoryId ? (
                    <span className="ml-1 text-xs text-muted">({categoryId})</span>
                  ) : null}
                </span>
                <button
                  type="button"
                  onClick={() => setCategoryOpen((value) => !value)}
                  className="text-sm text-brand hover:underline"
                >
                  Selecionar categoria
                </button>
              </div>
              {categoryOpen ? (
                <div className="flex flex-col gap-2 rounded-lg border border-border bg-bg p-3">
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <input
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      placeholder="Descreva o produto para o Mercado Livre sugerir a categoria"
                      className={`${INPUT} flex-1`}
                    />
                    <button
                      type="button"
                      onClick={suggest}
                      disabled={pending || !query.trim()}
                      className="h-9 rounded-lg border border-border bg-surface px-3 text-sm font-medium text-ink hover:bg-surface-2"
                    >
                      Sugerir
                    </button>
                  </div>
                  {suggestions?.map((suggestion) => (
                    <button
                      key={suggestion.categoryId}
                      type="button"
                      onClick={() => chooseCategory(suggestion)}
                      className="rounded-lg border border-border bg-surface px-3 py-2 text-left text-sm hover:border-brand"
                    >
                      <span className="text-muted">
                        {suggestion.domainName ? `${suggestion.domainName} > ` : ""}
                      </span>
                      <span className="font-medium text-ink">{suggestion.categoryName}</span>
                      <span className="ml-2 text-xs text-muted">{suggestion.categoryId}</span>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          </FieldRow>
          <FieldRow label="Condição *">
            <select
              value={condition}
              onChange={(event) => setCondition(event.target.value as "new" | "used")}
              className={`${INPUT} w-48`}
            >
              {Object.entries(LISTING_CONDITIONS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </FieldRow>
        </Section>

        {/* 2. Atributos */}
        <Section title="Atributos">
          {definitions === null ? (
            <p className="text-sm text-muted">
              Escolha a categoria para preencher a ficha técnica.
            </p>
          ) : (
            <>
              {varying.length ? (
                <div className="flex flex-col gap-3 rounded-lg border-2 border-brand p-4">
                  <p className="text-sm font-medium text-ink">
                    O que muda nesta variação *{" "}
                    <span className="font-normal text-muted">
                      (os demais devem ficar iguais ao original)
                    </span>
                  </p>
                  <div className="grid gap-4 sm:grid-cols-2">{varying.map(attributeField)}</div>
                </div>
              ) : null}
              {required.length ? (
                <div className="grid gap-4 sm:grid-cols-2">{required.map(attributeField)}</div>
              ) : (
                <p className="text-sm text-muted">Esta categoria não tem atributos obrigatórios.</p>
              )}
              {more.length ? (
                <div className="flex flex-col gap-4">
                  <button
                    type="button"
                    onClick={() => setMoreOpen((value) => !value)}
                    className="inline-flex items-center gap-1 self-center text-sm text-brand hover:underline"
                  >
                    {moreOpen ? "Menos atributos" : `Mais atributos (${more.length})`}
                    <ChevronDown
                      className={`size-4 transition-transform ${moreOpen ? "rotate-180" : ""}`}
                    />
                  </button>
                  {moreOpen ? (
                    <div className="grid gap-4 sm:grid-cols-2">{more.map(attributeField)}</div>
                  ) : null}
                </div>
              ) : null}
            </>
          )}
        </Section>

        {/* 3. Informação do anúncio */}
        <Section title="Informação do anúncio">
          {model === "user_products" ? (
            <FieldRow label="Tipo">
              <div className="flex gap-5 text-sm">
                <label className="flex items-center gap-1.5 text-ink">
                  <input
                    type="radio"
                    checked={kind === "simple"}
                    disabled={anyPublished}
                    onChange={() => switchKind("simple")}
                  />
                  Simples
                </label>
                <label className="flex items-center gap-1.5 text-ink">
                  <input
                    type="radio"
                    checked={kind === "variants"}
                    onChange={() => switchKind("variants")}
                  />
                  Variantes
                </label>
              </div>
            </FieldRow>
          ) : null}

          {kind === "variants" ? (
            <FieldRow label="Variantes">
              {definitions === null ? (
                <span className="text-sm text-muted">
                  Escolha a categoria para ver o que pode variar.
                </span>
              ) : (
                <div className="flex flex-col gap-3">
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    {variationIds.map((id) => (
                      <span key={id} className="inline-flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => setPickerFor(pickerFor === id ? null : id)}
                          className={`rounded-full px-3 py-1 font-medium ${
                            pickerFor === id
                              ? "bg-brand text-on-brand"
                              : "border border-brand text-brand"
                          }`}
                        >
                          {byId.get(id)?.name ?? id} ({(options[id] ?? []).length})
                        </button>
                        {!anyPublished ? (
                          <button
                            type="button"
                            aria-label={`Remover ${byId.get(id)?.name ?? id}`}
                            onClick={() => removeVariation(id)}
                            className="text-muted hover:text-danger"
                          >
                            <X className="size-4" />
                          </button>
                        ) : null}
                      </span>
                    ))}
                    {variationIds.length < 5
                      ? candidates
                          .filter((definition) => !variationIds.includes(definition.id))
                          .map((definition) => (
                            <button
                              key={definition.id}
                              type="button"
                              onClick={() => addVariation(definition.id)}
                              className="inline-flex items-center gap-1 text-brand hover:underline"
                            >
                              <Plus className="size-3.5" /> {definition.name}
                            </button>
                          ))
                      : null}
                    {candidates.length === 0 ? (
                      <span className="text-signal-ink">
                        Esta categoria não indica atributos de variação.
                      </span>
                    ) : null}
                  </div>

                  {pickerFor ? (
                    <div className="rounded-lg border border-border bg-bg p-3">
                      <div className="mb-2 flex items-center justify-between">
                        <span className="font-medium text-ink">
                          {byId.get(pickerFor)?.name ?? pickerFor}
                        </span>
                        <button
                          type="button"
                          aria-label="Fechar"
                          onClick={() => setPickerFor(null)}
                          className="text-muted hover:text-ink"
                        >
                          <X className="size-4" />
                        </button>
                      </div>
                      <div className="grid max-h-56 grid-cols-2 gap-x-4 gap-y-2 overflow-y-auto text-sm sm:grid-cols-4 lg:grid-cols-5">
                        {[
                          ...(byId.get(pickerFor)?.values ?? []).map((value) => ({
                            id: pickerFor,
                            valueId: value.id,
                            valueName: value.name,
                          })),
                          ...(options[pickerFor] ?? []).filter(
                            (option) =>
                              !(byId.get(pickerFor)?.values ?? []).some(
                                (value) =>
                                  value.name.toLowerCase() === option.valueName?.toLowerCase(),
                              ),
                          ),
                        ].map((value) => (
                          <label
                            key={`${value.valueId ?? ""}-${value.valueName}`}
                            className="flex items-center gap-2 truncate text-ink"
                          >
                            <input
                              type="checkbox"
                              checked={(options[pickerFor] ?? []).some(
                                (option) =>
                                  option.valueName?.toLowerCase() ===
                                  value.valueName?.toLowerCase(),
                              )}
                              disabled={rows.some(
                                (row) =>
                                  published[row.key] &&
                                  row.attributes.some(
                                    (attribute) =>
                                      attribute.id === pickerFor &&
                                      attribute.valueName?.toLowerCase() ===
                                        value.valueName?.toLowerCase(),
                                  ),
                              )}
                              onChange={() => toggleOption(pickerFor, value)}
                            />
                            <span className="truncate">{value.valueName}</span>
                          </label>
                        ))}
                      </div>
                      <div className="mt-3 flex gap-2">
                        <input
                          value={customOption}
                          onChange={(event) => setCustomOption(event.target.value)}
                          placeholder="Adicionar opção (ex.: Coral)"
                          className={`${INPUT} w-56`}
                        />
                        <button
                          type="button"
                          onClick={() => {
                            if (!customOption.trim()) return;
                            toggleOption(pickerFor, {
                              id: pickerFor,
                              valueId: null,
                              valueName: customOption.trim(),
                            });
                            setCustomOption("");
                          }}
                          className="text-sm text-brand hover:underline"
                        >
                          Adicionar opção
                        </button>
                      </div>
                    </div>
                  ) : null}
                  {errors.variants ? (
                    <p className="text-sm text-danger">{errors.variants}</p>
                  ) : null}
                </div>
              )}
            </FieldRow>
          ) : null}

          {shownRows.length ? (
            <div className="flex flex-col gap-2">
              <p className="text-sm font-medium text-ink">
                {kind === "variants"
                  ? `Lista de variantes (${shownRows.length})`
                  : "Dados do anúncio"}
              </p>
              <p className="text-xs text-muted">
                Informe o tamanho e o peso reais do pacote para evitar falhas na publicação e no
                frete.
              </p>
              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="w-full text-sm">
                  <thead className="bg-bg text-muted">
                    <tr>
                      {kind === "variants" ? (
                        <th className="px-2 py-2 text-left font-medium">Variante</th>
                      ) : null}
                      <BulkHeader
                        label="SKU"
                        onBulk={kind === "variants" ? bulk("skuCode", "SKU") : undefined}
                      />
                      <th className="px-2 py-2 text-left font-medium">Código de barras</th>
                      <BulkHeader
                        label="Quantidade *"
                        onBulk={kind === "variants" ? bulk("quantity", "Quantidade") : undefined}
                      />
                      <BulkHeader
                        label="Peso do pacote (g)"
                        onBulk={kind === "variants" ? bulk("weight", "Peso (g)") : undefined}
                      />
                      <th className="px-2 py-2 text-left font-medium">
                        <span className="block text-ink">Dimensões do pacote (cm)</span>
                        {kind === "variants" ? (
                          <button
                            type="button"
                            onClick={() => {
                              const value = window.prompt(
                                "Dimensões para todas as variantes (altura x largura x comprimento, ex.: 25x20x25)",
                              );
                              const parts = value
                                ?.toLowerCase()
                                .split("x")
                                .map((part) => part.trim());
                              if (!parts || parts.length !== 3) return;
                              setRows((current) =>
                                current.map((row) =>
                                  locked(row)
                                    ? row
                                    : {
                                        ...row,
                                        height: parts[0]!,
                                        width: parts[1]!,
                                        length: parts[2]!,
                                      },
                                ),
                              );
                            }}
                            className="text-xs font-normal text-brand hover:underline"
                          >
                            Editar em massa
                          </button>
                        ) : null}
                      </th>
                      {kind === "variants" ? <th className="px-2 py-2" /> : null}
                    </tr>
                  </thead>
                  <tbody>
                    {shownRows.map((row) => (
                      <tr key={row.key} className="border-t border-border align-top">
                        {kind === "variants" ? (
                          <td className="px-2 py-2 font-medium text-ink">
                            {rowLabel(row, variationIds)}
                            {published[row.key] ? (
                              <span className="block text-xs font-normal text-success">
                                Publicada {published[row.key]}
                              </span>
                            ) : null}
                          </td>
                        ) : null}
                        <td className="px-2 py-2">
                          <input
                            value={row.skuCode}
                            onChange={(event) =>
                              updateRow(row.key, { skuCode: event.target.value })
                            }
                            list="sku-codes"
                            disabled={locked(row)}
                            placeholder="código"
                            className={`${INPUT} w-32 uppercase`}
                          />
                        </td>
                        <td className="px-2 py-2">
                          {row.emptyGtinReason !== null ? (
                            <select
                              value={row.emptyGtinReason}
                              onChange={(event) =>
                                updateRow(row.key, { emptyGtinReason: event.target.value })
                              }
                              disabled={locked(row)}
                              className={`${INPUT} w-44`}
                            >
                              {emptyGtinReasons.map((reason) => (
                                <option key={reason.id} value={reason.name}>
                                  {reason.name}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <input
                              value={row.gtin}
                              onChange={(event) => updateRow(row.key, { gtin: event.target.value })}
                              disabled={locked(row)}
                              inputMode="numeric"
                              placeholder="EAN, UPC ou outro GTIN"
                              className={`${INPUT} w-44`}
                            />
                          )}
                          <label className="mt-1 flex items-center gap-1 text-xs text-muted">
                            <input
                              type="checkbox"
                              checked={row.emptyGtinReason !== null}
                              disabled={locked(row) || emptyGtinReasons.length === 0}
                              onChange={(event) =>
                                updateRow(row.key, {
                                  gtin: "",
                                  emptyGtinReason: event.target.checked
                                    ? (emptyGtinReasons[0]?.name ?? null)
                                    : null,
                                })
                              }
                            />
                            Não tenho agora
                          </label>
                        </td>
                        <td className="px-2 py-2">
                          <input
                            value={row.quantity}
                            onChange={(event) =>
                              updateRow(row.key, { quantity: event.target.value })
                            }
                            disabled={locked(row)}
                            inputMode="numeric"
                            className={`${INPUT} w-20 ${err(row, "quantity") ? "border-danger" : ""}`}
                          />
                        </td>
                        <td className="px-2 py-2">
                          <input
                            value={row.weight}
                            onChange={(event) => updateRow(row.key, { weight: event.target.value })}
                            disabled={locked(row)}
                            inputMode="numeric"
                            className={`${INPUT} w-24 ${err(row, "weightG") ? "border-danger" : ""}`}
                          />
                        </td>
                        <td className="px-2 py-2 whitespace-nowrap">
                          {(["height", "width", "length"] as const).map((field, index) => (
                            <span key={field}>
                              {index ? <span className="px-1 text-muted">×</span> : null}
                              <input
                                value={row[field]}
                                onChange={(event) =>
                                  updateRow(row.key, { [field]: event.target.value })
                                }
                                disabled={locked(row)}
                                inputMode="numeric"
                                aria-label={
                                  field === "height"
                                    ? "Altura (cm)"
                                    : field === "width"
                                      ? "Largura (cm)"
                                      : "Comprimento (cm)"
                                }
                                className={`${INPUT} w-14 ${
                                  err(
                                    row,
                                    field === "height"
                                      ? "heightCm"
                                      : field === "width"
                                        ? "widthCm"
                                        : "lengthCm",
                                  )
                                    ? "border-danger"
                                    : ""
                                }`}
                              />
                            </span>
                          ))}
                        </td>
                        {kind === "variants" ? (
                          <td className="px-2 py-2">
                            {!locked(row) ? (
                              <button
                                type="button"
                                aria-label={`Remover ${rowLabel(row, variationIds)}`}
                                onClick={() => {
                                  setRows((current) =>
                                    current.filter((item) => item.key !== row.key),
                                  );
                                  setOptions((current) => {
                                    const next = { ...current };
                                    // Remove the option only when no other row uses it.
                                    for (const attribute of row.attributes) {
                                      const used = rows.some(
                                        (other) =>
                                          other.key !== row.key &&
                                          comboKey(other.attributes, [attribute.id]) ===
                                            comboKey([attribute], [attribute.id]),
                                      );
                                      if (!used) {
                                        next[attribute.id] = (next[attribute.id] ?? []).filter(
                                          (option) =>
                                            option.valueName?.toLowerCase() !==
                                            attribute.valueName?.toLowerCase(),
                                        );
                                      }
                                    }
                                    return next;
                                  });
                                }}
                                className="text-muted hover:text-danger"
                              >
                                <Trash2 className="size-4" />
                              </button>
                            ) : null}
                          </td>
                        ) : null}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}
        </Section>

        {/* 4. Imagens */}
        <Section title={kind === "variants" ? "Imagens da variação *" : "Imagens *"}>
          {shownRows.length === 0 ? (
            <p className="text-sm text-muted">
              As variantes aparecem aqui depois de escolher as opções.
            </p>
          ) : null}
          {shownRows.map((row) => (
            <div
              key={row.key}
              className="flex flex-col gap-2 rounded-lg border border-border bg-bg p-3"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-medium text-ink">
                  {rowLabel(row, variationIds)}{" "}
                  <span className="font-normal text-muted">({row.pictures.length}/12)</span>
                </span>
                <div className="flex items-center gap-3">
                  {!locked(row) ? (
                    <label className="inline-flex cursor-pointer items-center gap-1 text-sm text-brand hover:underline">
                      <ImagePlus className="size-4" aria-hidden="true" />
                      Adicionar imagens
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        multiple
                        className="sr-only"
                        disabled={uploading !== null}
                        onChange={(event) => {
                          if (event.target.files?.length) upload(row.key, event.target.files);
                          event.target.value = "";
                        }}
                      />
                    </label>
                  ) : null}
                  {kind === "variants" && row.pictures.length && shownRows.length > 1 ? (
                    <select
                      value=""
                      onChange={(event) =>
                        event.target.value && copyPictures(row, event.target.value)
                      }
                      className="h-8 rounded-lg border border-border bg-surface px-2 text-xs text-brand"
                      aria-label="Copiar imagens para"
                    >
                      <option value="">Copiar imagens para…</option>
                      <option value="all">Todas as outras variantes</option>
                      {shownRows
                        .filter((other) => other.key !== row.key && !locked(other))
                        .map((other) => (
                          <option key={other.key} value={other.key}>
                            {rowLabel(other, variationIds)}
                          </option>
                        ))}
                    </select>
                  ) : null}
                </div>
              </div>
              {uploading === row.key ? (
                <span className="text-xs text-muted">Enviando ao Mercado Livre…</span>
              ) : null}
              {row.pictures.length ? (
                <ul className="flex flex-wrap gap-2">
                  {row.pictures.map((picture, index) => (
                    <li
                      key={`${picture.id ?? picture.url}-${index}`}
                      className="flex w-24 flex-col items-center gap-1"
                    >
                      <div className="flex size-24 items-center justify-center overflow-hidden rounded-lg border border-border bg-white">
                        {picture.url ? (
                          // eslint-disable-next-line @next/next/no-img-element -- ML-hosted preview
                          <img src={picture.url} alt="" className="max-h-full object-contain" />
                        ) : (
                          <span className="px-1 text-center text-[10px] text-muted">
                            {picture.id}
                          </span>
                        )}
                      </div>
                      {!locked(row) ? (
                        <span className="flex gap-1 text-muted">
                          <button
                            type="button"
                            aria-label="Mover para a esquerda"
                            onClick={() => movePicture(row.key, index, -1)}
                            className="hover:text-ink"
                          >
                            <ArrowLeft className="size-3.5" />
                          </button>
                          <button
                            type="button"
                            aria-label="Mover para a direita"
                            onClick={() => movePicture(row.key, index, 1)}
                            className="hover:text-ink"
                          >
                            <ArrowRight className="size-3.5" />
                          </button>
                          <button
                            type="button"
                            aria-label="Remover foto"
                            onClick={() =>
                              updateRow(row.key, {
                                pictures: row.pictures.filter((_, position) => position !== index),
                              })
                            }
                            className="hover:text-danger"
                          >
                            <Trash2 className="size-3.5" />
                          </button>
                        </span>
                      ) : null}
                      {index === 0 ? (
                        <span className="text-[10px] text-muted">principal</span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-muted">
                  Nenhuma foto. Fundo branco e produto inteiro ajudam na aprovação.
                </p>
              )}
            </div>
          ))}
        </Section>

        {/* 5. Informações de venda */}
        <Section
          title="Informações de venda"
          actions={
            <button
              type="button"
              onClick={simulate}
              disabled={pending}
              className="h-8 rounded-lg border border-border bg-surface px-3 text-xs font-medium text-ink hover:bg-surface-2"
            >
              Simular tarifa
            </button>
          }
        >
          {shownRows.length ? (
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-sm">
                <thead className="bg-bg text-muted">
                  <tr>
                    {kind === "variants" ? (
                      <th className="px-2 py-2 text-left font-medium">Variante</th>
                    ) : null}
                    <BulkHeader
                      label="Preço (R$) *"
                      onBulk={kind === "variants" ? bulk("price", "Preço") : undefined}
                    />
                    <BulkHeader
                      label="Tipo de anúncio *"
                      onBulk={
                        kind === "variants"
                          ? () => {
                              const value = window.prompt(
                                "Tipo para todas: 1 = Clássico, 2 = Premium",
                              );
                              const type =
                                value === "2" ? "gold_pro" : value === "1" ? "gold_special" : null;
                              if (type)
                                setRows((current) =>
                                  current.map((row) =>
                                    locked(row) ? row : { ...row, listingTypeId: type },
                                  ),
                                );
                            }
                          : undefined
                      }
                    />
                    <BulkHeader
                      label="Garantia"
                      onBulk={
                        kind === "variants"
                          ? () => {
                              const first = shownRows[0];
                              if (!first) return;
                              setRows((current) =>
                                current.map((row) =>
                                  locked(row)
                                    ? row
                                    : {
                                        ...row,
                                        warrantyType: first.warrantyType,
                                        warrantyTime: first.warrantyTime,
                                      },
                                ),
                              );
                            }
                          : undefined
                      }
                    />
                  </tr>
                </thead>
                <tbody>
                  {shownRows.map((row) => (
                    <tr key={row.key} className="border-t border-border">
                      {kind === "variants" ? (
                        <td className="px-2 py-2 font-medium text-ink">
                          {rowLabel(row, variationIds)}
                        </td>
                      ) : null}
                      <td className="px-2 py-2">
                        <input
                          value={row.price}
                          onChange={(event) => {
                            updateRow(row.key, { price: event.target.value });
                            setQuotes(null);
                          }}
                          disabled={locked(row)}
                          inputMode="decimal"
                          placeholder="0,00"
                          className={`${INPUT} w-28 ${err(row, "price") ? "border-danger" : ""}`}
                        />
                      </td>
                      <td className="px-2 py-2">
                        <select
                          value={row.listingTypeId}
                          onChange={(event) =>
                            updateRow(row.key, {
                              listingTypeId: event.target.value as ListingTypeId,
                            })
                          }
                          disabled={locked(row)}
                          className={`${INPUT} w-32`}
                        >
                          {Object.entries(LISTING_TYPES).map(([value, label]) => (
                            <option key={value} value={value}>
                              {label}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-2 py-2">
                        <div className="flex flex-wrap gap-2">
                          <select
                            value={row.warrantyType}
                            onChange={(event) =>
                              updateRow(row.key, {
                                warrantyType: event.target.value,
                                warrantyTime:
                                  event.target.value === "Sem garantia" ? "" : row.warrantyTime,
                              })
                            }
                            disabled={locked(row)}
                            className={`${INPUT} w-44`}
                          >
                            <option value="">—</option>
                            {WARRANTY_TYPES.map((type) => (
                              <option key={type} value={type}>
                                {type}
                              </option>
                            ))}
                          </select>
                          {row.warrantyType && row.warrantyType !== "Sem garantia" ? (
                            <input
                              value={row.warrantyTime}
                              onChange={(event) =>
                                updateRow(row.key, { warrantyTime: event.target.value })
                              }
                              disabled={locked(row)}
                              placeholder="ex.: 90 dias"
                              className={`${INPUT} w-28`}
                            />
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          {quotes ? (
            <table className="w-full max-w-xl text-sm">
              <thead className="text-left text-muted">
                <tr>
                  <th className="py-1 font-medium">Tipo</th>
                  <th className="py-1 text-right font-medium">Tarifa do ML</th>
                  <th className="py-1 text-right font-medium">Você recebe*</th>
                  {costCents !== null ? (
                    <th className="py-1 text-right font-medium">Margem</th>
                  ) : null}
                </tr>
              </thead>
              <tbody>
                {quotes.map((quote) => {
                  const receive = (firstPrice ?? 0) - quote.saleFeeCents;
                  const margin = costCents !== null ? receive - costCents : null;
                  return (
                    <tr key={quote.listingTypeId}>
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
          ) : null}
          {quotes ? (
            <p className="text-xs text-muted">
              * Preço da primeira linha menos a tarifa de venda do Mercado Livre. Não inclui frete
              nem impostos.
            </p>
          ) : null}
        </Section>

        {/* 6. Descrição */}
        <Section title="Descrição">
          <textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            rows={7}
            className="w-full rounded-lg border border-border bg-surface p-3 text-sm text-ink"
            placeholder="Somente texto simples: sem negrito, cores ou HTML (regra do Mercado Livre)."
          />
          {kind === "variants" && shownRows.length > 1 ? (
            <div className="flex flex-col gap-2">
              <p className="text-xs text-muted">
                A descrição acima vale para todas as variantes. Marque para escrever uma descrição
                própria.
              </p>
              {shownRows.map((row) => (
                <div key={row.key} className="rounded-lg border border-border bg-bg p-3">
                  <label className="flex items-center gap-2 text-sm text-ink">
                    <input
                      type="checkbox"
                      checked={row.ownDescription}
                      disabled={locked(row)}
                      onChange={(event) =>
                        updateRow(row.key, {
                          ownDescription: event.target.checked,
                          description: row.description || description,
                        })
                      }
                    />
                    {rowLabel(row, variationIds)}: descrição própria
                  </label>
                  {row.ownDescription ? (
                    <textarea
                      value={row.description}
                      onChange={(event) => updateRow(row.key, { description: event.target.value })}
                      disabled={locked(row)}
                      rows={4}
                      className="mt-2 w-full rounded-lg border border-border bg-surface p-2 text-sm text-ink"
                    />
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}
        </Section>
      </fieldset>

      <div className="sticky bottom-0 z-10 -mx-4 flex flex-col gap-3 border-t border-border bg-bg/95 px-4 py-3 backdrop-blur lg:-mx-8 lg:px-8">
        {message ? (
          <div
            role={message.tone === "error" ? "alert" : "status"}
            className={`max-h-48 overflow-y-auto rounded-lg border-l-4 px-3 py-2 text-sm ${
              message.tone === "error"
                ? "border-danger bg-danger-soft text-danger"
                : message.tone === "signal"
                  ? "border-signal bg-signal-soft text-signal-ink"
                  : "border-success bg-success-soft text-success"
            }`}
          >
            {message.lines.map((line, index) => (
              <p key={`${index}-${line}`}>{line}</p>
            ))}
          </div>
        ) : null}
        {askClose ? (
          <div
            role="alertdialog"
            aria-label="Rascunho salvo"
            className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-3 text-sm sm:flex-row sm:items-center sm:justify-between"
          >
            <p className="text-ink">Rascunho salvo. Para onde quer ir?</p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => router.push("/anuncios/rascunhos")}
                className="h-9 rounded-lg bg-brand px-3 font-semibold text-on-brand hover:bg-brand-hover"
              >
                Ir para a lista de rascunhos
              </button>
              <button
                type="button"
                onClick={() => router.push("/anuncios")}
                className="h-9 rounded-lg border border-border bg-surface px-3 font-medium text-ink hover:bg-surface-2"
              >
                Fechar
              </button>
              <button
                type="button"
                onClick={() => setAskClose(false)}
                className="h-9 px-2 text-muted hover:text-ink"
              >
                Continuar editando
              </button>
            </div>
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
              disabled={pending || !account?.allowWrites}
              title={account?.allowWrites ? undefined : FAILURES.writes_disabled}
              className="inline-flex h-10 items-center gap-2 rounded-lg bg-brand px-4 text-sm font-semibold text-on-brand hover:bg-brand-hover disabled:opacity-60"
            >
              <Rocket className="size-4" aria-hidden="true" />
              {pending ? "Aguarde…" : "Publicar"}
            </button>
            {!account?.allowWrites ? (
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
