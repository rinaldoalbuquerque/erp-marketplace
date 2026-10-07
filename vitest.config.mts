import { defineConfig } from "vitest/config";

export default defineConfig({
  // Makes the "@/..." import alias from tsconfig.json work in tests.
  resolve: { tsconfigPaths: true },
  test: {
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    environment: "node",
  },
});
