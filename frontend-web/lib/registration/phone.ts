/**
 * Country-aware phone number validation and E.164 normalisation.
 *
 * For India (country === 'India' or default):
 *   - 10-digit mobile numbers starting with 6, 7, 8, or 9.
 *   - Allows prefixes: +91, 91, 0, or plain 10 digits.
 *   - Formatted to +91XXXXXXXXXX.
 *
 * For other countries:
 *   - International E.164 phone numbers with country code (7 to 15 digits).
 *   - Starts with '+', e.g. +1 555 123 4567, +44 7911 123456.
 */

export interface PhoneValidationResult {
  valid: boolean;
  e164: string | null;
  error?: string;
}

export function validatePhoneNumber(input: string, country = "India"): PhoneValidationResult {
  if (!input || typeof input !== "string") {
    return { valid: false, e164: null, error: "Phone number is required." };
  }

  const raw = input.trim();
  const digitsOnly = raw.replace(/[\s\-().+]/g, "");

  if (!digitsOnly || !/^\d+$/.test(digitsOnly)) {
    return { valid: false, e164: null, error: "Phone number must contain only digits and optional '+' prefix." };
  }

  const isIndia = !country || country.trim().toLowerCase() === "india" || country.trim() === "+91";

  if (isIndia) {
    let nationalNumber = digitsOnly;

    // Strip leading 0 or 91 country code if present
    if (digitsOnly.length === 11 && digitsOnly.startsWith("0")) {
      nationalNumber = digitsOnly.slice(1);
    } else if (digitsOnly.length === 12 && digitsOnly.startsWith("91")) {
      nationalNumber = digitsOnly.slice(2);
    }

    if (nationalNumber.length !== 10) {
      return {
        valid: false,
        e164: null,
        error: "Indian mobile number must be exactly 10 digits (e.g. 98765 43210 or +91 98765 43210).",
      };
    }

    if (!/^[6-9]\d{9}$/.test(nationalNumber)) {
      return {
        valid: false,
        e164: null,
        error: "Indian mobile number must start with 6, 7, 8, or 9.",
      };
    }

    return { valid: true, e164: `+91${nationalNumber}` };
  }

  // International phone validation
  let intlDigits = raw.startsWith("+") ? raw.slice(1).replace(/[\s\-().]/g, "") : digitsOnly;

  if (intlDigits.length < 7 || intlDigits.length > 15) {
    return {
      valid: false,
      e164: null,
      error: "International phone number must have between 7 and 15 digits including country code.",
    };
  }

  if (!raw.startsWith("+") && !raw.startsWith("00")) {
    return {
      valid: false,
      e164: null,
      error: "International phone number must include your country calling code starting with '+' (e.g. +1 555 123 4567).",
    };
  }

  return { valid: true, e164: `+${intlDigits}` };
}

export function normalizeMobileNumber(input: string, country = "India"): string | null {
  const res = validatePhoneNumber(input, country);
  return res.valid ? res.e164 : null;
}

