-- CreateEnum
CREATE TYPE "stock_movement_type" AS ENUM ('manual_in', 'manual_out', 'count', 'sale', 'sale_return');

-- CreateTable
CREATE TABLE "products" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "brand" TEXT,
    "description" TEXT,
    "archived_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "skus" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "ean" TEXT,
    "variation" JSONB,
    "ncm" TEXT,
    "cest" TEXT,
    "origin" INTEGER,
    "unit" TEXT NOT NULL DEFAULT 'UN',
    "default_cfop" TEXT,
    "weight_grams" INTEGER,
    "height_cm" INTEGER,
    "width_cm" INTEGER,
    "length_cm" INTEGER,
    "location" TEXT,
    "cost_cents" INTEGER,
    "stock_on_hand" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "skus_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_movements" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "sku_id" UUID NOT NULL,
    "type" "stock_movement_type" NOT NULL,
    "quantity" INTEGER NOT NULL,
    "balance_after" INTEGER NOT NULL,
    "reason" TEXT,
    "idempotency_key" TEXT,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_movements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "products_organization_id_name_idx" ON "products"("organization_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "products_organization_id_id_key" ON "products"("organization_id", "id");

-- CreateIndex
CREATE INDEX "skus_product_id_idx" ON "skus"("product_id");

-- CreateIndex
CREATE UNIQUE INDEX "skus_organization_id_id_key" ON "skus"("organization_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "skus_organization_id_code_key" ON "skus"("organization_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "skus_organization_id_ean_key" ON "skus"("organization_id", "ean");

-- CreateIndex
CREATE INDEX "stock_movements_sku_id_created_at_idx" ON "stock_movements"("sku_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "stock_movements_organization_id_idempotency_key_key" ON "stock_movements"("organization_id", "idempotency_key");

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "skus" ADD CONSTRAINT "skus_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "skus" ADD CONSTRAINT "skus_organization_id_product_id_fkey" FOREIGN KEY ("organization_id", "product_id") REFERENCES "products"("organization_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_organization_id_sku_id_fkey" FOREIGN KEY ("organization_id", "sku_id") REFERENCES "skus"("organization_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Data rules enforced by the database (Prisma doesn't model CHECK constraints).
ALTER TABLE "skus" ADD CONSTRAINT "skus_origin_check" CHECK ("origin" IS NULL OR "origin" BETWEEN 0 AND 8);
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_quantity_check" CHECK ("quantity" <> 0);

-- Security: block direct browser access through Supabase's Data API (see init migration).
ALTER TABLE "products" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "skus" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "stock_movements" ENABLE ROW LEVEL SECURITY;
