-- CreateEnum
CREATE TYPE "order_stage" AS ENUM ('pending', 'invoice_pending', 'ready_to_print', 'printed', 'shipped', 'delivered', 'cancelled', 'fulfillment', 'other');

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "dispatch_by" TIMESTAMPTZ(6),
ADD COLUMN     "label_available_at" TIMESTAMPTZ(6),
ADD COLUMN     "shipment_mode" TEXT,
ADD COLUMN     "shipment_status" TEXT,
ADD COLUMN     "shipment_substatus" TEXT,
ADD COLUMN     "shipment_synced_at" TIMESTAMPTZ(6),
ADD COLUMN     "sla_status" TEXT,
ADD COLUMN     "stage" "order_stage" NOT NULL DEFAULT 'pending',
ADD COLUMN     "tracking_number" TEXT;

-- CreateIndex
CREATE INDEX "orders_organization_id_stage_idx" ON "orders"("organization_id", "stage");

-- CreateIndex
CREATE INDEX "orders_marketplace_account_id_shipping_id_idx" ON "orders"("marketplace_account_id", "shipping_id");

-- Orders saved before this migration: stage from what is already known (the
-- shipment sync fills the rest).
UPDATE "orders" SET "stage" = 'cancelled' WHERE "status" IN ('cancelled', 'invalid');
UPDATE "orders" SET "stage" = 'fulfillment' WHERE "logistic_type" = 'fulfillment' AND "stage" = 'pending';
