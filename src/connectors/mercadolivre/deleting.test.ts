import { describe, expect, it, vi } from "vitest";

import { deleteListing } from "@/connectors/mercadolivre/deleting";
import type { FetchFn } from "@/connectors/mercadolivre/http";
import { MarketplaceValidationError } from "@/connectors/types";

/** Fake fetch answering each call with the next reply, recording the bodies. */
function sequence(replies: Array<{ status: number; body?: unknown }>) {
  const bodies: unknown[] = [];
  const fn = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body)));
    const reply = replies.shift() ?? { status: 500, body: {} };
    return new Response(JSON.stringify(reply.body ?? {}), { status: reply.status });
  });
  return { fetchFn: fn as unknown as FetchFn, bodies, fn };
}

const noWait = async () => undefined;

describe("deleteListing", () => {
  it("closes the item, then deletes it", async () => {
    const { fetchFn, bodies, fn } = sequence([{ status: 200 }, { status: 200 }]);
    await deleteListing(fetchFn, "t", "MLB1", { alreadyClosed: false, sleep: noWait });
    expect(bodies).toEqual([{ status: "closed" }, { deleted: "true" }]);
    const [url, init] = fn.mock.calls[1] as unknown as [string, RequestInit];
    expect(url).toContain("/items/MLB1");
    expect(init.method).toBe("PUT");
  });

  it("skips closing an item already closed", async () => {
    const { fetchFn, bodies } = sequence([{ status: 200 }]);
    await deleteListing(fetchFn, "t", "MLB1", { alreadyClosed: true, sleep: noWait });
    expect(bodies).toEqual([{ deleted: "true" }]);
  });

  it("waits and tries again on a 409 conflict", async () => {
    const sleep = vi.fn(noWait);
    const { fetchFn, bodies } = sequence([
      { status: 200 },
      { status: 409, body: { message: "item optimistic locking error: conflict" } },
      { status: 200 },
    ]);
    await deleteListing(fetchFn, "t", "MLB1", { alreadyClosed: false, sleep });
    expect(bodies).toHaveLength(3);
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it("never deletes when the close is refused", async () => {
    const { fetchFn, bodies } = sequence([
      { status: 400, body: { message: "Item com estoque no Full não pode ser finalizado" } },
    ]);
    const error = await deleteListing(fetchFn, "t", "MLB1", {
      alreadyClosed: false,
      sleep: noWait,
    }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(MarketplaceValidationError);
    expect(bodies).toEqual([{ status: "closed" }]);
  });
});
