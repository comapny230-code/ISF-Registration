import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";

/** 256-bit random value, base64url (43 characters). */
export function randomToken(): string {
  return randomBytes(32).toString("base64url");
}

export function sha256(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

export function hmac(key: string, message: string): Buffer {
  return createHmac("sha256", key).update(message).digest();
}

export function hmacHex(key: string, message: string): string {
  return hmac(key, message).toString("hex");
}

/** Uniformly random six-digit code (CSPRNG). */
export function sixDigitCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, "0");
}

export function constantTimeEqual(a: Buffer, b: Buffer): boolean {
  return a.length === b.length && timingSafeEqual(a, b);
}
