import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { isPwnedPassword } from "@/server/auth/pwned-password";

function sha1(text: string) {
  return createHash("sha1").update(text).digest("hex").toUpperCase();
}

function fakeFetch(body: string, status = 200) {
  return vi.fn(async () => new Response(body, { status })) as unknown as typeof fetch;
}

describe("isPwnedPassword", () => {
  const password = "senha-de-teste-123";
  const hash = sha1(password);

  it("sends only the first 5 hash characters", async () => {
    const fetchFn = fakeFetch("");
    await isPwnedPassword(password, fetchFn);
    const url = vi.mocked(fetchFn).mock.calls[0]?.[0];
    expect(url).toBe(`https://api.pwnedpasswords.com/range/${hash.slice(0, 5)}`);
    expect(String(url)).not.toContain(hash.slice(5));
  });

  it("detects a leaked password", async () => {
    const body = `0000000000000000000000000000000000A:3\r\n${hash.slice(5)}:42\r\n`;
    expect(await isPwnedPassword(password, fakeFetch(body))).toBe(true);
  });

  it("ignores padding entries (count 0)", async () => {
    expect(await isPwnedPassword(password, fakeFetch(`${hash.slice(5)}:0\r\n`))).toBe(false);
  });

  it("fails open when the service is down", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await isPwnedPassword(password, fakeFetch("", 503))).toBe(false);
    const failing = vi.fn(async () => {
      throw new Error("network");
    }) as unknown as typeof fetch;
    expect(await isPwnedPassword(password, failing)).toBe(false);
  });
});
