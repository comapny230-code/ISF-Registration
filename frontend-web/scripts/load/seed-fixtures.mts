#!/usr/bin/env node
/**
 * Seeds synthetic load-test fixtures and writes session tokens for k6.
 *
 *   APP_ENV=test|staging LOAD_DATABASE_URL=... PRODUCTION_DB_DENYLIST=... \
 *     node scripts/load/seed-fixtures.mts --leaders 150 --stalls 40 --admins 2 --out <file>
 *
 * Creates @example.test leaders with approved teams and leader sessions, a few admin
 * sessions (reports.view), and approved stalls in a dedicated "LD" load-test zone, and
 * opens booking (5-minute holds, no cooldown). With APP_ENV=test it first clears booking
 * state; on staging it never deletes anything and adds a fresh stall row letter per run.
 * The output file contains session tokens: keep it outside the repository.
 */
import { createHash, randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
import { connectLoadDatabase } from "./guard.mts";

function flag(name: string, fallback?: string): string {
  const i = process.argv.indexOf(`--${name}`);
  const value = i >= 0 ? process.argv[i + 1] : fallback;
  if (value === undefined) throw new Error(`--${name} is required`);
  return value;
}

const token = () => randomBytes(32).toString("base64url");
const hash = (t: string) => createHash("sha256").update(t).digest();

async function main() {
  const leaders = Number(flag("leaders", "150"));
  const stallCount = Number(flag("stalls", "40"));
  const admins = Number(flag("admins", "2"));
  const out = flag("out");
  if (!(stallCount >= 1 && stallCount <= 99)) throw new Error("--stalls must be 1..99 (one row letter)");

  const sql = await connectLoadDatabase(process.env);
  try {
    if (process.env.APP_ENV === "test") {
      await sql`truncate booking.audit_events, booking.reservations, booking.stalls, booking.zones, app_auth.rate_limits`;
    }
    const run = randomBytes(3).toString("hex");

    await sql`
      update booking.settings set booking_enabled = true, hold_seconds = 300, eligible_tracks = '{senior,junior}',
             require_team_approval = false, rehold_cooldown_seconds = 0, max_new_holds_per_hour = 100,
             opens_at = clock_timestamp() - interval '1 hour', closes_at = clock_timestamp() + interval '6 hours',
             updated_at = now(), updated_by = 'load-test seed'
       where edition_id = 2026`;

    const [zone] = await sql`
      insert into booking.zones (edition_id, code, name, extent_width_ft, extent_depth_ft, source_ref)
      values (2026, 'LD', 'Load test zone (synthetic)', 1000, 20, 'load-test seed')
      on conflict (edition_id, code) do update set name = excluded.name returning id`;
    const used = await sql`select distinct substr(code, 4, 1) as letter from booking.stalls where zone_id = ${zone.id}`;
    const letter = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").find((l) => !used.some((u) => u.letter === l));
    if (!letter) throw new Error("no free row letter left in the LD zone");
    const stalls = await sql`
      insert into booking.stalls (edition_id, zone_id, code, x_ft, y_ft, rotation_deg, inventory_status, source_ref)
      select 2026, ${zone.id}, 'LD-' || ${letter} || lpad(g::text, 2, '0'), g * 11, 5, 0, 'approved', 'load-test seed'
        from generate_series(1, ${stallCount}::int) g
      returning id, code`;

    const leaderTokens: string[] = [];
    for (let i = 0; i < leaders; i++) {
      const email = `load-${run}-${i}@example.test`;
      const [user] = await sql`insert into user_accounts (email, full_name) values (${email}, ${`Load Leader ${i}`}) returning id`;
      const [row] = await sql`
        insert into startup_team_leaders (user_id, team_name, full_name, email, mobile, alt_mobile, domain, city, state, linkedin_url, edition_id)
        values (${user.id}, ${`Load Team ${run}-${i}`}, ${`Load Leader ${i}`}, ${email}, '1', '2', 'd', 'c', 's', 'l', 2026) returning id`;
      await sql`
        insert into booking.teams (edition_id, leader_user_id, track, startup_team_leader_id, team_name_snapshot)
        values (2026, ${user.id}, 'senior', ${row.id}, ${`Load Team ${run}-${i}`})`;
      const t = token();
      await sql`
        insert into app_auth.sessions (token_hash, principal_type, user_id, idle_expires_at, absolute_expires_at)
        values (${hash(t)}, 'leader', ${user.id}, clock_timestamp() + interval '6 hours', clock_timestamp() + interval '6 hours')`;
      leaderTokens.push(t);
    }

    const adminTokens: string[] = [];
    for (let i = 0; i < admins; i++) {
      const [admin] = await sql`
        insert into app_auth.admin_users (email, display_name, created_by)
        values (${`load-admin-${run}-${i}@example.test`}, ${`Load Admin ${i}`}, 'load-test seed') returning id`;
      await sql`insert into app_auth.admin_grants (admin_user_id, permission, granted_by) values (${admin.id}, 'reports.view', 'load-test seed')`;
      const t = token();
      await sql`
        insert into app_auth.sessions (token_hash, principal_type, admin_user_id, idle_expires_at, absolute_expires_at)
        values (${hash(t)}, 'admin', ${admin.id}, clock_timestamp() + interval '6 hours', clock_timestamp() + interval '6 hours')`;
      adminTokens.push(t);
    }

    writeFileSync(out, JSON.stringify({ run, leaders: leaderTokens, admins: adminTokens, stalls: stalls.map((s) => ({ id: s.id, code: s.code })) }));
    console.log(`seeded run ${run}: ${leaders} leaders, ${admins} admins, ${stalls.length} stalls (LD-${letter}xx) -> ${out}`);
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(`ERROR ${err instanceof Error ? err.message : String(err)}`);
  process.exit(2);
});
