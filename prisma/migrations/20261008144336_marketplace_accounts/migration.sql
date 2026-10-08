-- CreateEnum
CREATE TYPE "marketplace" AS ENUM ('mercadolivre');

-- CreateEnum
CREATE TYPE "listing_model" AS ENUM ('traditional', 'user_products', 'unknown');

-- CreateEnum
CREATE TYPE "marketplace_account_status" AS ENUM ('active', 'needs_reauth', 'disconnected');

-- CreateTable
CREATE TABLE "marketplace_accounts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "marketplace" "marketplace" NOT NULL,
    "external_user_id" TEXT NOT NULL,
    "nickname" TEXT NOT NULL,
    "site_id" TEXT,
    "listing_model" "listing_model" NOT NULL DEFAULT 'unknown',
    "status" "marketplace_account_status" NOT NULL DEFAULT 'active',
    "access_token_encrypted" TEXT,
    "refresh_token_encrypted" TEXT,
    "access_token_expires_at" TIMESTAMPTZ(6),
    "scopes" TEXT,
    "last_token_refresh_at" TIMESTAMPTZ(6),
    "last_sync_at" TIMESTAMPTZ(6),
    "last_error" TEXT,
    "connected_by_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "marketplace_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "marketplace_accounts_organization_id_idx" ON "marketplace_accounts"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "marketplace_accounts_marketplace_external_user_id_key" ON "marketplace_accounts"("marketplace", "external_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "marketplace_accounts_organization_id_id_key" ON "marketplace_accounts"("organization_id", "id");

-- AddForeignKey
ALTER TABLE "marketplace_accounts" ADD CONSTRAINT "marketplace_accounts_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketplace_accounts" ADD CONSTRAINT "marketplace_accounts_connected_by_id_fkey" FOREIGN KEY ("connected_by_id") REFERENCES "profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Security: block direct browser access through Supabase's Data API (see init migration).
ALTER TABLE "marketplace_accounts" ENABLE ROW LEVEL SECURITY;
