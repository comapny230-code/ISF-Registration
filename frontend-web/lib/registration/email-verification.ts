/**
 * Email verification during registration (migration 0008): the leader must enter a code sent
 * to the registered address before the registration is accepted. Codes are bound to the
 * requesting browser through the same cookie as sign-in codes (lib/auth/otp.ts), stored only
 * as HMAC(OTP_PEPPER), limited to 5 attempts and 10 minutes, and counted atomically.
 */
import { randomUUID } from "node:crypto";
import type postgres from "postgres";
import { getAuthConfig } from "../config";
import { escapeHtml } from "../html";
import { HttpError } from "../http";
import { sendMail } from "../mail";
import { constantTimeEqual, hmac, sha256, sixDigitCode } from "../auth/crypto";

export const REGISTRATION_CODE_TTL_MINUTES = 10;
const MAX_ATTEMPTS = 5;

const codeMac = (challengeId: string, code: string) => hmac(getAuthConfig().otpPepper, `register:${challengeId}:${code}`);

/** Supersedes this browser's earlier registration code for the email and stores a new one. Returns the code. */
export async function issueRegistrationCode(sql: postgres.Sql, email: string, binding: string): Promise<string> {
  const code = sixDigitCode();
  const id = randomUUID();
  const bindingHash = sha256(binding);
  await sql.begin(async (tx) => {
    await tx`
      update app_auth.registration_email_challenges set superseded_at = clock_timestamp()
       where email = ${email} and binding_hash = ${bindingHash} and consumed_at is null and superseded_at is null`;
    await tx`
      insert into app_auth.registration_email_challenges (id, email, code_mac, binding_hash, expires_at)
      values (${id}, ${email}, ${codeMac(id, code)}, ${bindingHash},
              clock_timestamp() + make_interval(mins => ${REGISTRATION_CODE_TTL_MINUTES}::int))`;
  });
  if (Math.random() < 0.02) {
    await sql`delete from app_auth.registration_email_challenges where created_at < clock_timestamp() - interval '7 days'`;
  }
  return code;
}

const INVALID = () =>
  new HttpError(400, "EMAIL_CODE_INVALID", "The email verification code is invalid or has expired. Request a new code and try again.");

/**
 * Checks the code for this browser's latest registration challenge. Every check counts as an
 * attempt (committed even when wrong). On success the challenge is marked verified and its id
 * returned; persistRegistration consumes it in the registration transaction.
 */
export async function verifyRegistrationCode(sql: postgres.Sql, email: string, code: unknown, binding: string | null): Promise<string> {
  if (!binding || typeof code !== "string" || !/^\d{6}$/.test(code)) throw INVALID();
  const [challenge] = await sql`
    update app_auth.registration_email_challenges set attempts = attempts + 1
     where id = (
             select id from app_auth.registration_email_challenges
              where email = ${email} and binding_hash = ${sha256(binding)} and consumed_at is null and superseded_at is null
              order by created_at desc limit 1)
       and attempts < ${MAX_ATTEMPTS}::int and expires_at > clock_timestamp()
       and consumed_at is null and superseded_at is null
    returning id, code_mac`;
  if (!challenge || !constantTimeEqual(Buffer.from(challenge.code_mac), codeMac(challenge.id, code))) throw INVALID();
  await sql`update app_auth.registration_email_challenges set verified_at = coalesce(verified_at, clock_timestamp()) where id = ${challenge.id}`;
  return challenge.id as string;
}

export async function sendRegistrationCodeEmail(to: string, code: string): Promise<void> {
  await sendMail({
    to,
    subject: `Your Startup Jathara registration code: ${code}`,
    html: `
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:480px;margin:20px auto;padding:28px;border:1px solid #e8dfd3;border-radius:14px;">
        <h2 style="margin:0 0 8px;color:#1c1917;font-size:20px;">Confirm your email address</h2>
        <p style="margin:0 0 16px;color:#57534e;font-size:14px;">Enter this code in the Startup Jathara registration form to confirm this is your email.</p>
        <p style="margin:0 0 16px;font-size:32px;font-weight:800;letter-spacing:6px;color:#c25022;">${escapeHtml(code)}</p>
        <p style="margin:0 0 6px;color:#57534e;font-size:13px;">The code expires in ${REGISTRATION_CODE_TTL_MINUTES} minutes and can be used for one registration.</p>
        <p style="margin:0;color:#57534e;font-size:13px;">If you did not start a registration, ignore this email.</p>
      </div>`,
  });
}
