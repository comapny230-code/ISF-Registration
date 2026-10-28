/** SCH-01..10 for migrations 0004/0005: constraints and triggers enforce the rules without the app. */
import { beforeEach, describe, expect, it } from "vitest";
import { getDb } from "@/lib/db";
import { configureBooking, createLeader, seedStalls } from "../support/booking";

async function insertHold(stallId: string, teamId: string, userId: string) {
  const sql = await getDb();
  const [row] = await sql`
    insert into booking.reservations (edition_id, stall_id, team_id, created_by_user_id, status, held_at, expires_at)
    select 2026, ${stallId}, ${teamId}, ${userId}, 'held', t, t + make_interval(secs => s.hold_seconds)
      from (select clock_timestamp() as t) c, booking.settings s where s.edition_id = 2026
    returning id`;
  return row.id as string;
}

beforeEach(async () => {
  await configureBooking();
});

describe("live-claim uniqueness (SCH-01)", () => {
  it("allows only one live claim per stall and per team, independent of the application", async () => {
    const sql = await getDb();
    const [a, b] = [await createLeader(), await createLeader()];
    const [s1, s2] = await seedStalls(2);
    await insertHold(s1.id, a.teamId, a.userId);
    await expect(insertHold(s1.id, b.teamId, b.userId)).rejects.toMatchObject({ code: "23505", constraint_name: "reservations_live_stall_uq" });
    await expect(insertHold(s2.id, a.teamId, a.userId)).rejects.toMatchObject({ code: "23505", constraint_name: "reservations_live_team_uq" });
    const [n] = await sql`select count(*)::int as n from booking.reservations`;
    expect(n.n).toBe(1);
  });
});

describe("state machine trigger (SCH-02..05, SCH-10)", () => {
  it("rejects illegal transitions, identity changes and deletes", async () => {
    const sql = await getDb();
    const a = await createLeader();
    const [s1, s2] = await seedStalls(2);
    const id = await insertHold(s1.id, a.teamId, a.userId);
    await expect(sql`update booking.reservations set status = 'held' where id = ${id}`).rejects.toMatchObject({ code: "BK001" });
    await expect(sql`update booking.reservations set stall_id = ${s2.id} where id = ${id}`).rejects.toMatchObject({ code: "BK003" });
    await expect(sql`update booking.reservations set expires_at = expires_at + interval '1 minute' where id = ${id}`).rejects.toMatchObject({ code: "BK003" });
    await expect(sql`delete from booking.reservations where id = ${id}`).rejects.toMatchObject({ code: "BK004" });
    await expect(sql`update booking.reservations set status = 'expired', expired_at = clock_timestamp() where id = ${id}`).rejects.toMatchObject({ code: "BK006" });
    await expect(sql`update booking.reservations set status = 'cancelled' where id = ${id}`).rejects.toMatchObject({ code: "BK001" });

    await sql`update booking.reservations set status = 'released', released_at = clock_timestamp(), release_reason = 'leader', released_by_user_id = ${a.userId} where id = ${id}`;
    await expect(sql`update booking.reservations set status = 'held', released_at = null, release_reason = null, released_by_user_id = null where id = ${id}`).rejects.toMatchObject({ code: "BK001" });
  });

  it("requires the booking identifiers on confirmation (row CHECK)", async () => {
    const sql = await getDb();
    const a = await createLeader();
    const [s1] = await seedStalls(1);
    const id = await insertHold(s1.id, a.teamId, a.userId);
    await expect(sql`update booking.reservations set status = 'confirmed', confirmed_at = clock_timestamp(), confirmed_by_user_id = ${a.userId} where id = ${id}`).rejects.toMatchObject({ code: "23514" });
  });

  it("refuses to confirm at or after expiry even with a back-dated confirmed_at (BK002)", async () => {
    await configureBooking({ hold_seconds: 2 });
    const sql = await getDb();
    const a = await createLeader();
    const [s1] = await seedStalls(1);
    const id = await insertHold(s1.id, a.teamId, a.userId);
    await new Promise((r) => setTimeout(r, 2300));
    await expect(sql`
      update booking.reservations
         set status = 'confirmed', confirmed_at = held_at + interval '1 second', confirmed_by_user_id = ${a.userId},
             booking_id = gen_random_uuid(), booking_ref = 'SJ26-ABCDEFGH'
       where id = ${id}`).rejects.toMatchObject({ code: "BK002" });
  });

  it("rejects stale timestamps, wrong expiry, non-hold inserts and unbookable stalls on insert (BK005)", async () => {
    const sql = await getDb();
    const a = await createLeader();
    const [ok, provisional] = [(await seedStalls(1))[0], (await seedStalls(1, "provisional"))[0]];
    const insert = (stallId: string, heldAt: string, expiresAt: string, status = "held") =>
      sql`insert into booking.reservations (edition_id, stall_id, team_id, created_by_user_id, status, held_at, expires_at)
          values (2026, ${stallId}, ${a.teamId}, ${a.userId}, ${status}, ${heldAt}::timestamptz, ${expiresAt}::timestamptz)`;
    const [t] = await sql`select (clock_timestamp() - interval '1 minute')::text as stale, clock_timestamp()::text as now,
                                 (clock_timestamp() + interval '300 seconds')::text as plus300, (clock_timestamp() + interval '10 minutes')::text as plus600`;
    await expect(insert(ok.id, t.stale, t.plus300)).rejects.toMatchObject({ code: "BK005", hint: "stale_held_at" });
    await expect(insert(ok.id, t.now, t.plus600)).rejects.toMatchObject({ code: "BK005", hint: "bad_expiry" });
    await expect(insert(provisional.id, t.now, t.plus300)).rejects.toMatchObject({ code: "BK005" });
    await expect(insert(ok.id, t.now, t.plus300, "confirmed")).rejects.toMatchObject({ code: "BK005", hint: "not_held" });
  });
});

describe("inventory, audit and editions (SCH-06, SCH-07)", () => {
  it("cannot approve a stall without geometry, regress inventory status, or retire a stall with a live claim", async () => {
    const sql = await getDb();
    const a = await createLeader();
    const [provisional] = await seedStalls(1, "provisional");
    await expect(sql`update booking.stalls set inventory_status = 'approved' where id = ${provisional.id}`).rejects.toMatchObject({ code: "23514" });
    const [approved] = await seedStalls(1);
    await expect(sql`update booking.stalls set inventory_status = 'provisional' where id = ${approved.id}`).rejects.toMatchObject({ code: "BK001" });
    await expect(sql`update booking.stalls set code = 'PG-Z99' where id = ${approved.id}`).rejects.toMatchObject({ code: "BK003" });
    await insertHold(approved.id, a.teamId, a.userId);
    await expect(sql`update booking.stalls set inventory_status = 'retired' where id = ${approved.id}`).rejects.toMatchObject({ code: "BK009" });
  });

  it("keeps audit events append-only (BK007)", async () => {
    const sql = await getDb();
    await sql`insert into booking.audit_events (edition_id, action, actor_type, actor_operator) values (2026, 'settings_changed', 'operator', 'test')`;
    await expect(sql`update booking.audit_events set reason = 'x'`).rejects.toMatchObject({ code: "BK007" });
    await expect(sql`delete from booking.audit_events`).rejects.toMatchObject({ code: "BK007" });
  });

  it("cannot mix editions between a stall and a team (composite foreign keys)", async () => {
    const sql = await getDb();
    await sql`insert into event_editions (id, name) values (2027, 'Next') on conflict do nothing`;
    await sql`insert into booking.settings (edition_id, updated_by) values (2027, 'test') on conflict do nothing`;
    const a = await createLeader();
    const [s] = await seedStalls(1);
    const [t] = await sql`select clock_timestamp()::text as now, (clock_timestamp() + interval '300 seconds')::text as exp`;
    await expect(
      sql`insert into booking.reservations (edition_id, stall_id, team_id, created_by_user_id, status, held_at, expires_at)
          values (2027, ${s.id}, ${a.teamId}, ${a.userId}, 'held', ${t.now}::timestamptz, ${t.exp}::timestamptz)`
    ).rejects.toMatchObject({ code: "23503" });
  });

  it("starts with booking closed after migration (settings defaults)", async () => {
    // configureBooking() has already changed this file's settings row, so check the column defaults.
    const sql = await getDb();
    const all = await sql`
      select column_name, column_default from information_schema.columns
       where table_schema = 'booking' and table_name = 'settings' and column_name in ('booking_enabled', 'require_team_approval', 'hold_seconds')
       order by column_name`;
    expect(Object.fromEntries(all.map((c) => [c.column_name, c.column_default]))).toEqual({
      booking_enabled: "false",
      hold_seconds: "300",
      require_team_approval: "true",
    });
  });
});
