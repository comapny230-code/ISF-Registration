/**
 * Hold tokens and booking references (spec §4.6).
 *
 * A hold token is derived, not stored: HMAC(key, holdId | teamId | expiresAt).
 * Any device of the same leader can therefore recover the same token
 * (GET /v1/booking/me), retries never invalidate it, and it is useless for
 * another team or a different hold. Expiry itself is enforced by the database.
 */
import { createHmac, randomInt } from "node:crypto";
import { constantTimeEqual } from "../auth/crypto";
import { getBookingConfig } from "../config";

export const HOLD_TOKEN_PATTERN = /^v1\.([a-z0-9]{1,8})\.([A-Za-z0-9_-]{43})$/;

function mac(secret: string, holdId: string, teamId: string, expiresAtMs: string): Buffer {
  return createHmac("sha256", secret).update(`sj-hold|v1|${holdId}|${teamId}|${expiresAtMs}`).digest();
}

export function issueHoldToken(holdId: string, teamId: string, expiresAtMs: string): string {
  const { currentKeyId, holdTokenKeys } = getBookingConfig();
  const signature = mac(holdTokenKeys.get(currentKeyId)!, holdId, teamId, expiresAtMs).toString("base64url");
  return `v1.${currentKeyId}.${signature}`;
}

export function verifyHoldToken(token: string, holdId: string, teamId: string, expiresAtMs: string): boolean {
  const match = HOLD_TOKEN_PATTERN.exec(token);
  if (!match) return false;
  const secret = getBookingConfig().holdTokenKeys.get(match[1]);
  if (!secret) return false;
  return constantTimeEqual(Buffer.from(match[2], "base64url"), mac(secret, holdId, teamId, expiresAtMs));
}

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** Human-readable booking reference, e.g. SJ26-7K3Q9PZM (CSPRNG). */
export function newBookingRef(): string {
  let out = "";
  for (let i = 0; i < 8; i++) out += CROCKFORD[randomInt(0, CROCKFORD.length)];
  return `SJ26-${out}`;
}
