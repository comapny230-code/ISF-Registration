import { describe, expect, it } from "vitest";
import { ConfigError, getAuthConfig } from "@/lib/config";
import { escapeHtml, safeHttpUrl } from "@/lib/html";

const KEY_A = "a".repeat(32);
const KEY_B = "b".repeat(32);
const base = { APP_ENV: "production", OTP_PEPPER: KEY_A, RATE_LIMIT_HASH_KEY: KEY_B, APP_ORIGIN: "https://register.example.org" };

describe("CFG-01 auth configuration", () => {
  it("accepts a complete production configuration", () => {
    expect(getAuthConfig(base)).toEqual({ otpPepper: KEY_A, rateLimitKey: KEY_B, allowedOrigins: ["https://register.example.org"] });
  });

  it.each([
    ["missing pepper", { OTP_PEPPER: undefined }, "OTP_PEPPER"],
    ["short pepper", { OTP_PEPPER: "short" }, "OTP_PEPPER"],
    ["missing rate-limit key", { RATE_LIMIT_HASH_KEY: undefined }, "RATE_LIMIT_HASH_KEY"],
    ["identical keys", { RATE_LIMIT_HASH_KEY: KEY_A }, "RATE_LIMIT_HASH_KEY"],
    ["missing origin", { APP_ORIGIN: undefined }, "APP_ORIGIN"],
    ["http origin in production", { APP_ORIGIN: "http://register.example.org" }, "APP_ORIGIN"],
    ["origin with a path", { APP_ORIGIN: "https://register.example.org/app" }, "APP_ORIGIN"],
    ["extra origins in production", { APP_EXTRA_ORIGINS: "https://preview.example.org" }, "APP_EXTRA_ORIGINS"],
  ])("rejects %s", (_label, override, variable) => {
    try {
      getAuthConfig({ ...base, ...override });
      throw new Error("expected ConfigError");
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigError);
      expect((err as ConfigError).variable).toBe(variable);
    }
  });

  it("allows preview origins outside production", () => {
    const cfg = getAuthConfig({ ...base, APP_ENV: "staging", APP_EXTRA_ORIGINS: "https://preview.example.org" });
    expect(cfg.allowedOrigins).toEqual(["https://register.example.org", "https://preview.example.org"]);
  });
});

describe("HTML escaping", () => {
  it("escapes markup and quotes", () => {
    expect(escapeHtml(`<a href="x" onclick='y'>&</a>`)).toBe("&lt;a href=&quot;x&quot; onclick=&#39;y&#39;&gt;&amp;&lt;/a&gt;");
    expect(escapeHtml(null)).toBe("");
  });

  it("only allows http(s) URLs", () => {
    expect(safeHttpUrl("https://example.org/a?b=1&c=2")).toBe("https://example.org/a?b=1&amp;c=2");
    for (const bad of ["javascript:alert(1)", "data:text/html,x", "vbscript:x", "not a url", ""]) {
      expect(safeHttpUrl(bad)).toBeNull();
    }
  });
});
