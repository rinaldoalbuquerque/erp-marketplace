-- CreateEnum
CREATE TYPE "listing_draft_status" AS ENUM ('draft', 'validated', 'publishing', 'published', 'failed');

-- CreateTable
CREATE TABLE "listing_drafts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "marketplace_account_id" UUID NOT NULL,
    "sku_id" UUID,
    "status" "listing_draft_status" NOT NULL DEFAULT 'draft',
    "content" JSONB NOT NULL,
    "last_errors" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "listing_id" UUID,
    "external_id" TEXT,
    "published_at" TIMESTAMPTZ(6),
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "listing_drafts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "listing_drafts_organization_id_status_updated_at_idx" ON "listing_drafts"("organization_id", "status", "updated_at");

-- AddForeignKey
ALTER TABLE "listing_drafts" ADD CONSTRAINT "listing_drafts_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listing_drafts" ADD CONSTRAINT "listing_drafts_organization_id_marketplace_account_id_fkey" FOREIGN KEY ("organization_id", "marketplace_account_id") REFERENCES "marketplace_accounts"("organization_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listing_drafts" ADD CONSTRAINT "listing_drafts_organization_id_sku_id_fkey" FOREIGN KEY ("organization_id", "sku_id") REFERENCES "skus"("organization_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listing_drafts" ADD CONSTRAINT "listing_drafts_organization_id_listing_id_fkey" FOREIGN KEY ("organization_id", "listing_id") REFERENCES "listings"("organization_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listing_drafts" ADD CONSTRAINT "listing_drafts_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Security: block direct browser access through Supabase's Data API (see init migration).
ALTER TABLE "listing_drafts" ENABLE ROW LEVEL SECURITY;
