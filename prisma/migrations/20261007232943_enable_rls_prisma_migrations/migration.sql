-- Prisma creates _prisma_migrations itself, so RLS is enabled here in a separate migration.
-- Same reason as in init: block access through Supabase's Data API.
-- Conditional because the table doesn't exist in Prisma's temporary shadow database.
DO $$
BEGIN
  IF to_regclass('public._prisma_migrations') IS NOT NULL THEN
    ALTER TABLE "_prisma_migrations" ENABLE ROW LEVEL SECURITY;
  END IF;
END
$$;
