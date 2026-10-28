/**
 * Concurrency races (spec §9.3 RACE-01..12). Requests run in parallel through the
 * real route handlers and the app's own connection pool; deterministic races use a
 * separate connection that holds row locks while requests queue behind it.
 *
 * Not covered here (documented): 3 separate app instances behind PgBouncer
 * transaction pooling (no Docker/PgBouncer on the development machine; staging/P6).
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getDb } from "@/lib/db";
import { armFault, clearFaults, SimulatedConnectionError } from "@/lib/db/faults";
import {
  assertInvariants,
  confirm,
  configureBooking,
  createLeader,
  createLeaders,
  hold,
  lockHolder,
  me,
  newSessionCookie,
  release,
  seedStalls,
  waitForExpiry,
  waitForLockWaiters,
  waitUntil,
} from "../support/booking";

beforeEach(async () => {
  await configureBooking();
});

afterEach(async () => {
  clearFaults();
  await assertInvariants();
});

describe("RACE-01 many teams, one stall", () => {
  it("100 leaders requesting the same stall at once: exactly one hold per round (10 rounds)", async () => {
    const leaders = await createLeaders(100);
    const rounds = await seedStalls(10);
    const winners = new Set<string>();

    for (const stall of rounds) {
      const results = await Promise.all(leaders.map((l) => hold(l.cookie, stall.id)));
      const created = results.filter((r) => r.status === 201);
      expect(created).toHaveLength(1);
      for (const r of results.filter((r) => r.status !== 201)) {
        expect(r.status).toBe(409);
        expect(["STALL_UNAVAILABLE", "TEAM_HAS_ACTIVE_HOLD"]).toContain(r.body!.error.code);
      }
      expect(results.some((r) => r.status >= 500)).toBe(false);
      const winner = leaders[results.findIndex((r) => r.status === 201)];
      expect(winners.has(winner.teamId)).toBe(false);
      winners.add(winner.teamId);
    }

    const sql = await getDb();
    const [row] = await sql`select count(*)::int as n from booking.reservations where status = 'held'`;
    expect(row.n).toBe(10);
  }, 120_000);
});

describe("RACE-02/03 one team, several devices", () => {
  it("20 parallel holds on 20 stalls from three sessions of one leader: exactly one hold", async () => {
    const leader = await createLeader();
    const cookies = [leader.cookie, await newSessionCookie(leader.userId), await newSessionCookie(leader.userId)];
    const stalls = await seedStalls(20);
    const results = await Promise.all(stalls.map((s, i) => hold(cookies[i % 3], s.id)));
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    const others = results.filter((r) => r.status !== 201);
    expect(others).toHaveLength(19);
    for (const r of others) expect(r.body!.error.code).toBe("TEAM_HAS_ACTIVE_HOLD");
  });

  it("the same stall from three devices at once returns one hold, the same id and the same token", async () => {
    const leader = await createLeader();
    const cookies = [leader.cookie, await newSessionCookie(leader.userId), await newSessionCookie(leader.userId)];
    const [stall] = await seedStalls(1);
    const results = await Promise.all(cookies.map((c) => hold(c, stall.id)));
    expect(results.map((r) => r.status).sort()).toEqual([200, 200, 201]);
    expect(new Set(results.map((r) => r.body!.holdId)).size).toBe(1);
    expect(new Set(results.map((r) => r.body!.token)).size).toBe(1);
    expect(new Set(results.map((r) => r.body!.expiresAt)).size).toBe(1);
  });
});

describe("RACE-04..07 expiry against locks", () => {
  it("RACE-04: a confirmation that began before expiry but got the lock after expiry is rejected", async () => {
    await configureBooking({ hold_seconds: 3 });
    const leader = await createLeader();
    const [stall] = await seedStalls(1);
    const held = await hold(leader.cookie, stall.id);
    expect(held.status).toBe(201);

    const holder = await lockHolder();
    try {
      await holder.lockStall(stall.id);
      const pending = confirm(leader.cookie, held.body!.holdId, held.body!.token);
      await waitForLockWaiters(1);

      const sql = await getDb();
      const [proof] = await sql`
        select bool_and(a.xact_start < r.expires_at) as began_before_expiry
          from pg_stat_activity a, booking.reservations r
         where a.datname = current_database() and a.wait_event_type = 'Lock' and r.id = ${held.body!.holdId}`;
      expect(proof.began_before_expiry).toBe(true);

      await waitForExpiry(held.body!.holdId, 500);
      await holder.release();

      const result = await pending;
      expect(result.status).toBe(409);
      expect(result.body!.error.code).toBe("HOLD_EXPIRED");
      const [row] = await sql`select status, booking_id from booking.reservations where id = ${held.body!.holdId}`;
      expect(row.status).toBe("expired");
      expect(row.booking_id).toBeNull();
    } finally {
      await holder.release();
    }
  });

  for (const order of ["confirm queued first", "reclaim queued first"] as const) {
    it(`RACE-05: late confirmation vs reclaim by another team (${order}): the reclaim wins`, async () => {
      await configureBooking({ hold_seconds: 3 });
      const [a, b] = await createLeaders(2);
      const [stall] = await seedStalls(1);
      const held = await hold(a.cookie, stall.id);
      expect(held.status).toBe(201);

      const holder = await lockHolder();
      try {
        await holder.lockStall(stall.id);
        let confirmA: ReturnType<typeof confirm>;
        let holdB: ReturnType<typeof hold>;
        if (order === "confirm queued first") {
          confirmA = confirm(a.cookie, held.body!.holdId, held.body!.token);
          await waitForLockWaiters(1);
          await waitForExpiry(held.body!.holdId, 300);
          holdB = hold(b.cookie, stall.id);
          await waitForLockWaiters(2);
        } else {
          holdB = hold(b.cookie, stall.id);
          await waitForLockWaiters(1);
          confirmA = confirm(a.cookie, held.body!.holdId, held.body!.token);
          await waitForLockWaiters(2);
          await waitForExpiry(held.body!.holdId, 300);
        }
        await holder.release();

        const [ra, rb] = await Promise.all([confirmA, holdB]);
        expect(ra.status).toBe(409);
        expect(ra.body!.error.code).toBe("HOLD_EXPIRED");
        expect(rb.status).toBe(201);
      } finally {
        await holder.release();
      }
    });
  }

  it("RACE-06: when the lock is released before expiry, the confirmation wins and the reclaim is refused", async () => {
    const [a, b] = await createLeaders(2);
    const [stall] = await seedStalls(1);
    const held = await hold(a.cookie, stall.id);
    const holder = await lockHolder();
    try {
      await holder.lockStall(stall.id);
      const confirmA = confirm(a.cookie, held.body!.holdId, held.body!.token);
      const holdB = hold(b.cookie, stall.id);
      await waitForLockWaiters(2);
      await holder.release();
      const [ra, rb] = await Promise.all([confirmA, holdB]);
      expect(ra.status).toBe(201);
      expect(rb.status).toBe(409);
      expect(rb.body!.error.code).toBe("STALL_UNAVAILABLE");
    } finally {
      await holder.release();
    }
  });

  it("RACE-07: the database rejects a confirmation that crosses expiry after the application checked it", async () => {
    await configureBooking({ hold_seconds: 2 });
    const leader = await createLeader();
    const [stall] = await seedStalls(1);
    const held = await hold(leader.cookie, stall.id);
    // Delay between the application's expiry check and its UPDATE until expiry has passed.
    armFault("beforeConfirmUpdate", () => waitForExpiry(held.body!.holdId, 200));
    const result = await confirm(leader.cookie, held.body!.holdId, held.body!.token);
    expect(result.status).toBe(409);
    expect(result.body!.error.code).toBe("HOLD_EXPIRED");
    const sql = await getDb();
    const [row] = await sql`select status, booking_id from booking.reservations where id = ${held.body!.holdId}`;
    expect(row).toEqual({ status: "held", booking_id: null }); // nothing persisted; it is stale and reclaimable
    const [events] = await sql`select count(*)::int as n from booking.audit_events where reservation_id = ${held.body!.holdId} and action = 'booking_confirmed'`;
    expect(events.n).toBe(0);
  });
});

describe("RACE-08..11 idempotency, lost responses and failures", () => {
  it("RACE-08: ten parallel confirmations of one hold create exactly one booking", async () => {
    const leader = await createLeader();
    const [stall] = await seedStalls(1);
    const held = await hold(leader.cookie, stall.id);
    const results = await Promise.all(Array.from({ length: 10 }, () => confirm(leader.cookie, held.body!.holdId, held.body!.token)));
    expect(results.map((r) => r.status).sort()).toEqual([200, 200, 200, 200, 200, 200, 200, 200, 200, 201]);
    expect(new Set(results.map((r) => r.body!.bookingId)).size).toBe(1);
    expect(results[0].body!.bookingRef).toMatch(/^SJ26-[0-9A-HJKMNP-TV-Z]{8}$/);
  });

  it("RACE-09: a lost COMMIT acknowledgement is resolved by an idempotent re-run (hold and confirm)", async () => {
    const leader = await createLeader();
    const [stall] = await seedStalls(1);
    armFault("afterCommit", () => {
      throw new SimulatedConnectionError();
    });
    const held = await hold(leader.cookie, stall.id);
    expect(held.status).toBe(200); // committed on the first attempt, recovered by the re-run
    const sql = await getDb();
    const [count] = await sql`select count(*)::int as n from booking.reservations where team_id = ${leader.teamId}`;
    expect(count.n).toBe(1);

    armFault("afterCommit", () => {
      throw new SimulatedConnectionError();
    });
    const booked = await confirm(leader.cookie, held.body!.holdId, held.body!.token);
    expect(booked.status).toBe(200);
    const view = await me(leader.cookie);
    expect(view.body!.reservation).toMatchObject({ kind: "booking", bookingId: booked.body!.bookingId });
  });

  it("RACE-10: if the outcome stays unknown the client gets 503 OUTCOME_UNKNOWN and can recover via /me", async () => {
    const leader = await createLeader();
    const [stall] = await seedStalls(1);
    armFault("afterCommit", () => {
      throw new SimulatedConnectionError();
    }, 2);
    const result = await hold(leader.cookie, stall.id);
    expect(result.status).toBe(503);
    expect(result.body!.error.code).toBe("OUTCOME_UNKNOWN");
    const view = await me(leader.cookie);
    expect(view.body!.reservation).toMatchObject({ kind: "hold", stallId: stall.id });
  });

  it("RACE-11: connection loss before COMMIT is retried; persistent failure leaves no partial state", async () => {
    const [a, b] = await createLeaders(2);
    const [s1, s2] = await seedStalls(2);
    armFault("beforeCommit", () => {
      throw new SimulatedConnectionError();
    });
    expect((await hold(a.cookie, s1.id)).status).toBe(201);

    armFault("beforeCommit", () => {
      throw new SimulatedConnectionError();
    }, 3);
    const failed = await hold(b.cookie, s2.id);
    expect(failed.status).toBe(503);
    expect(failed.body!.error.code).toBe("RETRY_LATER");
    const sql = await getDb();
    const [row] = await sql`select count(*)::int as n from booking.reservations where team_id = ${b.teamId}`;
    expect(row.n).toBe(0);
  });

  it("RACE-11: a lock held longer than lock_timeout ends in 503 RETRY_LATER without partial state", async () => {
    const leader = await createLeader();
    const [stall] = await seedStalls(1);
    const holder = await lockHolder();
    try {
      await holder.lockStall(stall.id);
      const result = await hold(leader.cookie, stall.id);
      expect(result.status).toBe(503);
      expect(result.body!.error.code).toBe("RETRY_LATER");
      expect(result.headers.get("retry-after")).toBe("2");
    } finally {
      await holder.release();
    }
    const sql = await getDb();
    const [row] = await sql`select count(*)::int as n from booking.reservations where team_id = ${leader.teamId}`;
    expect(row.n).toBe(0);
    expect((await hold(leader.cookie, stall.id)).status).toBe(201);
  }, 30_000);
});

describe("RACE-12 deadlock", () => {
  it("a deadlock against the application's lock order is detected and the request still succeeds or fails cleanly", async () => {
    const leader = await createLeader();
    const [stall] = await seedStalls(1);
    const holder = await lockHolder();
    try {
      await holder.lockStall(stall.id); // holder: stall first
      const pending = hold(leader.cookie, stall.id); // app: team, then waits for stall
      await waitForLockWaiters(1);
      // holder now asks for the team row the app holds -> deadlock; Postgres aborts one side.
      const holderSide = holder.conn`select id from booking.teams where id = ${leader.teamId} for update`.then(
        () => "holder-won",
        (err) => (err.code === "40P01" ? "holder-aborted" : Promise.reject(err))
      );
      const outcome = await Promise.race([
        holderSide,
        new Promise((r) => setTimeout(() => r("timeout"), 10_000)),
      ]);
      expect(["holder-won", "holder-aborted"]).toContain(outcome);
      await holder.release();
      const result = await pending;
      expect([201, 503]).toContain(result.status);
      if (result.status === 503) expect(result.body!.error.code).toBe("RETRY_LATER");
    } finally {
      await holder.release();
    }
    const view = await me(leader.cookie);
    expect(view.status).toBe(200);
  }, 30_000);
});

describe("RACE-15/16 squatting limits and approval changes", () => {
  it("blocks re-holding the same stall during the cooldown but allows another stall", async () => {
    const leader = await createLeader();
    const [s1, s2] = await seedStalls(2);
    const first = await hold(leader.cookie, s1.id);
    expect((await release(leader.cookie, first.body!.holdId)).body).toEqual({ status: "released" });
    const again = await hold(leader.cookie, s1.id);
    expect(again.status).toBe(409);
    expect(again.body!.error.code).toBe("REHOLD_COOLDOWN");
    expect(Number(again.headers.get("retry-after"))).toBeGreaterThan(500);
    expect((await hold(leader.cookie, s2.id)).status).toBe(201);
  });

  it("caps new holds per hour", async () => {
    await configureBooking({ max_new_holds_per_hour: 2, rehold_cooldown_seconds: 0 });
    const leader = await createLeader();
    const stalls = await seedStalls(3);
    for (const s of stalls.slice(0, 2)) {
      const h = await hold(leader.cookie, s.id);
      expect(h.status).toBe(201);
      await release(leader.cookie, h.body!.holdId);
    }
    const capped = await hold(leader.cookie, stalls[2].id);
    expect(capped.status).toBe(429);
    expect(capped.body!.error.code).toBe("HOLD_LIMIT_REACHED");
  });

  it("RACE-16: a team rejected while holding cannot confirm", async () => {
    await configureBooking({ require_team_approval: true });
    const leader = await createLeader();
    const [stall] = await seedStalls(1);
    const sql = await getDb();
    const [admin] = await sql`insert into app_auth.admin_users (email, display_name, created_by) values ('approver@example.test', 'Approver', 'test') returning id`;
    await sql`update booking.teams set approval_status = 'approved', approval_changed_at = now(), approval_changed_by = ${admin.id} where id = ${leader.teamId}`;
    const held = await hold(leader.cookie, stall.id);
    expect(held.status).toBe(201);
    await sql`update booking.teams set approval_status = 'rejected', approval_changed_at = now() where id = ${leader.teamId}`;
    const result = await confirm(leader.cookie, held.body!.holdId, held.body!.token);
    expect(result.status).toBe(403);
    expect(result.body!.error.code).toBe("TEAM_NOT_ELIGIBLE");
  });
});

describe("expired holds without cleanup", () => {
  it("an expired hold is reclaimable by another team with no background job", async () => {
    await configureBooking({ hold_seconds: 2 });
    const [a, b] = await createLeaders(2);
    const [stall] = await seedStalls(1);
    const held = await hold(a.cookie, stall.id);
    await waitForExpiry(held.body!.holdId, 100);
    const sql = await getDb();
    const [stale] = await sql`select status from booking.reservations where id = ${held.body!.holdId}`;
    expect(stale.status).toBe("held"); // nothing cleaned it up
    expect((await hold(b.cookie, stall.id)).status).toBe(201);
    const [after] = await sql`select status from booking.reservations where id = ${held.body!.holdId}`;
    expect(after.status).toBe("expired");
    expect((await confirm(a.cookie, held.body!.holdId, held.body!.token)).body!.error.code).toBe("HOLD_EXPIRED");
  });

  it("the same team can hold again after its own hold expired (subject to cooldown)", async () => {
    await configureBooking({ hold_seconds: 2, rehold_cooldown_seconds: 0 });
    const leader = await createLeader();
    const [stall] = await seedStalls(1);
    const first = await hold(leader.cookie, stall.id);
    await waitForExpiry(first.body!.holdId, 100);
    const second = await hold(leader.cookie, stall.id);
    expect(second.status).toBe(201);
    expect(second.body!.holdId).not.toBe(first.body!.holdId);
  });
});

it("wait helper sanity", async () => {
  await expect(waitUntil(async () => false, 50)).rejects.toThrow(/timed out/);
});
