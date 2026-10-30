/**
 * AUTH-07b: the same-origin check after the 2026-10-30 review. The site's own address (as the
 * browser reached it, e.g. a Vercel preview URL) is accepted; a missing Origin, any other
 * *.vercel.app site, localhost in production, and cross-site fetches are refused.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { assertSameOriginJson, HttpError } from "@/lib/http";
import { getAuthConfig, getBookingConfig } from "@/lib/config";

function post(url: string, headers: Record<string, string>): Request {
  return new Request(url, { method: "POST", headers: { "content-type": "application/json", ...headers } });
}

function rejected(request: Request): boolean {
  try {
    assertSameOriginJson(request);
    return false;
  } catch (err) {
    if (err instanceof HttpError && err.status === 403) return true;
    throw err;
  }
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("AUTH-07b same-origin check", () => {
  it("accepts the configured origin and the deployment's own host", () => {
    expect(rejected(post("http://localhost:3000/v1/x", { origin: "http://localhost:3000", host: "localhost:3000" }))).toBe(false);
    expect(rejected(post("http://localhost:3000/v1/x", { origin: "http://preview.local:3000", host: "preview.local:3000" }))).toBe(false);
  });

  it("refuses a missing Origin, even with a same-site Referer", () => {
    expect(rejected(post("http://localhost:3000/v1/x", { host: "localhost:3000", referer: "http://localhost:3000/register" }))).toBe(true);
  });

  it("refuses other sites, including any *.vercel.app site", () => {
    expect(rejected(post("http://localhost:3000/v1/x", { origin: "https://attacker.vercel.app", host: "localhost:3000" }))).toBe(true);
    expect(rejected(post("http://localhost:3000/v1/x", { origin: "https://evil.example", host: "localhost:3000" }))).toBe(true);
  });

  it("refuses a cross-site or same-site (not same-origin) fetch", () => {
    for (const site of ["cross-site", "same-site", "none"]) {
      expect(rejected(post("http://localhost:3000/v1/x", { origin: "http://localhost:3000", host: "localhost:3000", "sec-fetch-site": site }))).toBe(true);
    }
  });

  it("in production, the own-host match is https only and localhost is not trusted", () => {
    vi.stubEnv("APP_ENV", "production");
    vi.stubEnv("APP_ORIGIN", "https://register.example.org");
    vi.stubEnv("MAIL_RECIPIENT_ALLOWLIST", "");
    expect(rejected(post("https://isf-preview.vercel.app/v1/x", { origin: "https://isf-preview.vercel.app", host: "isf-preview.vercel.app" }))).toBe(false);
    expect(rejected(post("https://isf-preview.vercel.app/v1/x", { origin: "http://isf-preview.vercel.app", host: "isf-preview.vercel.app" }))).toBe(true);
    expect(rejected(post("https://isf-preview.vercel.app/v1/x", { origin: "http://localhost:3000", host: "isf-preview.vercel.app" }))).toBe(true);
  });
});

describe("CFG-SECRETS no built-in keys", () => {
  it("refuses to run without the signing keys instead of using published defaults", () => {
    expect(() => getAuthConfig({ ...process.env, OTP_PEPPER: "" })).toThrow(/OTP_PEPPER/);
    expect(() => getAuthConfig({ ...process.env, RATE_LIMIT_HASH_KEY: "" })).toThrow(/RATE_LIMIT_HASH_KEY/);
    expect(() => getBookingConfig({ ...process.env, HOLD_TOKEN_KEYS: "" })).toThrow(/HOLD_TOKEN_KEYS/);
  });
});
