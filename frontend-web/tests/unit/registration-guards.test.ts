/** Aadhaar check digit and the registration form's bot filters. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { isValidAadhaar, withAadhaarCheckDigit } from "@/lib/registration/aadhaar";
import { checkFormToken, checkHoneypot, issueFormToken, minFillSeconds } from "@/lib/registration/form-guard";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("Aadhaar check digit (Verhoeff)", () => {
  it("accepts numbers with a correct check digit and rejects every single-digit change", () => {
    const valid = withAadhaarCheckDigit("23456789012");
    expect(isValidAadhaar(valid)).toBe(true);
    for (let i = 0; i < 12; i++) {
      const d = Number(valid[i]);
      const changed = valid.slice(0, i) + String((d + 1) % 10) + valid.slice(i + 1);
      expect(isValidAadhaar(changed)).toBe(false);
    }
  });

  it("rejects invented and malformed numbers", () => {
    for (const bad of ["123412341234", "000000000000", "111111111111", "12345678901", "abcdefghijkl", "2345 6789 0123", ""]) {
      expect(isValidAadhaar(bad)).toBe(false);
    }
  });

  it("rejects adjacent-digit swaps, a common typo", () => {
    const valid = withAadhaarCheckDigit("98765432109");
    const swapped = valid[0] + valid[2] + valid[1] + valid.slice(3);
    if (swapped !== valid) expect(isValidAadhaar(swapped)).toBe(false);
  });
});

describe("registration form guards", () => {
  it("refuses a missing, forged or tampered form token", () => {
    expect(() => checkFormToken(undefined)).toThrow(expect.objectContaining({ code: "FORM_CHECK_FAILED" }));
    expect(() => checkFormToken("v1.1700000000000.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA")).toThrow(
      expect.objectContaining({ code: "FORM_CHECK_FAILED" })
    );
    const token = issueFormToken(Date.now() - 60_000);
    const [v, t, sig] = token.split(".");
    expect(() => checkFormToken(`${v}.${Number(t) - 1}.${sig}`)).toThrow(expect.objectContaining({ code: "FORM_CHECK_FAILED" }));
  });

  it("refuses a form submitted faster than a person can fill it in, and a day-old one", () => {
    vi.stubEnv("REGISTRATION_MIN_FILL_SECONDS", "20");
    const now = Date.now();
    expect(() => checkFormToken(issueFormToken(now - 5_000), now)).toThrow(expect.objectContaining({ code: "FORM_TOO_FAST" }));
    expect(() => checkFormToken(issueFormToken(now - 25_000), now)).not.toThrow();
    expect(() => checkFormToken(issueFormToken(now - 25 * 60 * 60 * 1000), now)).toThrow(
      expect.objectContaining({ code: "FORM_CHECK_FAILED" })
    );
  });

  it("never lets staging or production lower the minimum fill time", () => {
    expect(minFillSeconds({ APP_ENV: "production", REGISTRATION_MIN_FILL_SECONDS: "0" })).toBe(20);
    expect(minFillSeconds({ APP_ENV: "staging", REGISTRATION_MIN_FILL_SECONDS: "0" })).toBe(20);
    expect(minFillSeconds({ APP_ENV: "test", REGISTRATION_MIN_FILL_SECONDS: "0" })).toBe(0);
  });

  it("refuses a filled-in hidden field", () => {
    expect(() => checkHoneypot({ website: "http://spam.example" })).toThrow(expect.objectContaining({ code: "FORM_CHECK_FAILED" }));
    expect(() => checkHoneypot({ website: "" })).not.toThrow();
    expect(() => checkHoneypot({})).not.toThrow();
  });
});
