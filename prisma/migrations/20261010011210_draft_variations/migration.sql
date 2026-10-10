-- DropIndex
DROP INDEX "listing_drafts_batch_job_id_source_external_id_key";

-- AlterTable
ALTER TABLE "listing_drafts" ADD COLUMN     "source_variation_key" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "target_family_id" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "listing_drafts_batch_job_id_source_external_id_source_varia_key" ON "listing_drafts"("batch_job_id", "source_external_id", "source_variation_key");

