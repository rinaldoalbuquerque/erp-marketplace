"use client";

import { ArrowLeft, ArrowRight, ChevronDown, ImagePlus, Plus, Save, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";

import { AttributeField } from "@/components/listings/attribute-field";
import { shrinkImage } from "@/components/listings/shrink-image";
import {
  sortForForm,
  type AttributeDefinition,
  type AttributeInput,
} from "@/domain/listings/attributes";
import {
  DEFAULT_LISTING_TYPE,
  EMPTY_PACKAGE,
  LISTING_TYPES,
  type CanonicalVariant,
  type ListingTypeId,
} from "@/domain/listings/canonical";
import { parseBrlToCents } from "@/domain/products/money";

import {
  saveFamilyAction,
  uploadFamilyPictureAction,
  type FamilyInput,
  type SaveFamilyResult,
} from "./actions";

/** Attributes edited per variant in the table (not in the shared sheet). */
const GTIN = "GTIN";
const PACKAGE = {
  weight: "SELLER_PACKAGE_WEIGHT",
  height: "SELLER_PACKAGE_HEIGHT",
  width: "SELLER_PACKAGE_WIDTH",
  length: "SELLER_PACKAGE_LENGTH",
} as const;
type PackageField = keyof typeof PACKAGE;
const PACKAGE_FIELDS = Object.keys(PACKAGE) as PackageField[];
const ROW_IDS = new Set<string>([
  GTIN,
  "EMPTY_GTIN_REASON",
  "SELLER_SKU",
  ...Object.values(PACKAGE),
]);

const STATUS_LABELS: Record<string, string> = {
  active: "Ativo",
  paused: "Pausado",
  under_review: "Em revisão",
  inactive: "Inativo",
};

export type FamilyMemberInitial = {
  listingId: string;
  externalId: string;
  /** Values of the varying attributes, e.g. "Azul / M". */
  label: string;
  thumbnailUrl: string | null;
  versionStamp: string | null;
  skuCode: string | null;
  stock: number | null;
  price: string;
  status: string;
  description: string;
  /** Inputs of every editable attribute of the category. */
  attributes: Record<string, AttributeInput>;
};

type MemberState = {
  price: string;
  status: string;
  attributes: Record<string, AttributeInput>;
  ownDescription: boolean;
  description: string;
};

type NewRow = {
  key: string;
  values: Record<string, string>;
  skuCode: string;
  gtin: string;
  quantity: string;
  price: string;
  weight: string;
  height: string;
  width: string;
  length: string;
  listingTypeId: ListingTypeId;
  pictures: Array<{ id: string | null; url: string | null }>;
};

type Message = { tone: "success" | "error" | "signal"; lines: string[] };

const INPUT =
  "h-9 rounded-lg border border-border bg-surface px-2 text-sm text-ink disabled:opacity-60";

const sameInput = (a: AttributeInput | undefined, b: AttributeInput | undefined) =>
  (a?.value ?? "").trim() === (b?.value ?? "").trim() &&
  (a?.unit ?? "") === (b?.unit ?? "") &&
  Boolean(a?.notApplicable) === Boolean(b?.notApplicable);

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

function BulkHeader({ label, onBulk }: { label: string; onBulk?: () => void }) {
  return (
    <th className="px-2 py-2 text-left font-medium">
      <span className="block text-ink">{label}</span>
      {onBulk ? (
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

const SAVE_FAILURES: Record<string, string> = {
  conflict: "foi alterada por fora desde que a página abriu; recarregue e faça de novo.",
  writes_disabled: "alterações bloqueadas nesta conta (libere em Contas).",
  reconnect: "a conta precisa ser reconectada em Contas.",
  marketplace_error: "o Mercado Livre não respondeu; tente de novo.",
  not_found: "não encontrada.",
  forbidden: "sem permissão.",
  unexpected: "erro inesperado; tente de novo.",
};

/**
 * Edit page of a listing that belongs to a User Products family: every variant
 * on the same page (shared sheet, table of variants, new variants, description).
 */
export function FamilyEditForm({
  listingId,
  familyName,
  categoryLabel,
  definitions,
  varyingIds,
  members,
  skuCodes,
}: {
  listingId: string;
  familyName: string;
  categoryLabel: string;
  definitions: AttributeDefinition[];
  varyingIds: string[];
  members: FamilyMemberInitial[];
  skuCodes: string[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<Message | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const [uploading, setUploading] = useState<string | null>(null);

  const byId = useMemo(
    () => new Map(definitions.map((definition) => [definition.id, definition])),
    [definitions],
  );
  const hasGtin = byId.has(GTIN);
  const packageFields = PACKAGE_FIELDS.filter((field) => byId.has(PACKAGE[field]));

  // Shared technical sheet: edited once, sent to every variant (only what changed).
  const sharedDefs = useMemo(
    () =>
      definitions.filter(
        (definition) =>
          !definition.readOnly &&
          !ROW_IDS.has(definition.id) &&
          !varyingIds.includes(definition.id),
      ),
    [definitions, varyingIds],
  );
  const required = sortForForm(
    sharedDefs.filter(
      (definition) => !definition.hidden && (definition.required || definition.conditionalRequired),
    ),
  );
  const more = sharedDefs.filter(
    (definition) => definition.hidden || (!definition.required && !definition.conditionalRequired),
  );
  const first = members[0]!;
  const [shared, setShared] = useState<Record<string, AttributeInput>>(() =>
    Object.fromEntries(
      sharedDefs.map((definition) => [
        definition.id,
        first.attributes[definition.id] ?? { value: "" },
      ]),
    ),
  );
  const [dirtyShared, setDirtyShared] = useState<Set<string>>(new Set());

  const [rows, setRows] = useState<Record<string, MemberState>>(() =>
    Object.fromEntries(
      members.map((member) => [
        member.listingId,
        {
          price: member.price,
          status: member.status,
          attributes: { ...member.attributes },
          ownDescription: member.description !== first.description,
          description: member.description,
        },
      ]),
    ),
  );
  const [description, setDescription] = useState(first.description);
  const [descriptionDirty, setDescriptionDirty] = useState(false);
  const [newRows, setNewRows] = useState<NewRow[]>([]);

  const updateRow = (id: string, change: Partial<MemberState>) =>
    setRows((current) => ({ ...current, [id]: { ...current[id]!, ...change } }));
  const updateRowAttribute = (id: string, attributeId: string, value: string) =>
    setRows((current) => {
      const row = current[id]!;
      const previous = row.attributes[attributeId];
      return {
        ...current,
        [id]: {
          ...row,
          attributes: {
            ...row.attributes,
            [attributeId]: { value, unit: previous?.unit, notApplicable: false },
          },
        },
      };
    });
  const updateNew = (key: string, change: Partial<NewRow>) =>
    setNewRows((current) => current.map((row) => (row.key === key ? { ...row, ...change } : row)));

  function bulkMembers(label: string, apply: (row: MemberState, value: string) => MemberState) {
    const value = window.prompt(`${label}: valor para todas as variantes`);
    if (value === null) return;
    setRows((current) =>
      Object.fromEntries(
        Object.entries(current).map(([id, row]) => [id, apply(row, value.trim())]),
      ),
    );
  }

  /** Package value suggested for a new variant: the first variant that has it. */
  const knownPackage = (id: string) =>
    Object.values(rows)
      .map((row) => row.attributes[id]?.value.trim() ?? "")
      .find(Boolean) ?? "";

  function addVariant() {
    const template = newRows[0];
    setNewRows((current) => [
      ...current,
      {
        key: `n${Date.now().toString(36)}`,
        values: {},
        skuCode: "",
        gtin: "",
        quantity: "0",
        price: template?.price ?? rows[first.listingId]?.price ?? "",
        weight: template?.weight ?? knownPackage(PACKAGE.weight),
        height: template?.height ?? knownPackage(PACKAGE.height),
        width: template?.width ?? knownPackage(PACKAGE.width),
        length: template?.length ?? knownPackage(PACKAGE.length),
        listingTypeId: DEFAULT_LISTING_TYPE,
        pictures: [],
      },
    ]);
  }

  function upload(key: string, files: FileList) {
    setUploading(key);
    startTransition(async () => {
      const added: NewRow["pictures"] = [];
      for (const file of [...files]) {
        const form = new FormData();
        form.append("file", await shrinkImage(file), file.name.replace(/\.\w+$/, ".jpg"));
        const result = await uploadFamilyPictureAction(listingId, form);
        if (result.status !== "ok") {
          setMessage({
            tone: "error",
            lines: [
              result.status === "invalid"
                ? "Arquivo inválido (use JPG ou PNG de até 10 MB)."
                : "Não foi possível enviar a foto ao Mercado Livre.",
            ],
          });
          break;
        }
        added.push(result.picture);
      }
      setNewRows((current) =>
        current.map((row) =>
          row.key === key ? { ...row, pictures: [...row.pictures, ...added].slice(0, 12) } : row,
        ),
      );
      setUploading(null);
    });
  }

  function movePicture(key: string, index: number, delta: number) {
    setNewRows((current) =>
      current.map((row) => {
        if (row.key !== key) return row;
        const next = [...row.pictures];
        const [item] = next.splice(index, 1);
        next.splice(Math.max(0, Math.min(next.length, index + delta)), 0, item!);
        return { ...row, pictures: next };
      }),
    );
  }

  // ---------- build what to send ----------
  function collect(): FamilyInput | null {
    const errors: string[] = [];
    const payloads: FamilyInput["members"] = [];
    for (const member of members) {
      const row = rows[member.listingId]!;
      const payload: FamilyInput["members"][number]["payload"] = {
        versionStamp: member.versionStamp,
      };
      let changed = false;
      if (row.price.trim() !== member.price.trim()) {
        payload.price = row.price;
        changed = true;
      }
      if (row.status !== member.status && (row.status === "active" || row.status === "paused")) {
        payload.status = row.status;
        changed = true;
      }
      const text = row.ownDescription ? row.description : descriptionDirty ? description : null;
      if (text !== null && text !== member.description) {
        payload.description = text;
        changed = true;
      }
      const attributes: Record<string, AttributeInput> = {};
      for (const id of dirtyShared) {
        if (!sameInput(shared[id], member.attributes[id])) attributes[id] = shared[id]!;
      }
      for (const id of [GTIN, ...Object.values(PACKAGE)]) {
        if (byId.has(id) && !sameInput(row.attributes[id], member.attributes[id])) {
          attributes[id] = row.attributes[id] ?? { value: "" };
        }
      }
      if (Object.keys(attributes).length) {
        payload.attributes = attributes;
        changed = true;
      }
      if (changed) payloads.push({ listingId: member.listingId, label: member.label, payload });
    }

    const existing = new Set(members.map((member) => member.label.toLowerCase()));
    const variants: CanonicalVariant[] = [];
    for (const [index, row] of newRows.entries()) {
      const name = `Nova variante ${index + 1}`;
      const label = varyingIds.map((id) => row.values[id]?.trim() ?? "").join(" / ");
      if (varyingIds.some((id) => !row.values[id]?.trim())) {
        errors.push(
          `${name}: preencha ${varyingIds.map((id) => byId.get(id)?.name ?? id).join(" e ")}.`,
        );
      } else if (existing.has(label.toLowerCase())) {
        errors.push(`${name}: já existe uma variante “${label}”.`);
      }
      existing.add(label.toLowerCase());
      const price = parseBrlToCents(row.price);
      if (!price || price <= 0) errors.push(`${name}: preço inválido.`);
      const quantity = Number(row.quantity || "0");
      if (!Number.isInteger(quantity) || quantity < 0) errors.push(`${name}: quantidade inválida.`);
      if (row.pictures.length === 0) errors.push(`${name}: adicione ao menos uma foto.`);
      // Whole numbers (grams / cm); a typed value in another format is reported, never dropped.
      const int = (value: string, label: string) => {
        const trimmed = value.trim();
        if (!trimmed) return null;
        if (/^\d+$/.test(trimmed) && Number(trimmed) > 0) return Number(trimmed);
        errors.push(`${name}: ${label} deve ser um número inteiro (ex.: 500).`);
        return null;
      };
      variants.push({
        key: row.key,
        attributes: varyingIds.map((id) => {
          const typed = row.values[id]?.trim() ?? "";
          const known = byId
            .get(id)
            ?.values.find((value) => value.name.toLowerCase() === typed.toLowerCase());
          return { id, valueId: known?.id ?? null, valueName: known?.name ?? typed };
        }),
        priceCents: price ?? null,
        availableQuantity: Number.isInteger(quantity) ? quantity : 0,
        pictures: row.pictures,
        gtin: row.gtin.trim() || null,
        emptyGtinReason: null,
        sellerSku: row.skuCode.trim() ? row.skuCode.trim().toUpperCase() : null,
        skuId: null,
        skuCode: row.skuCode.trim() || null,
        listingTypeId: row.listingTypeId,
        warranty: null,
        description: null,
        package: {
          ...EMPTY_PACKAGE,
          weightG: int(row.weight, "peso (g)"),
          heightCm: int(row.height, "altura (cm)"),
          widthCm: int(row.width, "largura (cm)"),
          lengthCm: int(row.length, "comprimento (cm)"),
        },
      });
    }
    if (errors.length) {
      setMessage({ tone: "error", lines: ["Confira antes de salvar:", ...errors] });
      return null;
    }
    if (payloads.length === 0 && variants.length === 0) {
      setMessage({ tone: "signal", lines: ["Nada mudou: não havia o que enviar."] });
      return null;
    }
    return { members: payloads, newVariants: variants };
  }

  function report(result: SaveFamilyResult): { ok: boolean; lines: string[] } {
    if (result.status !== "done") return { ok: false, lines: ["Dados inválidos."] };
    const lines: string[] = [];
    let ok = true;
    for (const item of result.members) {
      const outcome = item.result;
      switch (outcome.status) {
        case "saved":
          if (outcome.notApplied.length) {
            ok = false;
            lines.push(`• ${item.label}: salva, mas ${outcome.notApplied.join(" ")}`);
          } else lines.push(`• ${item.label}: salva.`);
          break;
        case "no_changes":
          break;
        case "refused":
          ok = false;
          lines.push(`• ${item.label}: recusada pelo Mercado Livre — ${outcome.causes.join(" ")}`);
          break;
        case "invalid":
          ok = false;
          lines.push(`• ${item.label}: ${Object.values(outcome.fieldErrors).join(" ")}`);
          break;
        default:
          ok = false;
          lines.push(`• ${item.label}: ${SAVE_FAILURES[outcome.status] ?? "erro."}`);
      }
    }
    const created = result.created;
    if (created) {
      switch (created.status) {
        case "published":
          lines.push(`• ${created.variants.length} nova(s) variante(s) publicada(s).`);
          if (created.family === "different") {
            ok = false;
            lines.push(
              "Atenção: o Mercado Livre não deixou a variante nova na mesma família (algum atributo principal ficou diferente).",
            );
          }
          break;
        case "partial":
          ok = false;
          lines.push(
            `• Variantes novas: publicadas ${created.listingIds.length} de ${created.variants.length}. As que faltaram ficaram em Rascunhos para corrigir.`,
            ...created.variants
              .filter((variant) => variant.error)
              .map((variant) => `  ${variant.label}: ${variant.error}`),
          );
          break;
        case "incomplete":
          ok = false;
          lines.push("• Variantes novas: falta preencher:", ...created.missing);
          break;
        case "refused":
          ok = false;
          lines.push("• Variantes novas recusadas pelo Mercado Livre:", ...created.errors);
          break;
        case "unconfirmed":
          ok = false;
          lines.push(
            "• O Mercado Livre não confirmou a publicação das variantes novas. Confira em Anúncios antes de tentar de novo.",
          );
          break;
        default:
          ok = false;
          lines.push(`• Variantes novas: ${SAVE_FAILURES[created.status] ?? "não publicadas."}`);
      }
    }
    return { ok, lines };
  }

  function save() {
    const input = collect();
    if (!input) return;
    const count = input.newVariants.length;
    if (
      count &&
      !window.confirm(
        `Publicar ${count === 1 ? "1 variante nova" : `${count} variantes novas`} no Mercado Livre agora?`,
      )
    ) {
      return;
    }
    startTransition(async () => {
      const result = await saveFamilyAction(listingId, input);
      const { ok, lines } = report(result);
      if (ok) {
        router.push("/anuncios?aviso=editado");
        return;
      }
      setMessage({ tone: "signal", lines: ["Resultado por variante:", ...lines] });
      router.refresh();
    });
  }

  const sharedField = (definition: AttributeDefinition) => (
    <AttributeField
      key={definition.id}
      definition={definition}
      input={shared[definition.id] ?? { value: "" }}
      onChange={(next) => {
        setShared((current) => ({ ...current, [definition.id]: next }));
        setDirtyShared((current) => new Set(current).add(definition.id));
      }}
    />
  );

  const unitOf = (field: PackageField) => byId.get(PACKAGE[field])?.defaultUnit;

  return (
    <div className="flex max-w-6xl flex-col gap-5">
      <datalist id="family-sku-codes">
        {skuCodes.map((code) => (
          <option key={code} value={code} />
        ))}
      </datalist>

      <Section title="Informação básica">
        <div className="grid gap-1 text-sm sm:grid-cols-[11rem_1fr] sm:gap-x-4 sm:gap-y-2">
          <span className="text-muted">Nome da família</span>
          <span className="text-ink">
            {familyName}{" "}
            <span className="text-xs text-muted">
              (o Mercado Livre não permite alterar pela API)
            </span>
          </span>
          <span className="text-muted">Categoria</span>
          <span className="text-ink">{categoryLabel}</span>
          <span className="text-muted">Variantes</span>
          <span className="text-ink">{members.length} publicadas</span>
        </div>
      </Section>

      <Section title="Atributos (valem para todas as variantes)">
        {required.length ? (
          <div className="grid gap-4 sm:grid-cols-2">{required.map(sharedField)}</div>
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
              <div className="grid gap-4 sm:grid-cols-2">{more.map(sharedField)}</div>
            ) : null}
          </div>
        ) : null}
        {dirtyShared.size ? (
          <p className="text-xs text-signal-ink">
            Os atributos alterados aqui serão enviados para todas as variantes.
          </p>
        ) : null}
      </Section>

      <Section
        title={`Variantes (${members.length + newRows.length})`}
        actions={
          <button
            type="button"
            onClick={addVariant}
            className="inline-flex h-8 items-center gap-1 rounded-lg border border-border bg-surface px-3 text-xs font-medium text-brand hover:bg-surface-2"
          >
            <Plus className="size-3.5" /> Adicionar variante
          </button>
        }
      >
        <p className="text-xs text-muted">
          {varyingIds.map((id) => byId.get(id)?.name ?? id).join(" e ") || "O que varia"} de uma
          variante publicada não muda (é o que a identifica). O estoque é do ERP: ajuste em Estoque.
        </p>
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-bg text-muted">
              <tr>
                <th className="px-2 py-2 text-left font-medium">Variante</th>
                <th className="px-2 py-2 text-left font-medium">SKU · estoque</th>
                {hasGtin ? (
                  <th className="px-2 py-2 text-left font-medium">Código de barras</th>
                ) : null}
                {packageFields.includes("weight") ? (
                  <BulkHeader
                    label={`Peso do pacote${unitOf("weight") ? ` (${unitOf("weight")})` : ""}`}
                    onBulk={() =>
                      bulkMembers("Peso do pacote", (row, value) => ({
                        ...row,
                        attributes: {
                          ...row.attributes,
                          [PACKAGE.weight]: { ...row.attributes[PACKAGE.weight], value },
                        },
                      }))
                    }
                  />
                ) : null}
                {packageFields.some((field) => field !== "weight") ? (
                  <BulkHeader
                    label={`Dimensões do pacote${unitOf("height") ? ` (${unitOf("height")})` : ""}`}
                    onBulk={() => {
                      const value = window.prompt(
                        "Dimensões para todas (altura x largura x comprimento, ex.: 25x20x25)",
                      );
                      const parts = value
                        ?.toLowerCase()
                        .split("x")
                        .map((part) => part.trim());
                      if (!parts || parts.length !== 3) return;
                      setRows((current) =>
                        Object.fromEntries(
                          Object.entries(current).map(([id, row]) => [
                            id,
                            {
                              ...row,
                              attributes: {
                                ...row.attributes,
                                [PACKAGE.height]: {
                                  ...row.attributes[PACKAGE.height],
                                  value: parts[0]!,
                                },
                                [PACKAGE.width]: {
                                  ...row.attributes[PACKAGE.width],
                                  value: parts[1]!,
                                },
                                [PACKAGE.length]: {
                                  ...row.attributes[PACKAGE.length],
                                  value: parts[2]!,
                                },
                              },
                            },
                          ]),
                        ),
                      );
                    }}
                  />
                ) : null}
                <BulkHeader
                  label="Preço (R$)"
                  onBulk={() => bulkMembers("Preço", (row, value) => ({ ...row, price: value }))}
                />
                <BulkHeader
                  label="Status"
                  onBulk={() => {
                    const value = window.prompt("Status para todas: 1 = Ativo, 2 = Pausado");
                    const status = value === "1" ? "active" : value === "2" ? "paused" : null;
                    if (!status) return;
                    setRows((current) =>
                      Object.fromEntries(
                        Object.entries(current).map(([id, row]) => [
                          id,
                          row.status === "active" || row.status === "paused"
                            ? { ...row, status }
                            : row,
                        ]),
                      ),
                    );
                  }}
                />
                <th className="px-2 py-2" />
              </tr>
            </thead>
            <tbody>
              {members.map((member) => {
                const row = rows[member.listingId]!;
                const editableStatus = member.status === "active" || member.status === "paused";
                return (
                  <tr key={member.listingId} className="border-t border-border align-top">
                    <td className="px-2 py-2">
                      <div className="flex items-center gap-2">
                        {member.thumbnailUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element -- ML-hosted thumbnail
                          <img
                            src={member.thumbnailUrl}
                            alt=""
                            className="size-10 rounded border border-border bg-white object-contain"
                          />
                        ) : null}
                        <span>
                          <span className="block font-medium text-ink">{member.label}</span>
                          <span className="block text-xs text-muted tabular-nums">
                            {member.externalId}
                            {member.listingId === listingId ? " · aberto" : ""}
                          </span>
                        </span>
                      </div>
                    </td>
                    <td className="px-2 py-2 text-muted">
                      {member.skuCode ? (
                        <>
                          <span className="block text-ink">{member.skuCode}</span>
                          <span className="text-xs">estoque {member.stock ?? 0}</span>
                        </>
                      ) : (
                        <span className="text-xs">sem SKU (vincule em Mapeamento)</span>
                      )}
                    </td>
                    {hasGtin ? (
                      <td className="px-2 py-2">
                        <input
                          value={row.attributes[GTIN]?.value ?? ""}
                          onChange={(event) =>
                            updateRowAttribute(member.listingId, GTIN, event.target.value)
                          }
                          inputMode="numeric"
                          className={`${INPUT} w-40`}
                        />
                      </td>
                    ) : null}
                    {packageFields.includes("weight") ? (
                      <td className="px-2 py-2">
                        <input
                          value={row.attributes[PACKAGE.weight]?.value ?? ""}
                          onChange={(event) =>
                            updateRowAttribute(member.listingId, PACKAGE.weight, event.target.value)
                          }
                          inputMode="decimal"
                          className={`${INPUT} w-20`}
                        />
                      </td>
                    ) : null}
                    {packageFields.some((field) => field !== "weight") ? (
                      <td className="px-2 py-2 whitespace-nowrap">
                        {(["height", "width", "length"] as const).map((field, index) =>
                          byId.has(PACKAGE[field]) ? (
                            <span key={field}>
                              {index ? <span className="px-1 text-muted">×</span> : null}
                              <input
                                value={row.attributes[PACKAGE[field]]?.value ?? ""}
                                onChange={(event) =>
                                  updateRowAttribute(
                                    member.listingId,
                                    PACKAGE[field],
                                    event.target.value,
                                  )
                                }
                                inputMode="decimal"
                                aria-label={byId.get(PACKAGE[field])?.name ?? field}
                                className={`${INPUT} w-14`}
                              />
                            </span>
                          ) : null,
                        )}
                      </td>
                    ) : null}
                    <td className="px-2 py-2">
                      <input
                        value={row.price}
                        onChange={(event) =>
                          updateRow(member.listingId, { price: event.target.value })
                        }
                        inputMode="decimal"
                        className={`${INPUT} w-24`}
                      />
                    </td>
                    <td className="px-2 py-2">
                      {editableStatus ? (
                        <select
                          value={row.status}
                          onChange={(event) =>
                            updateRow(member.listingId, { status: event.target.value })
                          }
                          className={`${INPUT} w-28`}
                        >
                          <option value="active">Ativo</option>
                          <option value="paused">Pausado</option>
                        </select>
                      ) : (
                        <span className="text-xs text-muted">
                          {STATUS_LABELS[member.status] ?? member.status}
                        </span>
                      )}
                    </td>
                    <td />
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {newRows.map((row, index) => (
          <div key={row.key} className="flex flex-col gap-3 rounded-lg border-2 border-brand p-3">
            <div className="flex items-center justify-between">
              <span className="font-medium text-ink">Nova variante {index + 1}</span>
              <button
                type="button"
                aria-label="Remover variante nova"
                onClick={() =>
                  setNewRows((current) => current.filter((item) => item.key !== row.key))
                }
                className="text-muted hover:text-danger"
              >
                <Trash2 className="size-4" />
              </button>
            </div>
            <div className="grid gap-3 sm:grid-cols-4">
              {varyingIds.map((id) => (
                <label key={id} className="flex flex-col gap-1 text-sm">
                  <span className="text-muted">{byId.get(id)?.name ?? id} *</span>
                  <input
                    value={row.values[id] ?? ""}
                    onChange={(event) =>
                      updateNew(row.key, { values: { ...row.values, [id]: event.target.value } })
                    }
                    list={`values-${id}`}
                    className={INPUT}
                  />
                  <datalist id={`values-${id}`}>
                    {(byId.get(id)?.values ?? []).map((value) => (
                      <option key={value.id} value={value.name} />
                    ))}
                  </datalist>
                </label>
              ))}
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-muted">SKU</span>
                <input
                  value={row.skuCode}
                  onChange={(event) => updateNew(row.key, { skuCode: event.target.value })}
                  list="family-sku-codes"
                  placeholder="código"
                  className={`${INPUT} uppercase`}
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-muted">Código de barras</span>
                <input
                  value={row.gtin}
                  onChange={(event) => updateNew(row.key, { gtin: event.target.value })}
                  inputMode="numeric"
                  className={INPUT}
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-muted">Quantidade</span>
                <input
                  value={row.quantity}
                  onChange={(event) => updateNew(row.key, { quantity: event.target.value })}
                  inputMode="numeric"
                  className={INPUT}
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-muted">Preço (R$) *</span>
                <input
                  value={row.price}
                  onChange={(event) => updateNew(row.key, { price: event.target.value })}
                  inputMode="decimal"
                  placeholder="0,00"
                  className={INPUT}
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-muted">Tipo de anúncio</span>
                <select
                  value={row.listingTypeId}
                  onChange={(event) =>
                    updateNew(row.key, { listingTypeId: event.target.value as ListingTypeId })
                  }
                  className={INPUT}
                >
                  {Object.entries(LISTING_TYPES).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-muted">Peso do pacote (g)</span>
                <input
                  value={row.weight}
                  onChange={(event) => updateNew(row.key, { weight: event.target.value })}
                  inputMode="numeric"
                  className={INPUT}
                />
              </label>
              <div className="flex flex-col gap-1 text-sm">
                <span className="text-muted">Dimensões (cm): alt × larg × comp</span>
                <span className="flex items-center gap-1">
                  {(["height", "width", "length"] as const).map((field) => (
                    <input
                      key={field}
                      value={row[field]}
                      onChange={(event) => updateNew(row.key, { [field]: event.target.value })}
                      inputMode="numeric"
                      className={`${INPUT} w-14`}
                    />
                  ))}
                </span>
              </div>
            </div>
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-3">
                <span className="text-sm text-ink">Fotos * ({row.pictures.length}/12)</span>
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
                {uploading === row.key ? (
                  <span className="text-xs text-muted">Enviando ao Mercado Livre…</span>
                ) : null}
              </div>
              {row.pictures.length ? (
                <ul className="flex flex-wrap gap-2">
                  {row.pictures.map((picture, position) => (
                    <li
                      key={`${picture.id ?? picture.url}-${position}`}
                      className="flex w-20 flex-col items-center gap-1"
                    >
                      <div className="flex size-20 items-center justify-center overflow-hidden rounded-lg border border-border bg-white">
                        {picture.url ? (
                          // eslint-disable-next-line @next/next/no-img-element -- ML-hosted preview
                          <img src={picture.url} alt="" className="max-h-full object-contain" />
                        ) : (
                          <span className="px-1 text-center text-[10px] text-muted">
                            {picture.id}
                          </span>
                        )}
                      </div>
                      <span className="flex gap-1 text-muted">
                        <button
                          type="button"
                          aria-label="Mover para a esquerda"
                          onClick={() => movePicture(row.key, position, -1)}
                          className="hover:text-ink"
                        >
                          <ArrowLeft className="size-3.5" />
                        </button>
                        <button
                          type="button"
                          aria-label="Mover para a direita"
                          onClick={() => movePicture(row.key, position, 1)}
                          className="hover:text-ink"
                        >
                          <ArrowRight className="size-3.5" />
                        </button>
                        <button
                          type="button"
                          aria-label="Remover foto"
                          onClick={() =>
                            updateNew(row.key, {
                              pictures: row.pictures.filter((_, item) => item !== position),
                            })
                          }
                          className="hover:text-danger"
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          </div>
        ))}
      </Section>

      <Section title="Descrição">
        <textarea
          value={description}
          onChange={(event) => {
            setDescription(event.target.value);
            setDescriptionDirty(true);
          }}
          rows={7}
          className="w-full rounded-lg border border-border bg-surface p-3 text-sm text-ink"
          placeholder="Somente texto simples: sem negrito, cores ou HTML (regra do Mercado Livre)."
        />
        <p className="text-xs text-muted">
          Vale para todas as variantes, menos as marcadas com descrição própria abaixo.
        </p>
        <details>
          <summary className="cursor-pointer text-sm text-brand">
            Descrição própria por variante
          </summary>
          <div className="mt-2 flex flex-col gap-2">
            {members.map((member) => {
              const row = rows[member.listingId]!;
              return (
                <div key={member.listingId} className="rounded-lg border border-border bg-bg p-3">
                  <label className="flex items-center gap-2 text-sm text-ink">
                    <input
                      type="checkbox"
                      checked={row.ownDescription}
                      onChange={(event) =>
                        updateRow(member.listingId, { ownDescription: event.target.checked })
                      }
                    />
                    {member.label}: descrição própria
                  </label>
                  {row.ownDescription ? (
                    <textarea
                      value={row.description}
                      onChange={(event) =>
                        updateRow(member.listingId, { description: event.target.value })
                      }
                      rows={4}
                      className="mt-2 w-full rounded-lg border border-border bg-surface p-2 text-sm text-ink"
                    />
                  ) : null}
                </div>
              );
            })}
          </div>
        </details>
      </Section>

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
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={save}
            disabled={pending}
            className="inline-flex h-10 items-center gap-2 rounded-lg bg-brand px-4 text-sm font-semibold text-on-brand hover:bg-brand-hover disabled:opacity-60"
          >
            <Save className="size-4" aria-hidden="true" />
            {pending ? "Salvando no Mercado Livre…" : "Salvar alterações"}
          </button>
        </div>
      </div>
    </div>
  );
}
