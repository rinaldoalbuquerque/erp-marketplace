import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  experimental: {
    // Listing pictures go through a Server Action (resized in the browser to the
    // ML maximum of 1920 px first). Vercel caps request bodies at 4.5 MB.
    serverActions: { bodySizeLimit: "4mb" },
  },
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
