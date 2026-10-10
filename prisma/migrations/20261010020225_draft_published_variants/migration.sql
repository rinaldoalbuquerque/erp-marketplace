-- AlterTable
ALTER TABLE "listing_drafts" ADD COLUMN     "published_variants" JSONB NOT NULL DEFAULT '{}';

