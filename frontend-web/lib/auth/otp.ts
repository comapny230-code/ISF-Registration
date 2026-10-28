/**
 * Email one-time codes (docs/STALL_BOOKING_FINAL_SPEC.md §3.2).
 * Codes are stored only as HMAC(OTP_PEPPER, challengeId:code). Attempts are
 * counted atomically before comparison, so parallel guesses still count.
 */
import { randomUUID } from "node:crypto";
import type postgres from "postgres";
import { getAuthConfig } from "../config";
import { escapeHtml } from "../html";
import { sendMail } from "../mail";
import { constantTimeEqual, hmac, sixDigitCode } from "./crypto";
import { EDITION_ID } from "./leader";
import { createSession, revokeSessionToken, type Audience, type CreatedSession } from "./session";

export const OTP_TTL_MINUTES = 10;
export const OTP_MAX_ATTEMPTS = 5;

export interface Principal {
  id: string;
  displayName: string;
}

/** Leader: an active account with a leader registration for the edition. Admin: active with a live grant. */
export async function findPrincipal(sql: postgres.ISql, audience: Audience, email: string): Promise<Principal | null> {
  const rows =
    audience === "leader"
      ? await sql`
          select u.id, u.full_name as display_name
            from public.user_accounts u
           where lower(u.email) = ${email} and u.status = 'active'
             and (exists (select 1 from public.startup_team_leaders l where l.user_id = u.id and l.edition_id = ${EDITION_ID})
               or exists (select 1 from public.student_innovators s where s.user_id = u.id and s.edition_id = ${EDITION_ID}))`
      : await sql`
          select a.id, a.display_name
            from app_auth.admin_users a
           where a.email = ${email} and a.status = 'active'
             and exists (select 1 from app_auth.admin_grants g where g.admin_user_id = a.id and g.revoked_at is null)`;
  return rows[0] ? { id: rows[0].id, displayName: rows[0].display_name } : null;
}

function codeMac(challengeId: string, code: string): Buffer {
  return hmac(getAuthConfig().otpPepper, `${challengeId}:${code}`);
}

/** Supersedes earlier codes for this email and stores a new one. Returns the plaintext code for delivery. */
export async function issueLoginCode(
  sql: postgres.Sql,
  audience: Audience,
  email: string,
  principal: Principal
): Promise<string> {
  const code = sixDigitCode();
  const challengeId = randomUUID();
  await sql.begin(async (tx) => {
    await tx`
      update app_auth.login_challenges set superseded_at = clock_timestamp()
       where audience = ${audience} and email = ${email} and consumed_at is null and superseded_at is null`;
    await tx`
      insert into app_auth.login_challenges (id, audience, email, user_id, admin_user_id, code_mac, expires_at)
      values (${challengeId}, ${audience}, ${email},
              ${audience === "leader" ? principal.id : null}, ${audience === "admin" ? principal.id : null},
              ${codeMac(challengeId, code)}, clock_timestamp() + make_interval(mins => ${OTP_TTL_MINUTES}::int))`;
  });
  if (Math.random() < 0.02) {
    await sql`delete from app_auth.login_challenges where created_at < clock_timestamp() - interval '7 days'`;
  }
  return code;
}

export interface VerifiedLogin extends CreatedSession {
  displayName: string;
}

/**
 * Verifies a code and, on success, consumes it and creates a session in the same
 * transaction. A failed comparison still commits the attempt counter.
 * Returns null for every kind of failure.
 */
export async function verifyCodeAndStartSession(
  sql: postgres.Sql,
  audience: Audience,
  email: string,
  code: string,
  replacedToken: string | null
): Promise<VerifiedLogin | null> {
  return sql.begin(async (tx) => {
    const [challenge] = await tx`
      update app_auth.login_challenges set attempts = attempts + 1
       where id = (
               select id from app_auth.login_challenges
                where audience = ${audience} and email = ${email}
                  and consumed_at is null and superseded_at is null
                order by created_at desc limit 1)
         and attempts < ${OTP_MAX_ATTEMPTS}::int
         and expires_at > clock_timestamp()
         and consumed_at is null and superseded_at is null
      returning id, code_mac, coalesce(user_id, admin_user_id) as principal_id`;
    if (!challenge) return null;
    if (!constantTimeEqual(Buffer.from(challenge.code_mac), codeMac(challenge.id, code))) return null;

    const consumed = await tx`
      update app_auth.login_challenges set consumed_at = clock_timestamp()
       where id = ${challenge.id} and consumed_at is null
      returning id`;
    if (consumed.length === 0) return null;

    const principal = await findPrincipal(tx, audience, email);
    if (!principal || principal.id !== challenge.principal_id) return null;

    if (replacedToken) await revokeSessionToken(tx, replacedToken, "rotated");
    const session = await createSession(tx, audience, principal.id);
    return { ...session, displayName: principal.displayName };
  });
}

export async function sendLoginCodeEmail(to: string, code: string, audience: Audience): Promise<void> {
  const purpose = audience === "admin" ? "the Startup Jathara administration console" : "Startup Jathara stall booking";
  await sendMail({
    to,
    subject: `Your Startup Jathara sign-in code: ${code}`,
    html: `
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:480px;margin:20px auto;padding:28px;border:1px solid #e8dfd3;border-radius:14px;">
        <h2 style="margin:0 0 8px;color:#1c1917;font-size:20px;">Your sign-in code</h2>
        <p style="margin:0 0 16px;color:#57534e;font-size:14px;">Use this code to sign in to ${escapeHtml(purpose)}.</p>
        <p style="margin:0 0 16px;font-size:32px;font-weight:800;letter-spacing:6px;color:#c25022;">${escapeHtml(code)}</p>
        <p style="margin:0 0 6px;color:#57534e;font-size:13px;">The code expires in ${OTP_TTL_MINUTES} minutes and can be used once.</p>
        <p style="margin:0;color:#57534e;font-size:13px;">Never share this code. Organisers will never ask you for it. If you did not request it, ignore this email.</p>
      </div>`,
  });
}
