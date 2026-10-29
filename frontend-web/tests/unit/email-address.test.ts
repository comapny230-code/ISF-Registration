import { describe, expect, it } from "vitest";
import { isSafeEmailAddress } from "@/lib/email-address";

describe("safe email addresses (nodemailer address-parser mitigation)", () => {
  it("accepts ordinary addresses", () => {
    for (const ok of ["a@example.org", "first.last+tag@sub.example.co.in", "o'brien@example.test", "x_y-z%1@a-b.example"]) {
      expect(isSafeEmailAddress(ok), ok).toBe(true);
    }
  });

  it("rejects anything that could smuggle extra recipients or display text", () => {
    for (const bad of [
      "a@example.org, victim@evil.example",
      "a@example.org; victim@evil.example",
      '"victim@evil.example" <a@example.org>',
      "a@example.org <victim@evil.example>",
      "a(comment)@example.org",
      "a @example.org",
      "a@example",
      "a@-example.org",
      "@example.org",
      "a@@example.org",
      `${"a".repeat(250)}@example.org`,
    ]) {
      expect(isSafeEmailAddress(bad), bad).toBe(false);
    }
  });
});
