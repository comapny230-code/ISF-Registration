/** RACE-13 (cancel vs new holds) and RACE-14 (disable vs hold/confirm), spec §9.3. */
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getDb } from "@/lib/db";
import { cancelBooking, createAdmin, reason, setAvailability } from "../support/admin";
import { assertInvariants, configureBooking, confirm, createLeader, createLeaders, hold, seedStalls } from "../support/booking";

beforeEach(async () => {
  await configureBooking();
});
afterEach(async () => {
  await assertInvariants();
});

describe("RACE-13 cancellation vs teams waiting for the stall", () => {
  it("20 teams racing an admin cancellation: at most one new hold, and only after the cancellation", async () => {
    const owner = await createLeader();
    const [stall] = await seedStalls(1);
    const held = await hold(owner.cookie, stall.id);
    const booked = await confirm(owner.cookie, held.body!.holdId, held.body!.token);
    const admin = await createAdmin(["booking.cancel"]);
    const waiting = await createLeaders(20);

    const [cancel, ...holds] = await Promise.all([
      cancelBooking(admin.cookie, booked.body!.bookingId, { reason, requestId: randomUUID() }),
      ...waiting.map((l) => hold(l.cookie, stall.id)),
    ]);
    expect(cancel.status).toBe(200);
    const created = holds.filter((r) => r.status === 201);
    expect(created.length).toBeLessThanOrEqual(1);
    for (const r of holds.filter((r) => r.status !== 201)) expect(r.body!.error.code).toBe("STALL_UNAVAILABLE");

    if (created.length === 1) {
      const sql = await getDb();
      const [order] = await sql`
        select h.held_at > c.cancelled_at as after_cancel
          from booking.reservations h, booking.reservations c
         where h.id = ${created[0].body!.holdId} and c.id = ${held.body!.holdId}`;
      expect(order.after_cancel).toBe(true);
    }
  });
});

describe("RACE-14 disabling vs holding and confirming", () => {
  it("disable (no force) racing a hold: exactly one wins, ten rounds", async () => {
    const admin = await createAdmin(["inventory.manage"]);
    const leaders = await createLeaders(10);
    const stalls = await seedStalls(10);
    for (let i = 0; i < 10; i++) {
      const [disable, held] = await Promise.all([
        setAvailability(admin.cookie, stalls[i].id, { action: "disable", reason, requestId: randomUUID() }),
        hold(leaders[i].cookie, stalls[i].id),
      ]);
      const holdWon = held.status === 201;
      if (holdWon) {
        expect(disable.body!.error.code).toBe("STALL_HAS_ACTIVE_HOLD");
      } else {
        expect(disable.status).toBe(200);
        expect(held.body!.error.code).toBe("STALL_UNAVAILABLE");
      }
    }
  });

  it("forced disable racing a confirmation: the stall ends either booked or disabled with the hold released, ten rounds", async () => {
    const admin = await createAdmin(["inventory.manage"]);
    const leaders = await createLeaders(10);
    const stalls = await seedStalls(10);
    const sql = await getDb();
    for (let i = 0; i < 10; i++) {
      const held = await hold(leaders[i].cookie, stalls[i].id);
      const [disable, booked] = await Promise.all([
        setAvailability(admin.cookie, stalls[i].id, { action: "disable", reason, force: true, requestId: randomUUID() }),
        confirm(leaders[i].cookie, held.body!.holdId, held.body!.token),
      ]);
      const [row] = await sql`
        select r.status, s.admin_status from booking.reservations r join booking.stalls s on s.id = r.stall_id
         where r.id = ${held.body!.holdId}`;
      if (booked.status === 201) {
        expect(disable.body!.error.code).toBe("STALL_HAS_BOOKING");
        expect(row).toEqual({ status: "confirmed", admin_status: "active" });
      } else {
        expect(booked.body!.error.code).toBe("HOLD_RELEASED");
        expect(disable.body!.releasedHoldId).toBe(held.body!.holdId);
        expect(row).toEqual({ status: "released", admin_status: "disabled" });
      }
    }
  });
});
