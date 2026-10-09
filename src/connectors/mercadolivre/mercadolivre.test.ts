import { describe, expect, it, vi } from "vitest";

import { createMercadoLivreConnector } from "@/connectors/mercadolivre";
import { mlFetch, type FetchFn } from "@/connectors/mercadolivre/http";
import { listingModelFromTags } from "@/connectors/mercadolivre/users";
import { MarketplaceApiError, MarketplaceAuthError } from "@/connectors/types";

const config = {
  clientId: "1620218256833906",
  clientSecret: "secret-xyz",
  redirectUri: "https://erp.exemplo.com/contas/mercadolivre/retorno",
};

/** Fake fetch answering with the given responses in order; records the calls. */
function fakeFetch(...responses: Array<{ status: number; body: unknown }>) {
  const fn = vi.fn(async () => {
    const next = responses.shift() ?? { status: 500, body: {} };
    return new Response(JSON.stringify(next.body), { status: next.status });
  });
  return fn as unknown as FetchFn & typeof fn;
}

// Example response from the documentation.
const tokenBody = {
  access_token: "APP_USR-123456-090515-8cc4448aac10d5105474e1351-1234567",
  token_type: "bearer",
  expires_in: 21600,
  scope: "offline_access read write",
  user_id: 1234567,
  refresh_token: "TG-5b9032b4e23464aed1f959f-1234567",
};

describe("authorization URL", () => {
  it("points to Mercado Livre Brasil with PKCE S256 and state", () => {
    const url = new URL(
      createMercadoLivreConnector(config).buildAuthorizationUrl({
        state: "state123",
        codeChallenge: "challenge456",
      }),
    );
    expect(url.origin + url.pathname).toBe("https://auth.mercadolivre.com.br/authorization");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      response_type: "code",
      client_id: config.clientId,
      redirect_uri: config.redirectUri,
      state: "state123",
      code_challenge: "challenge456",
      code_challenge_method: "S256",
    });
  });

  it("never puts the client secret in the URL", () => {
    const url = createMercadoLivreConnector(config).buildAuthorizationUrl({
      state: "s",
      codeChallenge: "c",
    });
    expect(url).not.toContain(config.clientSecret);
  });
});

describe("token exchange", () => {
  it("posts the documented form fields and parses the response", async () => {
    const fetchFn = fakeFetch({ status: 200, body: tokenBody });
    const before = Date.now();
    const tokens = await createMercadoLivreConnector(config, fetchFn).exchangeCode({
      code: "TG-code",
      codeVerifier: "verifier",
    });

    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.mercadolibre.com/oauth/token");
    expect(init.method).toBe("POST");
    expect(Object.fromEntries(new URLSearchParams(String(init.body)))).toEqual({
      grant_type: "authorization_code",
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code: "TG-code",
      redirect_uri: config.redirectUri,
      code_verifier: "verifier",
    });
    expect(tokens).toMatchObject({
      accessToken: tokenBody.access_token,
      refreshToken: tokenBody.refresh_token,
      scopes: "offline_access read write",
      externalUserId: "1234567",
    });
    const sixHours = 21600 * 1000;
    expect(tokens.expiresAt.getTime()).toBeGreaterThanOrEqual(before + sixHours);
  });

  it("refresh sends grant_type=refresh_token", async () => {
    const fetchFn = fakeFetch({ status: 200, body: tokenBody });
    await createMercadoLivreConnector(config, fetchFn).refreshTokens("TG-old");
    const init = (fetchFn.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(Object.fromEntries(new URLSearchParams(String(init.body)))).toMatchObject({
      grant_type: "refresh_token",
      refresh_token: "TG-old",
    });
  });

  it("invalid_grant means the seller must reconnect", async () => {
    const fetchFn = fakeFetch({
      status: 400,
      body: { error: "invalid_grant", error_description: "Error validating grant." },
    });
    await expect(
      createMercadoLivreConnector(config, fetchFn).refreshTokens("TG-used"),
    ).rejects.toBeInstanceOf(MarketplaceAuthError);
  });

  it("other errors are API errors without leaking secrets", async () => {
    const fetchFn = fakeFetch({ status: 400, body: { error: "invalid_client" } });
    const error = await createMercadoLivreConnector(config, fetchFn)
      .refreshTokens("TG-x")
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(MarketplaceApiError);
    expect(String(error)).not.toContain(config.clientSecret);
    expect(String(error)).not.toContain("TG-x");
  });

  it("rejects an unexpected response shape", async () => {
    const fetchFn = fakeFetch({ status: 200, body: { hello: "world" } });
    await expect(
      createMercadoLivreConnector(config, fetchFn).exchangeCode({ code: "c", codeVerifier: "v" }),
    ).rejects.toBeInstanceOf(MarketplaceApiError);
  });
});

describe("account profile", () => {
  it("reads /users/me with the bearer token", async () => {
    const fetchFn = fakeFetch({
      status: 200,
      body: {
        id: 1234567,
        nickname: "LOJA_TESTE",
        site_id: "MLB",
        tags: ["normal", "user_product_seller"],
      },
    });
    const profile = await createMercadoLivreConnector(config, fetchFn).getAccountProfile(
      "APP_USR-1",
    );
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.mercadolibre.com/users/me");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer APP_USR-1");
    expect(profile).toEqual({
      externalUserId: "1234567",
      nickname: "LOJA_TESTE",
      siteId: "MLB",
      listingModel: "user_products",
      multiWarehouse: false,
    });
  });

  it("401 means the seller must reconnect", async () => {
    const fetchFn = fakeFetch({ status: 401, body: {} });
    await expect(
      createMercadoLivreConnector(config, fetchFn).getAccountProfile("bad"),
    ).rejects.toBeInstanceOf(MarketplaceAuthError);
  });
});

it("detects multi-origin sellers by the warehouse_management tag", async () => {
  const fetchFn = fakeFetch({
    status: 200,
    body: { id: 1, nickname: "X", tags: ["normal", "warehouse_management"] },
  });
  const profile = await createMercadoLivreConnector(config, fetchFn).getAccountProfile("t");
  expect(profile.multiWarehouse).toBe(true);
});

describe("listingModelFromTags", () => {
  it("detects User Products sellers by the documented tag", () => {
    expect(listingModelFromTags(["normal", "user_product_seller"])).toBe("user_products");
    expect(listingModelFromTags(["normal"])).toBe("traditional");
    expect(listingModelFromTags(undefined)).toBe("unknown");
  });
});

describe("mlFetch", () => {
  it("retries on 429 and then succeeds", async () => {
    const fetchFn = fakeFetch({ status: 429, body: {} }, { status: 200, body: { ok: true } });
    const response = await mlFetch(
      fetchFn,
      "https://api.mercadolibre.com/x",
      {},
      { retryDelayMs: 1 },
    );
    expect(response.status).toBe(200);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("does not retry 4xx errors", async () => {
    const fetchFn = fakeFetch({ status: 400, body: {} });
    const response = await mlFetch(
      fetchFn,
      "https://api.mercadolibre.com/x",
      {},
      { retryDelayMs: 1 },
    );
    expect(response.status).toBe(400);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("gives up after 3 network failures with an API error", async () => {
    const fetchFn = vi.fn(async () => {
      throw new TypeError("fetch failed");
    }) as unknown as FetchFn;
    await expect(
      mlFetch(fetchFn, "https://api.mercadolibre.com/x", {}, { retryDelayMs: 1 }),
    ).rejects.toBeInstanceOf(MarketplaceApiError);
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });
});
