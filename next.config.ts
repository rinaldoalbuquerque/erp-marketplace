import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async redirects() {
    // The proxy sends logged-out users from /painel to /entrar.
    return [{ source: "/", destination: "/painel", permanent: false }];
  },
};

export default nextConfig;
