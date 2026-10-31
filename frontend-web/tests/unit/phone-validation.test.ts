import { describe, expect, it } from "vitest";
import { validatePhoneNumber, normalizeMobileNumber } from "@/lib/registration/phone";

describe("Phone number validation", () => {
  describe("India phone numbers", () => {
    it("accepts valid 10-digit Indian numbers starting with 6, 7, 8, 9", () => {
      expect(validatePhoneNumber("9876543210", "India")).toEqual({ valid: true, e164: "+919876543210" });
      expect(validatePhoneNumber("8123456789", "India")).toEqual({ valid: true, e164: "+918123456789" });
      expect(validatePhoneNumber("7000000000", "India")).toEqual({ valid: true, e164: "+917000000000" });
      expect(validatePhoneNumber("6999999999", "India")).toEqual({ valid: true, e164: "+916999999999" });
    });

    it("accepts formatted numbers with spaces, dashes, +91, 0, or 91 prefixes", () => {
      expect(validatePhoneNumber("+91 98765 43210", "India")).toEqual({ valid: true, e164: "+919876543210" });
      expect(validatePhoneNumber("09876543210", "India")).toEqual({ valid: true, e164: "+919876543210" });
      expect(validatePhoneNumber("919876543210", "India")).toEqual({ valid: true, e164: "+919876543210" });
      expect(validatePhoneNumber("98765-43210", "India")).toEqual({ valid: true, e164: "+919876543210" });
    });

    it("rejects Indian numbers starting with 0-5", () => {
      expect(validatePhoneNumber("1234567890", "India").valid).toBe(false);
      expect(validatePhoneNumber("5555555555", "India").valid).toBe(false);
      expect(validatePhoneNumber("0123456789", "India").valid).toBe(false);
    });

    it("rejects numbers that are too short or too long", () => {
      expect(validatePhoneNumber("987654321", "India").valid).toBe(false);
      expect(validatePhoneNumber("987654321012", "India").valid).toBe(false);
    });
  });

  describe("International phone numbers", () => {
    it("accepts valid international numbers starting with + and country code", () => {
      expect(validatePhoneNumber("+1 555 123 4567", "United States")).toEqual({ valid: true, e164: "+15551234567" });
      expect(validatePhoneNumber("+44 7911 123456", "United Kingdom")).toEqual({ valid: true, e164: "+447911123456" });
      expect(validatePhoneNumber("+971 50 123 4567", "UAE")).toEqual({ valid: true, e164: "+971501234567" });
    });

    it("rejects international numbers without + country code", () => {
      expect(validatePhoneNumber("5551234567", "United States").valid).toBe(false);
    });
  });

  describe("normalizeMobileNumber helper", () => {
    it("returns e164 for valid numbers and null for invalid", () => {
      expect(normalizeMobileNumber("9876543210")).toBe("+919876543210");
      expect(normalizeMobileNumber("1234567890")).toBeNull();
      expect(normalizeMobileNumber("+1 555 123 4567", "US")).toBe("+15551234567");
    });
  });
});
