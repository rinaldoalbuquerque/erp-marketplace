-- CreateEnum
CREATE TYPE "stock_push_status" AS ENUM ('pending', 'sent', 'skipped', 'failed');

-- AlterTable
ALTER TABLE "listings" ADD COLUMN     "logistic_type" TEXT;

-- AlterTable
ALTER TABLE "marketplace_accounts" ADD COLUMN     "multi_warehouse" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "stock_sync_enabled" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "stock_pushes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "listing_id" UUID NOT NULL,
    "variation_key" TEXT NOT NULL DEFAULT '',
    "desired_quantity" INTEGER NOT NULL,
    "status" "stock_push_status" NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "claim_token" UUID,
    "claimed_until" TIMESTAMPTZ(6),
    "last_error" TEXT,
    "skip_reason" TEXT,
    "sent_quantity" INTEGER,
    "sent_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "stock_pushes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "stock_pushes_organization_id_status_next_attempt_at_idx" ON "stock_pushes"("organization_id", "status", "next_attempt_at");

-- CreateIndex
CREATE UNIQUE INDEX "stock_pushes_listing_id_variation_key_key" ON "stock_pushes"("listing_id", "variation_key");

-- AddForeignKey
ALTER TABLE "stock_pushes" ADD CONSTRAINT "stock_pushes_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_pushes" ADD CONSTRAINT "stock_pushes_organization_id_listing_id_fkey" FOREIGN KEY ("organization_id", "listing_id") REFERENCES "listings"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill the logistic type of listings imported before this column existed
-- (stored payload: shipping.logistic_type, e.g. fulfillment = Full).
UPDATE "listings" SET "logistic_type" = "raw"->'shipping'->>'logistic_type' WHERE "logistic_type" IS NULL;

-- Security: block direct browser access through Supabase's Data API (see init migration).
ALTER TABLE "stock_pushes" ENABLE ROW LEVEL SECURITY;
