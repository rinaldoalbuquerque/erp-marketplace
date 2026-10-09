-- CreateEnum
CREATE TYPE "invoice_provider" AS ENUM ('mercadolivre', 'xml_import');

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "invoice_checked_at" TIMESTAMPTZ(6),
ADD COLUMN     "invoice_id" UUID;

-- AlterTable
ALTER TABLE "skus" ADD COLUMN     "csosn" TEXT;

-- CreateTable
CREATE TABLE "invoices" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "marketplace_account_id" UUID NOT NULL,
    "provider" "invoice_provider" NOT NULL,
    "external_id" TEXT,
    "status" TEXT NOT NULL,
    "number" INTEGER,
    "series" TEXT,
    "access_key" TEXT,
    "amount_cents" INTEGER,
    "issued_at" TIMESTAMPTZ(6),
    "danfe_path" TEXT,
    "xml_path" TEXT,
    "error_code" TEXT,
    "error_message" TEXT,
    "pack_key" TEXT NOT NULL,
    "requested_by_id" UUID,
    "raw" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "invoices_marketplace_account_id_pack_key_idx" ON "invoices"("marketplace_account_id", "pack_key");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_marketplace_account_id_external_id_key" ON "invoices"("marketplace_account_id", "external_id");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_organization_id_id_key" ON "invoices"("organization_id", "id");

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_organization_id_invoice_id_fkey" FOREIGN KEY ("organization_id", "invoice_id") REFERENCES "invoices"("organization_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_organization_id_marketplace_account_id_fkey" FOREIGN KEY ("organization_id", "marketplace_account_id") REFERENCES "marketplace_accounts"("organization_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_requested_by_id_fkey" FOREIGN KEY ("requested_by_id") REFERENCES "profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Security: block direct browser access through Supabase's Data API (see init migration).
ALTER TABLE "invoices" ENABLE ROW LEVEL SECURITY;
