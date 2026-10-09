-- CreateEnum
CREATE TYPE "listing_edit_status" AS ENUM ('success', 'partial', 'failed');

-- AlterTable
ALTER TABLE "marketplace_accounts" ADD COLUMN     "allow_writes" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "marketplace_categories" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "marketplace" "marketplace" NOT NULL,
    "category_id" TEXT NOT NULL,
    "attributes" JSONB NOT NULL,
    "fetched_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "marketplace_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "listing_edits" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "listing_id" UUID NOT NULL,
    "user_id" UUID,
    "changes" JSONB NOT NULL,
    "status" "listing_edit_status" NOT NULL,
    "message" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "listing_edits_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "marketplace_categories_marketplace_category_id_key" ON "marketplace_categories"("marketplace", "category_id");

-- CreateIndex
CREATE INDEX "listing_edits_organization_id_listing_id_created_at_idx" ON "listing_edits"("organization_id", "listing_id", "created_at");

-- AddForeignKey
ALTER TABLE "listing_edits" ADD CONSTRAINT "listing_edits_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listing_edits" ADD CONSTRAINT "listing_edits_organization_id_listing_id_fkey" FOREIGN KEY ("organization_id", "listing_id") REFERENCES "listings"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listing_edits" ADD CONSTRAINT "listing_edits_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Security: block direct browser access through Supabase's Data API (see init migration).
ALTER TABLE "marketplace_categories" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "listing_edits" ENABLE ROW LEVEL SECURITY;
