import "server-only";

import { createMercadoLivreConnector } from "@/connectors/mercadolivre";
import type { MarketplaceConnector, MarketplaceId } from "@/connectors/types";
import { parseEncryptionKey } from "@/server/crypto/secret-box";
import { env } from "@/server/env";

/** A required environment variable for the marketplace integration is missing. */
export class IntegrationNotConfiguredError extends Error {
  constructor(readonly missing: string[]) {
    super(`Marketplace integration not configured. Missing: ${missing.join(", ")}`);
    this.name = "IntegrationNotConfiguredError";
  }
}

/** Key that encrypts marketplace tokens (TOKEN_ENCRYPTION_KEY). */
export function getTokenEncryptionKey(): Buffer {
  if (!env.TOKEN_ENCRYPTION_KEY) throw new IntegrationNotConfiguredError(["TOKEN_ENCRYPTION_KEY"]);
  return parseEncryptionKey(env.TOKEN_ENCRYPTION_KEY);
}

/** Connector for a marketplace, configured from the environment. */
export function getConnector(id: MarketplaceId): MarketplaceConnector {
  switch (id) {
    case "mercadolivre": {
      const missing = (["ML_CLIENT_ID", "ML_CLIENT_SECRET", "ML_REDIRECT_URI"] as const).filter(
        (name) => !env[name],
      );
      if (missing.length) throw new IntegrationNotConfiguredError(missing);
      return createMercadoLivreConnector({
        clientId: env.ML_CLIENT_ID as string,
        clientSecret: env.ML_CLIENT_SECRET as string,
        redirectUri: env.ML_REDIRECT_URI as string,
      });
    }
  }
}
