-- CreateEnum
CREATE TYPE "listing_source_kind" AS ENUM ('own', 'external');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "sync_job_type" ADD VALUE 'replicate_listings';
ALTER TYPE "sync_job_type" ADD VALUE 'publish_drafts';

-- AlterTable
ALTER TABLE "listing_drafts" ADD COLUMN     "batch_job_id" UUID,
ADD COLUMN     "source_account_id" UUID,
ADD COLUMN     "source_external_id" TEXT,
ADD COLUMN     "source_kind" "listing_source_kind";

-- AlterTable
ALTER TABLE "sync_jobs" ADD COLUMN     "params" JSONB;

-- CreateIndex
CREATE UNIQUE INDEX "listing_drafts_batch_job_id_source_external_id_key" ON "listing_drafts"("batch_job_id", "source_external_id");

-- CreateIndex
CREATE UNIQUE INDEX "sync_jobs_organization_id_id_key" ON "sync_jobs"("organization_id", "id");

-- AddForeignKey
ALTER TABLE "listing_drafts" ADD CONSTRAINT "listing_drafts_organization_id_batch_job_id_fkey" FOREIGN KEY ("organization_id", "batch_job_id") REFERENCES "sync_jobs"("organization_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;


-- (no new tables: RLS already enabled on listing_drafts and sync_jobs)
