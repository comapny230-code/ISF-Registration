/** Optional Turnstile check: off without a key; with a key, only a Cloudflare-confirmed token passes. */
import { describe, expect, it } from "vitest";
import { captchaEnabled, checkCaptcha } from "@/lib/registration/captcha";

const ON = { TURNSTILE_SECRET_KEY: "test-secret", TURNSTILE_SITE_KEY: "test-site" };
const cloudflare = (body: unknown, status = 200) =>
  (async (_url: unknown, init?: RequestInit) => {
    calls.push(String(init?.body));
    return new Response(JSON.stringify(body), { status });
  }) as typeof fetch;
let calls: string[] = [];

describe("registration CAPTCHA (Turnstile)", () => {
  it("needs both keys or neither", () => {
    expect(() => captchaEnabled({ TURNSTILE_SECRET_KEY: "only-secret" })).toThrow(/must be set together/);
    expect(() => captchaEnabled({ TURNSTILE_SITE_KEY: "only-site" })).toThrow(/must be set together/);
  });

  it("is off, and accepts anything, when no secret key is configured", async () => {
    expect(captchaEnabled({})).toBe(false);
    await expect(checkCaptcha(undefined, "1.2.3.4", { env: {} })).resolves.toBeUndefined();
  });

  it("accepts a token Cloudflare confirms, sending the secret, token and client address", async () => {
    calls = [];
    await expect(checkCaptcha("tok", "1.2.3.4", { env: ON, fetchImpl: cloudflare({ success: true }) })).resolves.toBeUndefined();
    expect(calls[0]).toBe("secret=test-secret&response=tok&remoteip=1.2.3.4");
  });

  it("refuses a missing token without calling Cloudflare", async () => {
    calls = [];
    await expect(checkCaptcha("", "1.2.3.4", { env: ON, fetchImpl: cloudflare({ success: true }) })).rejects.toMatchObject({
      status: 400,
      code: "CAPTCHA_FAILED",
    });
    expect(calls).toHaveLength(0);
  });

  it("refuses a token Cloudflare rejects", async () => {
    await expect(
      checkCaptcha("bad", "1.2.3.4", { env: ON, fetchImpl: cloudflare({ success: false, "error-codes": ["invalid-input-response"] }) })
    ).rejects.toMatchObject({ status: 400, code: "CAPTCHA_FAILED" });
    await expect(checkCaptcha("tok", "1.2.3.4", { env: ON, fetchImpl: cloudflare({ success: true }, 500) })).rejects.toMatchObject({
      code: "CAPTCHA_FAILED",
    });
  });

  it("fails closed (503) when Cloudflare cannot be reached", async () => {
    const down = (async () => {
      throw new TypeError("fetch failed");
    }) as typeof fetch;
    await expect(checkCaptcha("tok", "1.2.3.4", { env: ON, fetchImpl: down })).rejects.toMatchObject({ status: 503, code: "CAPTCHA_UNAVAILABLE" });
  });
});
