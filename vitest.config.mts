import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

// Unit tests only (no database). Database tests (*.db.test.ts) use
// vitest.db.config.mts: `npm run test:db`.
export default defineConfig({
  resolve: {
    // Makes the "@/..." import alias from tsconfig.json work in tests.
    tsconfigPaths: true,
    alias: {
      // "server-only" is resolved by Next.js; in tests it is an empty module.
      "server-only": fileURLToPath(new URL("./src/test/empty-module.ts", import.meta.url)),
    },
  },
  test: {
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    exclude: ["src/**/*.db.test.ts", "node_modules/**"],
    environment: "node",
  },
});
