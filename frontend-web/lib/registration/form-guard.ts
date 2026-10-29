/**
 * Cheap bot filters for the registration form:
 *  - a hidden "website" field that people never see or fill (bots that fill every field do);
 *  - a signed form token issued when the page loads; a registration submitted sooner than a
 *    person could fill the form in, or with a missing, forged or day-old token, is refused.
 * Neither stops a determined attacker on its own; the email code and rate limits do the rest.
 */
import { createHmac } from "node:crypto";
import { getAppEnv, getAuthConfig, getFeatureFlags } from "../config";
import { constantTimeEqual } from "../auth/crypto";
import { HttpError } from "../http";

export const HONEYPOT_FIELD = "website";

export const REGISTRATION_PAUSED_MESSAGE =
  "Registration is paused for maintenance. No new registrations or email codes are being accepted right now. Please check back later.";

/** Registration kill switch (REGISTRATION_OPEN). Checked before any database work or email. */
export function assertRegistrationOpen(): void {
  if (!getFeatureFlags().registrationOpen) {
    throw new HttpError(503, "REGISTRATION_PAUSED", REGISTRATION_PAUSED_MESSAGE, undefined, { "Retry-After": "3600" });
  }
}
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** Seconds a person needs at least to fill the form in. Lower only in local/test runs. */
export function minFillSeconds(env: Record<string, string | undefined> = process.env): number {
  const appEnv = getAppEnv(env);
  const configured = Number(env.REGISTRATION_MIN_FILL_SECONDS);
  if ((appEnv === "local" || appEnv === "test") && Number.isFinite(configured) && configured >= 0) return configured;
  return 20;
}

function sign(issuedAtMs: number): string {
  return createHmac("sha256", getAuthConfig().rateLimitKey).update(`sj-register-form|v1|${issuedAtMs}`).digest("base64url");
}

export function issueFormToken(now = Date.now()): string {
  return `v1.${now}.${sign(now)}`;
}

const REJECTED = () => new HttpError(400, "FORM_CHECK_FAILED", "Please reload the registration page and submit the form again.");

/** Throws 400 unless the token is genuine, at least the minimum fill time old, and under a day old. */
export function checkFormToken(token: unknown, now = Date.now()): void {
  const match = typeof token === "string" ? /^v1\.(\d{13})\.([A-Za-z0-9_-]{43})$/.exec(token) : null;
  if (!match) throw REJECTED();
  const issuedAt = Number(match[1]);
  if (!constantTimeEqual(Buffer.from(match[2], "latin1"), Buffer.from(sign(issuedAt), "latin1"))) throw REJECTED();
  const age = now - issuedAt;
  if (age > MAX_AGE_MS || age < 0) throw REJECTED();
  if (age < minFillSeconds() * 1000) {
    throw new HttpError(400, "FORM_TOO_FAST", "That was quicker than a person can fill in the form. Please check your details and submit again.");
  }
}

/** Throws 400 if the hidden field was filled in. */
export function checkHoneypot(body: Record<string, unknown>): void {
  const value = body[HONEYPOT_FIELD];
  if (value !== undefined && value !== null && String(value).trim() !== "") throw REJECTED();
}
