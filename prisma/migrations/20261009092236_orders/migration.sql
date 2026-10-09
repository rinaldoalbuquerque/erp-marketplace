-- CreateEnum
CREATE TYPE "notification_status" AS ENUM ('pending', 'done', 'ignored', 'failed');

-- CreateEnum
CREATE TYPE "order_item_stock_status" AS ENUM ('waiting', 'deducted', 'restored', 'not_applicable', 'missing_sku');

-- AlterTable
ALTER TABLE "marketplace_accounts" ADD COLUMN     "order_stock_enabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "order_stock_since" TIMESTAMPTZ(6),
ADD COLUMN     "orders_synced_at" TIMESTAMPTZ(6);

-- CreateTable
CREATE TABLE "marketplace_notifications" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "marketplace" "marketplace" NOT NULL,
    "topic" TEXT NOT NULL,
    "resource" TEXT NOT NULL,
    "external_user_id" TEXT NOT NULL,
    "status" "notification_status" NOT NULL DEFAULT 'pending',
    "version" INTEGER NOT NULL DEFAULT 1,
    "tries" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "claimed_until" TIMESTAMPTZ(6),
    "last_error" TEXT,
    "received_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMPTZ(6),

    CONSTRAINT "marketplace_notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orders" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "marketplace_account_id" UUID NOT NULL,
    "marketplace" "marketplace" NOT NULL,
    "external_id" TEXT NOT NULL,
    "pack_id" TEXT,
    "status" TEXT NOT NULL,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "total_cents" INTEGER,
    "currency" TEXT,
    "buyer_nickname" TEXT,
    "shipping_id" TEXT,
    "logistic_type" TEXT,
    "date_created" TIMESTAMPTZ(6) NOT NULL,
    "date_closed" TIMESTAMPTZ(6),
    "external_updated_at" TIMESTAMPTZ(6),
    "raw" JSONB NOT NULL,
    "synced_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "external_item_id" TEXT NOT NULL,
    "variation_key" TEXT NOT NULL DEFAULT '',
    "title" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unit_price_cents" INTEGER,
    "sale_fee_cents" INTEGER,
    "seller_sku" TEXT,
    "listing_id" UUID,
    "sku_id" UUID,
    "stock_status" "order_item_stock_status" NOT NULL DEFAULT 'waiting',
    "stock_note" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "order_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "marketplace_notifications_status_next_attempt_at_idx" ON "marketplace_notifications"("status", "next_attempt_at");

-- CreateIndex
CREATE UNIQUE INDEX "marketplace_notifications_marketplace_topic_resource_key" ON "marketplace_notifications"("marketplace", "topic", "resource");

-- CreateIndex
CREATE INDEX "orders_organization_id_date_created_idx" ON "orders"("organization_id", "date_created");

-- CreateIndex
CREATE UNIQUE INDEX "orders_marketplace_account_id_external_id_key" ON "orders"("marketplace_account_id", "external_id");

-- CreateIndex
CREATE UNIQUE INDEX "orders_organization_id_id_key" ON "orders"("organization_id", "id");

-- CreateIndex
CREATE INDEX "order_items_organization_id_sku_id_idx" ON "order_items"("organization_id", "sku_id");

-- CreateIndex
CREATE UNIQUE INDEX "order_items_order_id_external_item_id_variation_key_key" ON "order_items"("order_id", "external_item_id", "variation_key");

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_organization_id_marketplace_account_id_fkey" FOREIGN KEY ("organization_id", "marketplace_account_id") REFERENCES "marketplace_accounts"("organization_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_organization_id_order_id_fkey" FOREIGN KEY ("organization_id", "order_id") REFERENCES "orders"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_organization_id_listing_id_fkey" FOREIGN KEY ("organization_id", "listing_id") REFERENCES "listings"("organization_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_organization_id_sku_id_fkey" FOREIGN KEY ("organization_id", "sku_id") REFERENCES "skus"("organization_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- Security: block direct browser access through Supabase's Data API (see init migration).
ALTER TABLE "marketplace_notifications" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "orders" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "order_items" ENABLE ROW LEVEL SECURITY;
