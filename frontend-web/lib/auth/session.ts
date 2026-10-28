/**
 * Opaque server-side sessions (docs/STALL_BOOKING_FINAL_SPEC.md §3.4).
 * The cookie carries 256 random bits; only its SHA-256 is stored. All expiry
 * decisions use the database clock.
 */
import type postgres from "postgres";
import { readCookie } from "../http";
import { randomToken, sha256 } from "./crypto";

export type Audience = "leader" | "admin";

export const SESSION_COOKIE: Record<Audience, string> = {
  leader: "__Host-sj_session",
  admin: "__Host-sj_admin",
};

const LIFETIME: Record<Audience, { idleMinutes: number; absoluteMinutes: number }> = {
  leader: { idleMinutes: 120, absoluteMinutes: 12 * 60 },
  admin: { idleMinutes: 30, absoluteMinutes: 8 * 60 },
};

export const MAX_LIVE_SESSIONS = 5;
export const STEP_UP_MINUTES = 10;
const SLIDE_AFTER_MINUTES = 5;

export interface Session {
  id: string;
  audience: Audience;
  principalId: string;
  displayName: string;
  absoluteExpiresAt: Date;
  reauthFresh: boolean;
}

export interface CreatedSession {
  token: string;
  absoluteExpiresAt: Date;
  maxAgeSeconds: number;
}

/** Creates a session and revokes the principal's oldest sessions beyond the cap. */
export async function createSession(
  tx: postgres.TransactionSql,
  audience: Audience,
  principalId: string
): Promise<CreatedSession> {
  const token = randomToken();
  const { idleMinutes, absoluteMinutes } = LIFETIME[audience];
  const userId = audience === "leader" ? principalId : null;
  const adminUserId = audience === "admin" ? principalId : null;

  const [row] = await tx`
    insert into app_auth.sessions (token_hash, principal_type, user_id, admin_user_id, idle_expires_at, absolute_expires_at)
    values (${sha256(token)}, ${audience}, ${userId}, ${adminUserId},
            clock_timestamp() + make_interval(mins => ${idleMinutes}::int),
            clock_timestamp() + make_interval(mins => ${absoluteMinutes}::int))
    returning absolute_expires_at,
      floor(extract(epoch from (absolute_expires_at - clock_timestamp())))::int as max_age`;

  await tx`
    update app_auth.sessions set revoked_at = clock_timestamp(), revoke_reason = 'session_limit'
     where id in (
       select id from app_auth.sessions
        where revoked_at is null
          and ((${audience} = 'leader' and user_id = ${userId}) or (${audience} = 'admin' and admin_user_id = ${adminUserId}))
        order by created_at desc
        offset ${MAX_LIVE_SESSIONS}
     )`;

  return { token, absoluteExpiresAt: row.absolute_expires_at, maxAgeSeconds: row.max_age };
}

export async function revokeSessionToken(sql: postgres.ISql, token: string, reason: string): Promise<void> {
  await sql`
    update app_auth.sessions set revoked_at = clock_timestamp(), revoke_reason = ${reason}
     where token_hash = ${sha256(token)} and revoked_at is null`;
}

function cookieToken(request: Request, audience: Audience): string | null {
  const token = readCookie(request, SESSION_COOKIE[audience]);
  return token && /^[A-Za-z0-9_-]{43}$/.test(token) ? token : null;
}

/** Returns the live session for this audience, or null. Slides idle expiry at most every 5 minutes. */
export async function getSession(sql: postgres.ISql, request: Request, audience: Audience): Promise<Session | null> {
  const token = cookieToken(request, audience);
  if (!token) return null;

  const [row] = await sql`
    select s.id,
           coalesce(s.user_id, s.admin_user_id) as principal_id,
           coalesce(u.full_name, a.display_name) as display_name,
           s.absolute_expires_at,
           s.last_seen_at < clock_timestamp() - make_interval(mins => ${SLIDE_AFTER_MINUTES}::int) as should_slide,
           s.reauth_at > clock_timestamp() - make_interval(mins => ${STEP_UP_MINUTES}::int) as reauth_fresh
      from app_auth.sessions s
      left join public.user_accounts u on u.id = s.user_id and u.status = 'active'
      left join app_auth.admin_users a on a.id = s.admin_user_id and a.status = 'active'
     where s.token_hash = ${sha256(token)}
       and s.principal_type = ${audience}
       and s.revoked_at is null
       and s.idle_expires_at > clock_timestamp()
       and s.absolute_expires_at > clock_timestamp()
       and (u.id is not null or a.id is not null)`;
  if (!row) return null;

  if (row.should_slide) {
    await sql`
      update app_auth.sessions
         set last_seen_at = clock_timestamp(),
             idle_expires_at = least(clock_timestamp() + make_interval(mins => ${LIFETIME[audience].idleMinutes}::int), absolute_expires_at)
       where id = ${row.id} and revoked_at is null`;
  }

  return {
    id: row.id,
    audience,
    principalId: row.principal_id,
    displayName: row.display_name,
    absoluteExpiresAt: row.absolute_expires_at,
    reauthFresh: row.reauth_fresh,
  };
}

export function sessionTokenFrom(request: Request, audience: Audience): string | null {
  return cookieToken(request, audience);
}
