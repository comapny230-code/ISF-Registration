/** Direct database fixtures for browser tests (guarded e2e database only). */
import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import type { APIRequestContext, BrowserContext } from "@playwright/test";
import postgres from "postgres";
import { assertTestDatabasePostConnect, assertTestEnvironmentPreConnect } from "../lib/safety/test-database-guard";
import { E2E_DATABASE, E2E_ENV, E2E_ORIGIN, e2eDatabaseUrl } from "./env";

let sql: postgres.Sql | null = null;

export async function db(): Promise<postgres.Sql> {
  if (!sql) {
    const url = e2eDatabaseUrl();
    assertTestEnvironmentPreConnect({ ...process.env, ...E2E_ENV, TEST_DATABASE_URL: url });
    const client = postgres(url, { max: 2, onnotice: () => {} });
    await assertTestDatabasePostConnect((q) => client.unsafe(q), E2E_DATABASE);
    sql = client;
  }
  return sql;
}

export async function closeDb() {
  await sql?.end({ timeout: 2 });
  sql = null;
}

/** Clears booking state between tests (owner-only TRUNCATE; the app role cannot do this). */
export async function resetBooking(settings: Partial<{ hold_seconds: number; require_team_approval: boolean; booking_enabled: boolean }> = {}) {
  const s = await db();
  await s`truncate booking.audit_events, booking.reservations, booking.stalls, booking.zones, app_auth.rate_limits`;
  const enabled = settings.booking_enabled ?? true;
  await s`
    update booking.settings set
      booking_enabled = ${enabled}, hold_seconds = ${settings.hold_seconds ?? 300},
      eligible_tracks = ${enabled ? ["senior", "junior"] : []}::text[],
      require_team_approval = ${settings.require_team_approval ?? false},
      rehold_cooldown_seconds = 0, max_new_holds_per_hour = 100,
      opens_at = clock_timestamp() - interval '1 hour', closes_at = clock_timestamp() + interval '1 hour',
      updated_at = now(), updated_by = 'e2e'
    where edition_id = 2026`;
}

export interface SeededStall {
  id: string;
  code: string;
}

/** Test-only geometry: a single row of stalls in zone PG (not venue data). */
export async function seedStalls(count: number, opts: { geometry?: boolean; zone?: string } = {}): Promise<SeededStall[]> {
  const s = await db();
  const geometry = opts.geometry ?? true;
  const zoneCode = opts.zone ?? "PG";
  const [zone] = await s`
    insert into booking.zones (edition_id, code, name, extent_width_ft, extent_depth_ft, landmarks, source_ref)
    values (2026, ${zoneCode}, ${zoneCode === "PG" ? "Play Ground" : "Basketball Ground"}, ${geometry ? 12 * count + 10 : null}, ${geometry ? 30 : null},
            '[{"label":"Field Entry","kind":"entry"}]'::jsonb, 'e2e')
    returning id`;
  const out: SeededStall[] = [];
  for (let i = 0; i < count; i++) {
    const code = `${zoneCode}-A${String(i + 1).padStart(2, "0")}`;
    const [row] = await s`
      insert into booking.stalls (edition_id, zone_id, code, x_ft, y_ft, rotation_deg, inventory_status, source_ref)
      values (2026, ${zone.id}, ${code}, ${geometry ? 5 + i * 12 : null}, ${geometry ? 10 : null}, ${geometry ? 0 : null},
              ${geometry ? "approved" : "provisional"}, 'e2e')
      returning id, code`;
    out.push({ id: row.id, code: row.code });
  }
  return out;
}

export interface Leader {
  userId: string;
  email: string;
  teamName: string;
  token: string;
}

let n = 0;
export async function createLeader(opts: { session?: boolean } = {}): Promise<Leader> {
  const s = await db();
  n += 1;
  const tag = `${Date.now()}${n}`;
  const email = `e2e-leader-${tag}@example.test`;
  const teamName = `E2E Team ${tag}`;
  const [user] = await s`insert into user_accounts (email, full_name) values (${email}, ${`E2E Leader ${n}`}) returning id`;
  const [leader] = await s`
    insert into startup_team_leaders (user_id, team_name, full_name, email, mobile, alt_mobile, domain, city, state, linkedin_url, edition_id)
    values (${user.id}, ${teamName}, ${`E2E Leader ${n}`}, ${email}, ${`8${tag.slice(-9)}`}, '2', 'd', 'c', 's', 'l', 2026) returning id`;
  await s`
    insert into booking.teams (edition_id, leader_user_id, track, startup_team_leader_id, team_name_snapshot)
    values (2026, ${user.id}, 'senior', ${leader.id}, ${teamName})`;
  let token = "";
  if (opts.session !== false) {
    token = randomBytes(32).toString("base64url");
    await s`
      insert into app_auth.sessions (token_hash, principal_type, user_id, idle_expires_at, absolute_expires_at)
      values (${createHash("sha256").update(token).digest()}, 'leader', ${user.id},
              clock_timestamp() + interval '2 hours', clock_timestamp() + interval '12 hours')`;
  }
  return { userId: user.id, email, teamName, token };
}

/**
 * Signs the browser context in through the real verify endpoint, so the
 * __Host- cookie is set by the server exactly as for a user (browsers refuse
 * injected __Host- cookies that carry a domain).
 */
export async function signIn(context: BrowserContext, leader: Leader) {
  const code = String(100000 + Math.floor(Math.random() * 900000));
  await requestCodeIn(context, leader.email, "leader");
  await plantLoginCode(leader.email, code);
  const res = await context.request.post(`${E2E_ORIGIN}/v1/auth/otp/verify`, {
    headers: { origin: E2E_ORIGIN, "content-type": "application/json" },
    data: { email: leader.email, audience: "leader", code },
  });
  if (res.status() !== 200) throw new Error(`sign-in failed: ${res.status()} ${await res.text()}`);
}

/** Requests a real code from inside the browser context, so the server sets its binding cookie there. */
async function requestCodeIn(context: BrowserContext, email: string, audience: "leader" | "admin") {
  const res = await context.request.post(`${E2E_ORIGIN}/v1/auth/otp/request`, {
    headers: { origin: E2E_ORIGIN, "content-type": "application/json" },
    data: { email, audience },
  });
  if (res.status() !== 202) throw new Error(`code request failed: ${res.status()}`);
}

/**
 * Sets the code of the latest pending challenge for this email to a known value. The
 * challenge keeps its binding, so only the browser that requested it can use the code.
 */
async function setPendingCode(audience: "leader" | "admin", email: string, code: string) {
  const s = await db();
  const [challenge] = await s`
    select id from app_auth.login_challenges
     where audience = ${audience} and email = ${email} and consumed_at is null and superseded_at is null
     order by created_at desc limit 1`;
  if (!challenge) throw new Error(`no pending ${audience} code for ${email}; request one in the browser first`);
  await s`
    update app_auth.login_challenges
       set code_mac = ${createHmac("sha256", E2E_ENV.OTP_PEPPER).update(`${challenge.id}:${code}`).digest()}, attempts = 0
     where id = ${challenge.id}`;
}

/** Replaces the registration email code the browser just requested with a known one. */
export async function plantRegistrationCode(email: string, code: string) {
  const s = await db();
  const [challenge] = await s`
    select id from app_auth.registration_email_challenges
     where email = ${email} and consumed_at is null and superseded_at is null
     order by created_at desc limit 1`;
  if (!challenge) throw new Error(`no pending registration code for ${email}; click Send verification code first`);
  await s`
    update app_auth.registration_email_challenges
       set code_mac = ${createHmac("sha256", E2E_ENV.OTP_PEPPER).update(`register:${challenge.id}:${code}`).digest()}, attempts = 0
     where id = ${challenge.id}`;
}

/** Replaces the code the browser just requested with a known one (for the login UI test). */
export async function plantLoginCode(email: string, code: string) {
  await setPendingCode("leader", email, code);
}

export interface AdminUser {
  id: string;
  email: string;
  name: string;
}

export async function createAdminUser(permissions: string[]): Promise<AdminUser> {
  const s = await db();
  n += 1;
  const email = `e2e-admin-${Date.now()}${n}@example.test`;
  const name = `E2E Admin ${n}`;
  const [admin] = await s`insert into app_auth.admin_users (email, display_name, created_by) values (${email}, ${name}, 'e2e') returning id`;
  for (const permission of permissions) {
    await s`insert into app_auth.admin_grants (admin_user_id, permission, granted_by) values (${admin.id}, ${permission}, 'e2e')`;
  }
  return { id: admin.id, email, name };
}

/** Replaces the administrator code the browser just requested with a known one. */
export async function plantAdminCode(email: string, code: string) {
  await setPendingCode("admin", email, code);
}

export async function signInAdmin(context: BrowserContext, admin: AdminUser) {
  await requestCodeIn(context, admin.email, "admin");
  await plantAdminCode(admin.email, "135790");
  const res = await context.request.post(`${E2E_ORIGIN}/v1/auth/otp/verify`, {
    headers: { origin: E2E_ORIGIN, "content-type": "application/json" },
    data: { email: admin.email, audience: "admin", code: "135790" },
  });
  if (res.status() !== 200) throw new Error(`admin sign-in failed: ${res.status()} ${await res.text()}`);
}

/** Holds and confirms a stall for a leader through the real API; returns the booking. */
export async function bookAs(request: APIRequestContext, leader: Leader, stallId: string) {
  const held = await (await holdAs(request, leader, stallId)).json();
  const res = await request.post(`${E2E_ORIGIN}/v1/booking/holds/${held.holdId}/confirm`, {
    headers: { origin: E2E_ORIGIN, cookie: `__Host-sj_session=${leader.token}`, "content-type": "application/json" },
    data: { token: held.token },
  });
  if (res.status() !== 201) throw new Error(`confirm failed: ${res.status()}`);
  return (await res.json()) as { bookingId: string; bookingRef: string };
}

/** Places a hold for another team through the real API (not the page under test). */
export async function holdAs(request: APIRequestContext, leader: Leader, stallId: string) {
  return request.post(`${E2E_ORIGIN}/v1/booking/holds`, {
    headers: { origin: E2E_ORIGIN, cookie: `__Host-sj_session=${leader.token}`, "content-type": "application/json" },
    data: { stallId },
  });
}

export async function liveClaimCounts() {
  const s = await db();
  const [row] = await s`
    select
      (select count(*) from (select stall_id from booking.reservations where status in ('held','confirmed') group by stall_id having count(*) > 1) x)::int as duplicate_stall_claims,
      (select count(*) from (select team_id from booking.reservations where status in ('held','confirmed') group by team_id having count(*) > 1) x)::int as duplicate_team_claims`;
  return row;
}
