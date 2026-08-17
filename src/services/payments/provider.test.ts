import { afterEach, describe, expect, it, vi } from "vitest";
import { isDomainError } from "@/lib/errors";
import { providerFetch, readProviderJson } from "./provider";

/**
 * The transport boundary.
 *
 * Drivers modelled "the provider declined" carefully and did not model "we
 * never reached the provider" at all — those rejected with a bare `TypeError`,
 * which is not a `DomainError`, so the customer was told "Something went wrong
 * on our side" and the log had no provider attached.
 *
 * `ProviderUnavailableError` existed for this and had zero callers.
 */

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("providerFetch", () => {
  it("returns the response when the call completes", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 200 })),
    );

    const response = await providerFetch("paystack", "https://api.paystack.co/x", {
      method: "GET",
    });

    expect(response.status).toBe(200);
  });

  it("turns a network rejection into a modelled provider outage", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      }),
    );

    const caught = await providerFetch("paystack", "https://api.paystack.co/x", {
      method: "GET",
    }).catch((error: unknown) => error);

    expect(isDomainError(caught)).toBe(true);
    expect((caught as { code: string }).code).toBe("PROVIDER_UNAVAILABLE");
  });

  it("keeps the original failure as `cause` for the log", async () => {
    const underlying = new TypeError("getaddrinfo ENOTFOUND api.paystack.co");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw underlying;
      }),
    );

    const caught = (await providerFetch("paystack", "https://api.paystack.co/x", {
      method: "GET",
    }).catch((error: unknown) => error)) as Error;

    expect(caught.cause).toBe(underlying);
    // The hostname is diagnostic, not customer-facing.
    expect(caught.message).not.toContain("ENOTFOUND");
  });

  it("names the provider that was unreachable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      }),
    );

    const caught = (await providerFetch("stripe", "https://api.stripe.com/x", {
      method: "GET",
    }).catch((error: unknown) => error)) as { context?: { provider?: string } };

    expect(caught.context?.provider).toBe("stripe");
  });

  it("passes an abort signal so a hung provider cannot hold the action open", async () => {
    const spy = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(
      async () => new Response("{}"),
    );
    vi.stubGlobal("fetch", spy);

    await providerFetch("paypal", "https://api.paypal.com/x", { method: "GET" });

    expect(spy.mock.calls[0]?.[1]).toHaveProperty("signal");
  });
});

describe("readProviderJson", () => {
  it("parses a JSON body", async () => {
    const parsed = await readProviderJson<{ status: boolean }>(
      "paystack",
      new Response(JSON.stringify({ status: true }), { status: 200 }),
    );

    expect(parsed.status).toBe(true);
  });

  it("treats a non-JSON 200 as an outage rather than an empty object", async () => {
    // A proxy or captive portal answering with HTML. The old code turned this
    // into `{}`, which passed every `status === false` guard and only failed
    // several lines later reaching into `data.authorization_url`.
    const caught = await readProviderJson(
      "paystack",
      new Response("<html>502 Bad Gateway</html>", { status: 200 }),
    ).catch((error: unknown) => error);

    expect(isDomainError(caught)).toBe(true);
    expect((caught as { code: string }).code).toBe("PROVIDER_UNAVAILABLE");
  });

  it("reads an empty body as an empty object", async () => {
    await expect(
      readProviderJson("stripe", new Response("", { status: 200 })),
    ).resolves.toEqual({});
  });
});
