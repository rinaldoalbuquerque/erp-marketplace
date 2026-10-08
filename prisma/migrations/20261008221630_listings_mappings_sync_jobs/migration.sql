-- CreateEnum
CREATE TYPE "sync_job_type" AS ENUM ('import_listings');

-- CreateEnum
CREATE TYPE "sync_job_status" AS ENUM ('queued', 'running', 'paused', 'completed', 'failed');

-- CreateTable
CREATE TABLE "listings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "marketplace_account_id" UUID NOT NULL,
    "marketplace" "marketplace" NOT NULL,
    "external_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "sub_status" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "price_cents" INTEGER,
    "currency" TEXT,
    "available_quantity" INTEGER,
    "sold_quantity" INTEGER,
    "permalink" TEXT,
    "thumbnail_url" TEXT,
    "category_id" TEXT,
    "listing_type_id" TEXT,
    "condition" TEXT,
    "listing_model" "listing_model" NOT NULL DEFAULT 'unknown',
    "user_product_id" TEXT,
    "family_id" TEXT,
    "family_name" TEXT,
    "seller_sku" TEXT,
    "external_updated_at" TIMESTAMPTZ(6),
    "raw" JSONB NOT NULL,
    "synced_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "listings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "listing_variations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "listing_id" UUID NOT NULL,
    "external_id" TEXT NOT NULL,
    "attributes" JSONB NOT NULL,
    "price_cents" INTEGER,
    "available_quantity" INTEGER,
    "sold_quantity" INTEGER,
    "seller_sku" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "listing_variations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sku_listing_mappings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "sku_id" UUID NOT NULL,
    "listing_id" UUID NOT NULL,
    "listing_variation_id" UUID,
    "variation_key" TEXT NOT NULL DEFAULT '',
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sku_listing_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_jobs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "marketplace_account_id" UUID NOT NULL,
    "type" "sync_job_type" NOT NULL,
    "status" "sync_job_status" NOT NULL DEFAULT 'queued',
    "total" INTEGER,
    "processed" INTEGER NOT NULL DEFAULT 0,
    "created_count" INTEGER NOT NULL DEFAULT 0,
    "updated_count" INTEGER NOT NULL DEFAULT 0,
    "failed_count" INTEGER NOT NULL DEFAULT 0,
    "pending_ids" JSONB,
    "errors" JSONB NOT NULL DEFAULT '[]',
    "last_error" TEXT,
    "started_by_id" UUID,
    "started_at" TIMESTAMPTZ(6),
    "heartbeat_at" TIMESTAMPTZ(6),
    "finished_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "sync_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "listings_organization_id_status_idx" ON "listings"("organization_id", "status");

-- CreateIndex
CREATE INDEX "listings_organization_id_marketplace_account_id_idx" ON "listings"("organization_id", "marketplace_account_id");

-- CreateIndex
CREATE INDEX "listings_organization_id_family_id_idx" ON "listings"("organization_id", "family_id");

-- CreateIndex
CREATE UNIQUE INDEX "listings_marketplace_account_id_external_id_key" ON "listings"("marketplace_account_id", "external_id");

-- CreateIndex
CREATE UNIQUE INDEX "listings_organization_id_id_key" ON "listings"("organization_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "listing_variations_listing_id_external_id_key" ON "listing_variations"("listing_id", "external_id");

-- CreateIndex
CREATE UNIQUE INDEX "listing_variations_organization_id_id_key" ON "listing_variations"("organization_id", "id");

-- CreateIndex
CREATE INDEX "sku_listing_mappings_organization_id_sku_id_idx" ON "sku_listing_mappings"("organization_id", "sku_id");

-- CreateIndex
CREATE UNIQUE INDEX "sku_listing_mappings_listing_id_variation_key_key" ON "sku_listing_mappings"("listing_id", "variation_key");

-- CreateIndex
CREATE INDEX "sync_jobs_organization_id_marketplace_account_id_created_at_idx" ON "sync_jobs"("organization_id", "marketplace_account_id", "created_at");

-- AddForeignKey
ALTER TABLE "listings" ADD CONSTRAINT "listings_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listings" ADD CONSTRAINT "listings_organization_id_marketplace_account_id_fkey" FOREIGN KEY ("organization_id", "marketplace_account_id") REFERENCES "marketplace_accounts"("organization_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listing_variations" ADD CONSTRAINT "listing_variations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listing_variations" ADD CONSTRAINT "listing_variations_organization_id_listing_id_fkey" FOREIGN KEY ("organization_id", "listing_id") REFERENCES "listings"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sku_listing_mappings" ADD CONSTRAINT "sku_listing_mappings_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sku_listing_mappings" ADD CONSTRAINT "sku_listing_mappings_organization_id_sku_id_fkey" FOREIGN KEY ("organization_id", "sku_id") REFERENCES "skus"("organization_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sku_listing_mappings" ADD CONSTRAINT "sku_listing_mappings_organization_id_listing_id_fkey" FOREIGN KEY ("organization_id", "listing_id") REFERENCES "listings"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sku_listing_mappings" ADD CONSTRAINT "sku_listing_mappings_organization_id_listing_variation_id_fkey" FOREIGN KEY ("organization_id", "listing_variation_id") REFERENCES "listing_variations"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sku_listing_mappings" ADD CONSTRAINT "sku_listing_mappings_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sync_jobs" ADD CONSTRAINT "sync_jobs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sync_jobs" ADD CONSTRAINT "sync_jobs_organization_id_marketplace_account_id_fkey" FOREIGN KEY ("organization_id", "marketplace_account_id") REFERENCES "marketplace_accounts"("organization_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sync_jobs" ADD CONSTRAINT "sync_jobs_started_by_id_fkey" FOREIGN KEY ("started_by_id") REFERENCES "profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Security: block direct browser access through Supabase's Data API (see init migration).
ALTER TABLE "listings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "listing_variations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sku_listing_mappings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sync_jobs" ENABLE ROW LEVEL SECURITY;
