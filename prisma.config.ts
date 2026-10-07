// Prisma 7 does not load .env by itself.
import "dotenv/config";
import { defineConfig } from "prisma/config";

// Supabase + Prisma: https://www.prisma.io/docs/guides/database/supabase
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    // CLI (migrations) uses the direct/session connection, not the transaction pooler.
    // process.env (not env()) so `prisma generate` works before .env is filled in.
    url: process.env["DIRECT_URL"],
  },
});
