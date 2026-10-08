"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { can } from "@/domain/auth/permissions";
import { productSchema, skuSchema, type SkuInput } from "@/domain/products/schemas";
import { GENERIC_ERROR } from "@/lib/auth/error-messages";
import { type FormState } from "@/lib/auth/form-state";
import { fieldErrors } from "@/lib/auth/schemas";
import { requirePermission, type CurrentMember } from "@/server/auth/session";
import { adjustStock } from "@/server/stock/stock-service";
import { getTenantContext, type TenantDb } from "@/server/tenant/tenant-db";

import { Prisma } from "@/generated/prisma/client";

// Server Actions are public endpoints: each one checks permission and validates
// again, whatever the form already did.

const PRODUCT_FIELDS = ["name", "brand", "description"] as const;
const SKU_FIELDS = [
  "code",
  "ean",
  "variationName1",
  "variationValue1",
  "variationName2",
  "variationValue2",
  "variationName3",
  "variationValue3",
  "ncm",
  "cest",
  "origin",
  "unit",
  "defaultCfop",
  "weightGrams",
  "heightCm",
  "widthCm",
  "lengthCm",
  "location",
  "cost",
] as const;

function readStrings(formData: FormData, keys: readonly string[]): Record<string, string> {
  return Object.fromEntries(
    keys.map((key) => {
      const value = formData.get(key);
      return [key, typeof value === "string" ? value : ""];
    }),
  );
}

/** SKU data to save; cost only when the member may see financial data. */
function skuData(member: CurrentMember, sku: SkuInput) {
  const { costCents, variation, ...rest } = sku;
  return {
    ...rest,
    variation: variation ?? Prisma.DbNull,
    ...(can(member.role, "financial.view") ? { costCents } : {}),
  };
}

/** Friendly message when the SKU code or EAN is already used in this organization. */
async function duplicateSkuErrors(
  tdb: TenantDb,
  sku: SkuInput,
  exceptSkuId?: string,
): Promise<Record<string, string> | null> {
  const others = await tdb.sku.findMany({
    where: {
      id: exceptSkuId ? { not: exceptSkuId } : undefined,
      OR: [{ code: sku.code }, ...(sku.ean ? [{ ean: sku.ean }] : [])],
    },
    select: { code: true, ean: true },
  });
  const errors: Record<string, string> = {};
  if (others.some((other) => other.code === sku.code)) {
    errors.code = "Já existe um SKU com este código.";
  }
  if (sku.ean && others.some((other) => other.ean === sku.ean)) {
    errors.ean = "Este EAN já está em outro SKU.";
  }
  return Object.keys(errors).length ? errors : null;
}

function isUniqueViolation(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

const DUPLICATE_MESSAGE = "Código SKU ou EAN já usado em outro SKU.";

export async function createProductAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const member = await requirePermission("products.edit");
  const { tdb } = await getTenantContext(member);

  const raw = readStrings(formData, [...PRODUCT_FIELDS, ...SKU_FIELDS, "initialStock"]);
  const product = productSchema.safeParse(raw);
  const sku = skuSchema.safeParse(raw);
  const initialStock = raw.initialStock?.trim() ?? "";
  const errors = {
    ...(product.success ? {} : fieldErrors(product.error)),
    ...(sku.success ? {} : fieldErrors(sku.error)),
    ...(initialStock && !/^\d+$/.test(initialStock)
      ? { initialStock: "Informe um número inteiro." }
      : {}),
  };
  if (!product.success || !sku.success || Object.keys(errors).length) {
    return { status: "error", fieldErrors: errors, values: raw };
  }

  const duplicates = await duplicateSkuErrors(tdb, sku.data);
  if (duplicates) return { status: "error", fieldErrors: duplicates, values: raw };

  let created: { productId: string; skuId: string };
  try {
    created = await tdb.$transaction(async (tx) => {
      const newProduct = await tx.product.create({
        data: { organizationId: member.organizationId, ...product.data },
        select: { id: true },
      });
      const newSku = await tx.sku.create({
        data: {
          organizationId: member.organizationId,
          productId: newProduct.id,
          ...skuData(member, sku.data),
        },
        select: { id: true },
      });
      return { productId: newProduct.id, skuId: newSku.id };
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      return { status: "error", message: DUPLICATE_MESSAGE, values: raw };
    }
    throw error;
  }

  const quantity = Number(initialStock || "0");
  if (quantity > 0 && can(member.role, "stock.adjust")) {
    await adjustStock(tdb, {
      organizationId: member.organizationId,
      skuId: created.skuId,
      type: "manual_in",
      quantity,
      reason: "Estoque inicial",
      createdById: member.user.id,
    });
  }

  revalidatePath("/produtos");
  redirect(`/produtos/${created.productId}?criado=1`);
}

export async function updateProductAction(
  productId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const member = await requirePermission("products.edit");
  const { tdb } = await getTenantContext(member);

  const raw = readStrings(formData, PRODUCT_FIELDS);
  const parsed = productSchema.safeParse(raw);
  if (!parsed.success) {
    return { status: "error", fieldErrors: fieldErrors(parsed.error), values: raw };
  }

  const result = await tdb.product.updateMany({ where: { id: productId }, data: parsed.data });
  if (result.count === 0) return { status: "error", message: "Produto não encontrado." };

  revalidatePath("/produtos");
  revalidatePath(`/produtos/${productId}`);
  return { status: "success", message: "Produto salvo.", values: raw };
}

export async function setProductArchivedAction(productId: string, archived: boolean) {
  const member = await requirePermission("products.archive");
  const { tdb } = await getTenantContext(member);
  await tdb.product.updateMany({
    where: { id: productId },
    data: { archivedAt: archived ? new Date() : null },
  });
  revalidatePath("/produtos");
  revalidatePath(`/produtos/${productId}`);
}

export async function createSkuAction(
  productId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const member = await requirePermission("products.edit");
  const { tdb } = await getTenantContext(member);

  const raw = readStrings(formData, [...SKU_FIELDS, "initialStock"]);
  const parsed = skuSchema.safeParse(raw);
  const initialStock = raw.initialStock?.trim() ?? "";
  if (!parsed.success || (initialStock && !/^\d+$/.test(initialStock))) {
    return {
      status: "error",
      fieldErrors: {
        ...(parsed.success ? {} : fieldErrors(parsed.error)),
        ...(initialStock && !/^\d+$/.test(initialStock)
          ? { initialStock: "Informe um número inteiro." }
          : {}),
      },
      values: raw,
    };
  }

  const product = await tdb.product.findFirst({ where: { id: productId }, select: { id: true } });
  if (!product) return { status: "error", message: "Produto não encontrado." };

  const duplicates = await duplicateSkuErrors(tdb, parsed.data);
  if (duplicates) return { status: "error", fieldErrors: duplicates, values: raw };

  let skuId: string;
  try {
    skuId = (
      await tdb.sku.create({
        data: {
          organizationId: member.organizationId,
          productId,
          ...skuData(member, parsed.data),
        },
        select: { id: true },
      })
    ).id;
  } catch (error) {
    if (isUniqueViolation(error))
      return { status: "error", message: DUPLICATE_MESSAGE, values: raw };
    throw error;
  }

  const quantity = Number(initialStock || "0");
  if (quantity > 0 && can(member.role, "stock.adjust")) {
    await adjustStock(tdb, {
      organizationId: member.organizationId,
      skuId,
      type: "manual_in",
      quantity,
      reason: "Estoque inicial",
      createdById: member.user.id,
    });
  }

  revalidatePath(`/produtos/${productId}`);
  redirect(`/produtos/${productId}?sku-salvo=1`);
}

export async function updateSkuAction(
  productId: string,
  skuId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const member = await requirePermission("products.edit");
  const { tdb } = await getTenantContext(member);

  const raw = readStrings(formData, SKU_FIELDS);
  const parsed = skuSchema.safeParse(raw);
  if (!parsed.success) {
    return { status: "error", fieldErrors: fieldErrors(parsed.error), values: raw };
  }

  const duplicates = await duplicateSkuErrors(tdb, parsed.data, skuId);
  if (duplicates) return { status: "error", fieldErrors: duplicates, values: raw };

  try {
    // stockOnHand is never part of skuData: stock only changes through adjustStock().
    const result = await tdb.sku.updateMany({
      where: { id: skuId, productId },
      data: skuData(member, parsed.data),
    });
    if (result.count === 0) return { status: "error", message: "SKU não encontrado." };
  } catch (error) {
    if (isUniqueViolation(error))
      return { status: "error", message: DUPLICATE_MESSAGE, values: raw };
    console.error("SKU update failed", {
      skuId,
      error: error instanceof Error ? error.message : error,
    });
    return { status: "error", message: GENERIC_ERROR, values: raw };
  }

  revalidatePath(`/produtos/${productId}`);
  redirect(`/produtos/${productId}?sku-salvo=1`);
}
