"use client";

import { ArrowLeft, ArrowRight, ImagePlus, Save, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";

import { Field } from "@/components/ui/form";
import { FormSection, SelectField, TextareaField } from "@/components/ui/fields";
import type { EditableListing } from "@/connectors/types";
import { AttributeField } from "@/components/listings/attribute-field";
import { shrinkImage } from "@/components/listings/shrink-image";
import {
  sortForForm,
  type AttributeDefinition,
  type AttributeInput,
} from "@/domain/listings/attributes";
import { LISTING_TYPES } from "@/domain/listings/canonical";

import { saveListingEditAction, uploadListingPictureAction, type EditPayload } from "./actions";

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
  listingTypeId: string | null;
  /** Current pictures in order (the first is the main one). */
  pictures: Array<{ id: string; url: string | null }>;
};

const STATUS_OPTIONS = [
  { value: "active", label: "Ativo" },
  { value: "paused", label: "Pausado" },
  { value: "closed", label: "Finalizado (não pode ser reativado)" },
];

type Message = { tone: "success" | "error" | "signal"; lines: string[] };

export function EditListingForm({
  listingId,
  initial,
  definitions,
  rules,
  canClose,
  returnTo = "/anuncios",
}: {
  listingId: string;
  initial: EditFormInitial;
  definitions: AttributeDefinition[];
  rules: EditableListing["rules"];
  canClose: boolean;
  /** Listings page to go back to (same filters). */
  returnTo?: string;
}) {
  const router = useRouter();
  const [title, setTitle] = useState(initial.title);
  const [familyName, setFamilyName] = useState(initial.familyName);
  const [price, setPrice] = useState(initial.price);
  const [status, setStatus] = useState(initial.status);
  const [description, setDescription] = useState(initial.description);
  const [attributes, setAttributes] = useState(initial.attributes);
  const [listingTypeId, setListingTypeId] = useState(initial.listingTypeId ?? "");
  const [pictures, setPictures] = useState(initial.pictures);
  const [uploading, setUploading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<Message | null>(null);
  const [pending, startTransition] = useTransition();

  const { main, advanced, readOnly } = useMemo(() => {
    const editable = definitions.filter((definition) => !definition.readOnly);
    return {
      main: sortForForm(editable.filter((definition) => !definition.hidden)),
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
      // Pictures: the full ordered list, only when something changed.
      ...(pictures.map((picture) => picture.id).join("|") !==
      initial.pictures.map((picture) => picture.id).join("|")
        ? { pictureIds: pictures.map((picture) => picture.id) }
        : {}),
      ...(listingTypeId !== (initial.listingTypeId ?? "") &&
      (listingTypeId === "gold_special" || listingTypeId === "gold_pro")
        ? { listingTypeId }
        : {}),
    };
    startTransition(async () => {
      const result = await saveListingEditAction(listingId, payload);
      setErrors({});
      switch (result.status) {
        case "saved": {
          // Everything applied: close and go back to the listings (partial results stay here).
          if (!result.notApplied.length) {
            router.push(`${returnTo}${returnTo.includes("?") ? "&" : "?"}aviso=editado`);
            return;
          }
          const notices = result.notices.length
            ? [
                "Avisos do Mercado Livre sobre este anúncio (não impediram a alteração):",
                ...result.notices.map((notice) => `• ${notice}`),
              ]
            : [];
          setMessage(
            result.notApplied.length
              ? {
                  tone: "signal",
                  lines: [
                    "Salvo, mas nem tudo foi aplicado pelo Mercado Livre:",
                    ...result.notApplied.map((item) => `• ${item}`),
                    ...notices,
                  ],
                }
              : { tone: "success", lines: ["Alterações salvas no Mercado Livre.", ...notices] },
          );
          router.refresh();
          break;
        }
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
        case "unexpected":
          setMessage({
            tone: "error",
            lines: [
              "Erro inesperado ao salvar (o erro foi registrado). Recarregue a página para ver o que ficou salvo no Mercado Livre.",
            ],
          });
          break;
        default:
          setMessage({ tone: "error", lines: ["O Mercado Livre não respondeu. Tente de novo."] });
      }
    });
  }

  function upload(files: FileList) {
    setUploading(true);
    startTransition(async () => {
      const added: typeof pictures = [];
      for (const file of [...files]) {
        const form = new FormData();
        form.append("file", await shrinkImage(file), file.name.replace(/\.\w+$/, ".jpg"));
        const result = await uploadListingPictureAction(listingId, form);
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
      setPictures((current) => [...current, ...added].slice(0, 12));
      setUploading(false);
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
                rules.titleLockReason === "user_products"
                  ? `User Products: o título é gerado pelo Mercado Livre a partir do nome da família${
                      initial.familyName ? ` (“${initial.familyName}”)` : ""
                    } e dos atributos. Para mudá-lo, altere os atributos abaixo. A edição do nome da família, que vale para todos os anúncios dela, virá numa próxima etapa.`
                  : rules.titleLockReason === "has_sales"
                    ? "O título não pode mudar depois da primeira venda (regra do Mercado Livre)."
                    : undefined
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
        <SelectField
          label="Tipo de anúncio"
          name="listingTypeId"
          options={[
            ...(listingTypeId && !(listingTypeId in LISTING_TYPES)
              ? [{ value: listingTypeId, label: listingTypeId }]
              : []),
            ...Object.entries(LISTING_TYPES).map(([value, label]) => ({ value, label })),
          ]}
          value={listingTypeId}
          onChange={(event) => setListingTypeId(event.target.value)}
        />
      </FormSection>

      <section className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-display text-base font-semibold text-ink">
            Fotos <span className="font-normal text-muted">({pictures.length}/12)</span>
          </h2>
          <label className="inline-flex cursor-pointer items-center gap-1 text-sm text-brand hover:underline">
            <ImagePlus className="size-4" aria-hidden="true" />
            Adicionar imagens
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              multiple
              className="sr-only"
              disabled={uploading}
              onChange={(event) => {
                if (event.target.files?.length) upload(event.target.files);
                event.target.value = "";
              }}
            />
          </label>
        </div>
        <p className="text-xs text-muted">
          A primeira foto é a principal. Ao salvar, as fotos do anúncio são substituídas por esta
          lista, nesta ordem.
        </p>
        {uploading ? <span className="text-xs text-muted">Enviando ao Mercado Livre…</span> : null}
        {errors.pictures ? <p className="text-sm text-danger">{errors.pictures}</p> : null}
        <ul className="flex flex-wrap gap-2">
          {pictures.map((picture, position) => (
            <li key={`${picture.id}-${position}`} className="flex w-24 flex-col items-center gap-1">
              <div className="flex size-24 items-center justify-center overflow-hidden rounded-lg border border-border bg-white">
                {picture.url ? (
                  // eslint-disable-next-line @next/next/no-img-element -- ML-hosted preview
                  <img src={picture.url} alt="" className="max-h-full object-contain" />
                ) : (
                  <span className="px-1 text-center text-[10px] text-muted">{picture.id}</span>
                )}
              </div>
              <span className="flex gap-1 text-muted">
                <button
                  type="button"
                  aria-label="Mover para a esquerda"
                  onClick={() => movePicture(position, -1)}
                  className="hover:text-ink"
                >
                  <ArrowLeft className="size-3.5" />
                </button>
                <button
                  type="button"
                  aria-label="Mover para a direita"
                  onClick={() => movePicture(position, 1)}
                  className="hover:text-ink"
                >
                  <ArrowRight className="size-3.5" />
                </button>
                <button
                  type="button"
                  aria-label="Remover foto"
                  onClick={() =>
                    setPictures((current) => current.filter((_, item) => item !== position))
                  }
                  className="hover:text-danger"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </span>
              {position === 0 ? <span className="text-[10px] text-muted">principal</span> : null}
            </li>
          ))}
        </ul>
      </section>

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
