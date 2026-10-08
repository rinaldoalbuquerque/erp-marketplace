import { MarketplaceApiError } from "../types";

// Low-level HTTP for the Mercado Livre API. Never logs tokens or request bodies.

export const ML_API_BASE = "https://api.mercadolibre.com";
const TIMEOUT_MS = 15_000;
const MAX_ATTEMPTS = 3;

export type FetchFn = typeof fetch;

/** Error body shape documented for OAuth/API errors, e.g. { error, error_description, status }. */
export type MlErrorBody = { error?: string; message?: string; error_description?: string };

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * fetch with timeout and retry on 429 / 5xx / network errors.
 * 429 "local_rate_limited": "Volte a tentar em alguns segundos"
 * (https://developers.mercadolivre.com.br/pt_br/autenticacao-e-autorizacao, códigos de erro).
 */
export async function mlFetch(
  fetchFn: FetchFn,
  url: string,
  init: RequestInit,
  { retryDelayMs = 1000 }: { retryDelayMs?: number } = {},
): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const response = await fetchFn(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
      const retryable = response.status === 429 || response.status >= 500;
      if (!retryable || attempt === MAX_ATTEMPTS) return response;
    } catch (error) {
      lastError = error;
      if (attempt === MAX_ATTEMPTS) break;
    }
    await sleep(retryDelayMs * 2 ** (attempt - 1));
  }
  throw new MarketplaceApiError(
    `Mercado Livre unreachable: ${lastError instanceof Error ? lastError.name : "network error"}`,
    null,
  );
}

export async function readErrorBody(response: Response): Promise<MlErrorBody> {
  try {
    return (await response.json()) as MlErrorBody;
  } catch {
    return {};
  }
}
