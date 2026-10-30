import { scryptSync, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Derives a secure salt:hash scrypt string for passwords.
 */
export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const derivedKey = scryptSync(password, salt, 64);
  return `${salt}:${derivedKey.toString("hex")}`;
}

/**
 * Constant-time password comparison.
 */
export function verifyPassword(password: string, storedHash: string | null | undefined): boolean {
  if (!storedHash || !storedHash.includes(":")) return false;
  const [salt, keyHex] = storedHash.split(":");
  if (!salt || !keyHex) return false;
  try {
    const keyBuf = Buffer.from(keyHex, "hex");
    const derivedKey = scryptSync(password, salt, 64);
    if (keyBuf.length !== derivedKey.length) return false;
    return timingSafeEqual(keyBuf, derivedKey);
  } catch {
    return false;
  }
}
