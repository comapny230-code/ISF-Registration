/**
 * Booking test support: seeding, API calls, a separate lock-holder connection for
 * deterministic races, database-clock waits, and the invariant checker (INV).
 */
import postgres from "postgres";
import { expect } from "vitest";
import * as stallsRoute from "@/app/v1/booking/stalls/route";
import * as meRoute from "@/app/v1/booking/me/route";
import * as holdsRoute from "@/app/v1/booking/holds/route";
import * as holdRoute from "@/app/v1/booking/holds/[holdId]/route";
import * as confirmRoute from "@/app/v1/booking/holds/[holdId]/confirm/route";
import { createSession } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { apiRequest, call } from "./http";

export type Sql = postgres.Sql;

export async function configureBooking(overrides: Partial<{
  booking_enabled: boolean;
  hold_seconds: number;
  eligible_tracks: string[];
  require_team_approval: boolean;
  rehold_cooldown_seconds: number;
  max_new_holds_per_hour: number;
  public_map: boolean;
  show_hold_expiry_publicly: boolean;
  opens_in_seconds: number;
  closes_in_seconds: number;
}> = {}) {
  const sql = await getDb();
  const s = {
    booking_enabled: true,
    hold_seconds: 300,
    eligible_tracks: ["senior", "junior"],
    require_team_approval: false,
    rehold_cooldown_seconds: 600,
    max_new_holds_per_hour: 100,
    public_map: false,
    show_hold_expiry_publicly: false,
    opens_in_seconds: -3600,
    closes_in_seconds: 3600,
    ...overrides,
  };
  await sql`
    update booking.settings set
      booking_enabled = ${s.booking_enabled}, hold_seconds = ${s.hold_seconds},
      eligible_tracks = ${s.eligible_tracks}::text[], require_team_approval = ${s.require_team_approval},
      rehold_cooldown_seconds = ${s.rehold_cooldown_seconds}, max_new_holds_per_hour = ${s.max_new_holds_per_hour},
      public_map = ${s.public_map}, show_hold_expiry_publicly = ${s.show_hold_expiry_publicly},
      opens_at = clock_timestamp() + make_interval(secs => ${s.opens_in_seconds}::int),
      closes_at = clock_timestamp() + make_interval(secs => ${s.closes_in_seconds}::int),
      updated_at = now(), updated_by = 'test'
    where edition_id = 2026`;
}

let stallCounter = 0;
export interface Stall {
  id: string;
  code: string;
}

/** Approved, active stalls with geometry in zone PG. */
export async function seedStalls(count: number, inventoryStatus: "approved" | "provisional" = "approved"): Promise<Stall[]> {
  const sql = await getDb();
  const [zone] = await sql`
    insert into booking.zones (edition_id, code, name, source_ref) values (2026, 'PG', 'Play Ground', 'test')
    on conflict (edition_id, code) do update set name = excluded.name returning id`;
  const stalls: Stall[] = [];
  for (let i = 0; i < count; i++) {
    const n = stallCounter++;
    const code = `PG-${String.fromCharCode(65 + Math.floor(n / 99))}${String((n % 99) + 1).padStart(2, "0")}`;
    const approved = inventoryStatus === "approved";
    const [row] = await sql`
      insert into booking.stalls (edition_id, zone_id, code, x_ft, y_ft, rotation_deg, inventory_status, source_ref)
      values (2026, ${zone.id}, ${code}, ${approved ? n * 10 : null}, ${approved ? 0 : null}, ${approved ? 0 : null},
              ${inventoryStatus}, 'test')
      returning id, code`;
    stalls.push({ id: row.id, code: row.code });
  }
  return stalls;
}

let leaderCounter = 0;
export interface Leader {
  userId: string;
  teamId: string;
  email: string;
  cookie: string;
}

/** A registered leader with a team row and a live session (direct SQL, for speed). */
export async function createLeader(track: "senior" | "junior" = "senior"): Promise<Leader> {
  const sql = await getDb();
  const n = ++leaderCounter;
  const email = `booking-leader${n}@example.test`;
  const [user] = await sql`insert into user_accounts (email, full_name) values (${email}, ${`Leader ${n}`}) returning id`;
  const table = track === "senior" ? sql`startup_team_leaders` : sql`student_innovators`;
  const [leaderRow] = await sql`
    insert into ${table} (user_id, team_name, full_name, email, mobile, alt_mobile, domain, city, state, linkedin_url, edition_id)
    values (${user.id}, ${`Team ${n}`}, ${`Leader ${n}`}, ${email}, '1', '2', 'd', 'c', 's', 'l', 2026) returning id`;
  const [team] = await sql`
    insert into booking.teams (edition_id, leader_user_id, track, startup_team_leader_id, student_innovator_id, team_name_snapshot)
    values (2026, ${user.id}, ${track}, ${track === "senior" ? leaderRow.id : null}, ${track === "junior" ? leaderRow.id : null}, ${`Team ${n}`})
    returning id`;
  return { userId: user.id, teamId: team.id, email, cookie: await newSessionCookie(user.id) };
}

export async function newSessionCookie(userId: string): Promise<string> {
  const sql = await getDb();
  const session = await sql.begin((tx) => createSession(tx, "leader", userId));
  return `__Host-sj_session=${session.token}`;
}

export async function createLeaders(count: number): Promise<Leader[]> {
  const leaders: Leader[] = [];
  for (let i = 0; i < count; i++) leaders.push(await createLeader());
  return leaders;
}

// --- API -------------------------------------------------------------------

export const hold = (cookie: string, stallId: string) =>
  call(holdsRoute.POST, apiRequest("/v1/booking/holds", { stallId }, { cookie }));

export const confirm = (cookie: string, holdId: string, token: string) =>
  call((req) => confirmRoute.POST(req, { params: Promise.resolve({ holdId }) }),
    apiRequest(`/v1/booking/holds/${holdId}/confirm`, { token }, { cookie }));

export const release = (cookie: string, holdId: string) =>
  call((req) => holdRoute.DELETE(req, { params: Promise.resolve({ holdId }) }),
    apiRequest(`/v1/booking/holds/${holdId}`, {}, { cookie, method: "DELETE" }));

export const me = (cookie?: string) => call(meRoute.GET, apiRequest("/v1/booking/me", undefined, { cookie }));

export const stalls = (cookie?: string, query = "") =>
  call(stallsRoute.GET, apiRequest(`/v1/booking/stalls${query}`, undefined, { cookie }));

// --- Lock holder and clock helpers --------------------------------------------

/** A separate connection (outside the app pool) that holds row locks for deterministic races. */
export async function lockHolder() {
  const holder = postgres(process.env.TEST_DATABASE_URL!, { max: 1, onnotice: () => {} });
  const conn = await holder.reserve();
  await conn`begin`;
  return {
    conn,
    async lockStall(stallId: string) {
      await conn`select id from booking.stalls where id = ${stallId} for update`;
    },
    async release() {
      await conn`rollback`.catch(() => {});
      conn.release();
      await holder.end({ timeout: 1 });
    },
  };
}

export async function waitUntil(check: () => Promise<boolean>, timeoutMs = 15_000, label = "condition"): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`timed out waiting for ${label}`);
}

/** Waits until at least n backends of this database are blocked on a lock. */
export async function waitForLockWaiters(n: number): Promise<void> {
  const sql = await getDb();
  await waitUntil(async () => {
    const [row] = await sql`
      select count(*)::int as n from pg_stat_activity
       where datname = current_database() and wait_event_type = 'Lock'`;
    return row.n >= n;
  }, 15_000, `${n} lock waiter(s)`);
}

/** Waits until the DATABASE clock has passed the reservation's expiry by marginMs. */
export async function waitForExpiry(reservationId: string, marginMs = 300): Promise<void> {
  const sql = await getDb();
  await waitUntil(async () => {
    const [row] = await sql`
      select clock_timestamp() > expires_at + make_interval(secs => ${marginMs / 1000}::float8) as past
        from booking.reservations where id = ${reservationId}`;
    return row.past;
  }, 20_000, "hold expiry");
}

// --- Invariants (INV, spec §9.3) ---------------------------------------------

export async function assertInvariants(): Promise<void> {
  const sql = await getDb();
  const [inv] = await sql`
    select
      (select count(*) from (select stall_id from booking.reservations where status in ('held','confirmed') group by stall_id having count(*) > 1) x)::int as duplicate_stall_claims,
      (select count(*) from (select team_id from booking.reservations where status in ('held','confirmed') group by team_id having count(*) > 1) x)::int as duplicate_team_claims,
      (select count(*) from booking.reservations where status in ('confirmed','cancelled') and (booking_id is null or booking_ref is null))::int as bookings_without_ids,
      (select count(*) from booking.reservations r join booking.stalls s on s.id = r.stall_id
        where r.status = 'held' and r.expires_at > clock_timestamp() and not s.bookable)::int as live_holds_on_unbookable,
      (select count(*) from booking.reservations r where not exists
        (select 1 from booking.audit_events a where a.reservation_id = r.id and a.action = 'hold_created'))::int as missing_hold_created,
      (select count(*) from booking.reservations r where r.status in ('confirmed','cancelled') and not exists
        (select 1 from booking.audit_events a where a.reservation_id = r.id and a.action = 'booking_confirmed'))::int as missing_booking_confirmed,
      (select count(*) from booking.reservations r where r.status = 'released' and not exists
        (select 1 from booking.audit_events a where a.reservation_id = r.id and a.action = 'hold_released'))::int as missing_hold_released,
      (select count(*) from booking.reservations r where r.status = 'expired' and not exists
        (select 1 from booking.audit_events a where a.reservation_id = r.id and a.action = 'hold_expired'))::int as missing_hold_expired,
      (select count(*) from (select reservation_id, action from booking.audit_events
        where action in ('hold_created','booking_confirmed','hold_released','hold_expired')
        group by reservation_id, action having count(*) > 1) x)::int as duplicate_audit_events,
      (select count(*) from booking.audit_events where jsonb_typeof(details) <> 'object')::int as non_object_audit_details`;
  expect(inv).toEqual({
    duplicate_stall_claims: 0,
    duplicate_team_claims: 0,
    bookings_without_ids: 0,
    live_holds_on_unbookable: 0,
    missing_hold_created: 0,
    missing_booking_confirmed: 0,
    missing_hold_released: 0,
    missing_hold_expired: 0,
    duplicate_audit_events: 0,
    non_object_audit_details: 0,
  });
}
