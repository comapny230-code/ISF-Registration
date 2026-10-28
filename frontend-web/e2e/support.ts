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
    values (${user.id}, ${teamName}, ${`E2E Leader ${n}`}, ${email}, '1', '2', 'd', 'c', 's', 'l', 2026) returning id`;
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
  await plantLoginCode(leader.email, code);
  const res = await context.request.post(`${E2E_ORIGIN}/v1/auth/otp/verify`, {
    headers: { origin: E2E_ORIGIN, "content-type": "application/json" },
    data: { email: leader.email, audience: "leader", code },
  });
  if (res.status() !== 200) throw new Error(`sign-in failed: ${res.status()} ${await res.text()}`);
}

/** Replaces any pending code for this email with a known one (for the login UI test). */
export async function plantLoginCode(email: string, code: string) {
  const s = await db();
  const id = randomUUID();
  await s`update app_auth.login_challenges set superseded_at = clock_timestamp()
          where email = ${email} and consumed_at is null and superseded_at is null`;
  await s`
    insert into app_auth.login_challenges (id, audience, email, user_id, code_mac, expires_at)
    select ${id}, 'leader', ${email}, u.id, ${createHmac("sha256", E2E_ENV.OTP_PEPPER).update(`${id}:${code}`).digest()},
           clock_timestamp() + interval '10 minutes'
      from user_accounts u where lower(u.email) = ${email}`;
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
