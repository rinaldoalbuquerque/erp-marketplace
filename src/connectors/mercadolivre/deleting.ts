import { bearer, failure } from "./editing";
import { ML_API_BASE, mlFetch, type FetchFn } from "./http";

// Deleting a listing takes two calls to the same resource:
//   1. PUT /items/{id} { "status": "closed" }  (finalizar)
//   2. PUT /items/{id} { "deleted": "true" }   (only a closed item can be deleted)
// A 409 "item optimistic locking error: conflict" on step 2 means the close is
// still being processed: wait a few seconds and try again. Deleting cannot be undone.
// https://developers.mercadolivre.com.br/pt-br/atualiza-tuas-publicacoes
// https://developers.mercadolivre.com.br/en_us/services-sync-listings

const DELETE_ATTEMPTS = 4;
const CONFLICT_WAIT_MS = 3_000;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function put(fetchFn: FetchFn, accessToken: string, externalId: string, body: unknown) {
  return mlFetch(fetchFn, `${ML_API_BASE}/items/${encodeURIComponent(externalId)}`, {
    method: "PUT",
    headers: { ...bearer(accessToken), "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** Closes (unless already closed) and deletes a listing. Irreversible. */
export async function deleteListing(
  fetchFn: FetchFn,
  accessToken: string,
  externalId: string,
  options: { alreadyClosed: boolean; sleep?: (ms: number) => Promise<unknown> },
): Promise<void> {
  const sleep = options.sleep ?? wait;
  if (!options.alreadyClosed) {
    const closed = await put(fetchFn, accessToken, externalId, { status: "closed" });
    if (!closed.ok) await failure(closed, "Item close");
  }
  for (let attempt = 1; ; attempt++) {
    const deleted = await put(fetchFn, accessToken, externalId, { deleted: "true" });
    if (deleted.ok) return;
    if (deleted.status !== 409 || attempt >= DELETE_ATTEMPTS) {
      await failure(deleted, "Item delete");
    }
    await sleep(CONFLICT_WAIT_MS);
  }
}
