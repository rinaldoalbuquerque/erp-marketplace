import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

// Tests that talk to the database configured in .env (`npm run test:db`).
// Keep them read-only: they run against the real project database.
// (Standalone instead of mergeConfig, which would concatenate include/exclude.)
export default defineConfig({
  resolve: {
    tsconfigPaths: true,
    alias: {
      "server-only": fileURLToPath(new URL("./src/test/empty-module.ts", import.meta.url)),
    },
  },
  test: {
    include: ["src/**/*.db.test.ts"],
    setupFiles: ["dotenv/config"],
    environment: "node",
  },
});
