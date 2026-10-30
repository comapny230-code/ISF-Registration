/**
 * Phone numbers as the registration form stores them: E.164, with bare Indian numbers given +91
 * ("98765 43210", "098765...", "91 98765..." all become "+919876543210"). Null when unusable.
 */
export function normalizeMobileNumber(input: string): string | null {
  if (!input) return null;
  let s = String(input).trim().replace(/[\s\-().]/g, "");
  if (!s) return null;

  if (s.startsWith("00")) {
    s = "+" + s.slice(2);
  }
  if (/^[6-9]\d{9}$/.test(s)) return `+91${s}`;
  if (/^0[6-9]\d{9}$/.test(s)) return `+91${s.slice(1)}`;
  if (/^91[6-9]\d{9}$/.test(s)) return `+${s}`;
  if (/^\d{10}$/.test(s)) return `+91${s}`;
  if (/^0\d{10}$/.test(s)) return `+91${s.slice(1)}`;
  if (/^91\d{10}$/.test(s)) return `+${s}`;
  if (/^\+[1-9]\d{7,14}$/.test(s)) return s;
  if (/^[1-9]\d{7,14}$/.test(s)) return `+${s}`;

  return null;
}
