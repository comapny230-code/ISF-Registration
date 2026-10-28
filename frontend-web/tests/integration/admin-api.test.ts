/** Admin endpoints E10–E15 (spec §4.8, §4.9, §5.3; AUTH-11). */
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getDb } from "@/lib/db";
import {
  cancelBooking,
  createAdmin,
  expireStepUp,
  listAudit,
  listBookings,
  listTeams,
  reason,
  setApproval,
  setAvailability,
} from "../support/admin";
import { assertInvariants, configureBooking, confirm, createLeader, hold, me, seedStalls, stalls, waitForExpiry } from "../support/booking";

beforeEach(async () => {
  await configureBooking();
});
afterEach(async () => {
  await assertInvariants();
});

async function bookedStall() {
  const leader = await createLeader();
  const [stall] = await seedStalls(1);
  const held = await hold(leader.cookie, stall.id);
  const booked = await confirm(leader.cookie, held.body!.holdId, held.body!.token);
  expect(booked.status).toBe(201);
  return { leader, stall, holdId: held.body!.holdId as string, bookingId: booked.body!.bookingId as string };
}

describe("AUTH-11 authorisation matrix", () => {
  it("requires an admin session, the right permission and (for writes) a recent sign-in code", async () => {
    const { bookingId, stall, leader } = await bookedStall();
    const readOnly = await createAdmin(["reports.view"]);
    const canceller = await createAdmin(["booking.cancel"]);
    const inventory = await createAdmin(["inventory.manage"]);
    const teams = await createAdmin(["teams.manage"]);
    const writes = [
      { name: "cancel", run: (c: string) => cancelBooking(c, bookingId, { reason, requestId: randomUUID() }), allowed: canceller },
      { name: "availability", run: (c: string) => setAvailability(c, stall.id, { action: "disable", reason, requestId: randomUUID() }), allowed: inventory },
      { name: "approval", run: (c: string) => setApproval(c, leader.teamId, { status: "approved", reason, requestId: randomUUID() }), allowed: teams },
    ];
    for (const w of writes) {
      expect((await w.run("")).status, `${w.name} anonymous`).toBe(401);
      expect((await w.run(leader.cookie)).status, `${w.name} leader cookie`).toBe(401);
      for (const other of [readOnly, canceller, inventory, teams].filter((a) => a !== w.allowed)) {
        const res = await w.run(other.cookie);
        expect(res.status, `${w.name} by ${other.name}`).toBe(403);
        expect(res.body!.error.code).toBe("FORBIDDEN");
      }
    }
    await expireStepUp(inventory);
    const stale = await writes[1].run(inventory.cookie);
    expect(stale.body!.error.code).toBe("REAUTH_REQUIRED");

    expect((await listBookings(readOnly.cookie)).status).toBe(200);
    expect((await listBookings(canceller.cookie)).status).toBe(200);
    expect((await listBookings(inventory.cookie)).status).toBe(403);
    expect((await listTeams(teams.cookie)).status).toBe(200);
    expect((await listTeams(readOnly.cookie)).status).toBe(200);
    expect((await listTeams(canceller.cookie)).status).toBe(403);
    expect((await listAudit(readOnly.cookie)).status).toBe(200);
    expect((await listAudit(teams.cookie)).status).toBe(403);
    expect((await listAudit()).status).toBe(401);
  });

  it("rejects cross-site requests and invalid bodies", async () => {
    const { bookingId } = await bookedStall();
    const admin = await createAdmin(["booking.cancel"]);
    expect((await cancelBooking(admin.cookie, bookingId, { reason, requestId: randomUUID() }, "https://evil.example")).status).toBe(403);
    expect((await cancelBooking(admin.cookie, bookingId, { reason: "too short", requestId: randomUUID() })).status).toBe(400);
    expect((await cancelBooking(admin.cookie, bookingId, { reason, requestId: "nope" })).status).toBe(400);
    expect((await cancelBooking(admin.cookie, bookingId, { reason, requestId: randomUUID(), force: true })).status).toBe(400);
  });
});

describe("E11 cancel a booking", () => {
  it("cancels, audits with reason, frees the stall and lets the team book again", async () => {
    const { leader, stall, holdId, bookingId } = await bookedStall();
    const admin = await createAdmin(["booking.cancel"]);
    const requestId = randomUUID();
    const res = await cancelBooking(admin.cookie, bookingId, { reason, requestId });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ bookingId, status: "cancelled" });

    const sql = await getDb();
    const [row] = await sql`select status, cancelled_by_admin_id, cancel_reason, cancel_request_id from booking.reservations where id = ${holdId}`;
    expect(row).toEqual({ status: "cancelled", cancelled_by_admin_id: admin.id, cancel_reason: reason, cancel_request_id: requestId });
    const [event] = await sql`select actor_type, actor_admin_id, reason from booking.audit_events where reservation_id = ${holdId} and action = 'booking_cancelled'`;
    expect(event).toEqual({ actor_type: "admin", actor_admin_id: admin.id, reason });

    expect((await stalls(leader.cookie)).body!.stalls.find((s: any) => s.id === stall.id).status).toBe("available");
    expect((await me(leader.cookie)).body!.reservation).toBeNull();
    expect((await hold(leader.cookie, stall.id)).status).toBe(201);
  });

  it("is idempotent per request id and refuses a second cancellation or a reused request id", async () => {
    const first = await bookedStall();
    const second = await bookedStall();
    const admin = await createAdmin(["booking.cancel"]);
    const requestId = randomUUID();
    expect((await cancelBooking(admin.cookie, first.bookingId, { reason, requestId })).status).toBe(200);
    expect((await cancelBooking(admin.cookie, first.bookingId, { reason, requestId })).status).toBe(200);
    const again = await cancelBooking(admin.cookie, first.bookingId, { reason, requestId: randomUUID() });
    expect(again.body!.error.code).toBe("ALREADY_CANCELLED");
    const reused = await cancelBooking(admin.cookie, second.bookingId, { reason, requestId });
    expect(reused.status).toBe(409);
    expect(reused.body!.error.code).toBe("REQUEST_ID_REUSED");
    expect((await cancelBooking(admin.cookie, randomUUID(), { reason, requestId: randomUUID() })).status).toBe(404);

    const sql = await getDb();
    const [count] = await sql`
      select count(*)::int as n from booking.audit_events
       where action = 'booking_cancelled' and reservation_id in (${first.holdId}, ${second.holdId})`;
    expect(count.n).toBe(1);
  });
});

describe("E12 stall availability", () => {
  it("disables and re-enables a free stall idempotently, and blocks holds while disabled", async () => {
    const leader = await createLeader();
    const [stall] = await seedStalls(1);
    const admin = await createAdmin(["inventory.manage"]);
    const off = await setAvailability(admin.cookie, stall.id, { action: "disable", reason, requestId: randomUUID() });
    expect(off.body).toMatchObject({ adminStatus: "disabled", changed: true, releasedHoldId: null });
    expect((await setAvailability(admin.cookie, stall.id, { action: "disable", reason, requestId: randomUUID() })).body!.changed).toBe(false);
    expect((await hold(leader.cookie, stall.id)).body!.error.code).toBe("STALL_UNAVAILABLE");
    expect((await stalls(leader.cookie)).body!.stalls.find((s: any) => s.id === stall.id).status).toBe("unavailable");

    expect((await setAvailability(admin.cookie, stall.id, { action: "enable", reason, requestId: randomUUID() })).body).toMatchObject({
      adminStatus: "active",
      changed: true,
    });
    expect((await hold(leader.cookie, stall.id)).status).toBe(201);

    const sql = await getDb();
    const events = await sql`select action from booking.audit_events where stall_id = ${stall.id} and action like 'stall_%' order by id`;
    expect(events.map((e) => e.action)).toEqual(["stall_disabled", "stall_enabled"]);
  });

  it("refuses to disable a held stall unless forced; forcing releases the hold, which can then not be confirmed", async () => {
    const leader = await createLeader();
    const [stall] = await seedStalls(1);
    const admin = await createAdmin(["inventory.manage"]);
    const held = await hold(leader.cookie, stall.id);
    const refused = await setAvailability(admin.cookie, stall.id, { action: "disable", reason, requestId: randomUUID() });
    expect(refused.body!.error.code).toBe("STALL_HAS_ACTIVE_HOLD");

    const forced = await setAvailability(admin.cookie, stall.id, { action: "disable", reason, force: true, requestId: randomUUID() });
    expect(forced.body).toMatchObject({ adminStatus: "disabled", releasedHoldId: held.body!.holdId });
    const sql = await getDb();
    const [row] = await sql`select status, release_reason, released_by_admin_id from booking.reservations where id = ${held.body!.holdId}`;
    expect(row).toEqual({ status: "released", release_reason: "admin_disable", released_by_admin_id: admin.id });
    expect((await confirm(leader.cookie, held.body!.holdId, held.body!.token)).body!.error.code).toBe("HOLD_RELEASED");
  });

  it("never disables a booked stall (cancellation is a separate permission)", async () => {
    const { stall } = await bookedStall();
    const admin = await createAdmin(["inventory.manage"]);
    for (const force of [false, true]) {
      const res = await setAvailability(admin.cookie, stall.id, { action: "disable", reason, force, requestId: randomUUID() });
      expect(res.body!.error.code).toBe("STALL_HAS_BOOKING");
    }
  });

  it("cleans up an expired hold while disabling, and cannot enable unapproved inventory", async () => {
    await configureBooking({ hold_seconds: 2 });
    const leader = await createLeader();
    const [stall] = await seedStalls(1);
    const [provisional] = await seedStalls(1, "provisional");
    const admin = await createAdmin(["inventory.manage"]);
    const held = await hold(leader.cookie, stall.id);
    await waitForExpiry(held.body!.holdId, 100);
    const res = await setAvailability(admin.cookie, stall.id, { action: "disable", reason, requestId: randomUUID() });
    expect(res.body).toMatchObject({ adminStatus: "disabled", releasedHoldId: null });
    const sql = await getDb();
    const [row] = await sql`select status from booking.reservations where id = ${held.body!.holdId}`;
    expect(row.status).toBe("expired");
    expect((await setAvailability(admin.cookie, provisional.id, { action: "enable", reason, requestId: randomUUID() })).body!.error.code).toBe(
      "STALL_NOT_APPROVED"
    );
  });
});

describe("E14 team approval", () => {
  it("controls eligibility when approval is required, and audits each change", async () => {
    await configureBooking({ require_team_approval: true });
    const leader = await createLeader();
    const [stall] = await seedStalls(1);
    const admin = await createAdmin(["teams.manage"]);
    expect((await hold(leader.cookie, stall.id)).body!.error.code).toBe("TEAM_NOT_ELIGIBLE");

    const approved = await setApproval(admin.cookie, leader.teamId, { status: "approved", reason, requestId: randomUUID() });
    expect(approved.body).toEqual({ teamId: leader.teamId, approvalStatus: "approved", changed: true });
    expect((await setApproval(admin.cookie, leader.teamId, { status: "approved", reason, requestId: randomUUID() })).body!.changed).toBe(false);
    expect((await hold(leader.cookie, stall.id)).status).toBe(201);

    const sql = await getDb();
    const [event] = await sql`
      select reason, details, jsonb_typeof(details) as details_type
        from booking.audit_events where team_id = ${leader.teamId} and action = 'team_approval_changed'`;
    // details must be a JSON object, not a double-encoded JSON string
    expect(event).toEqual({ reason, details: { from: "pending", to: "approved" }, details_type: "object" });
    expect((await setApproval(admin.cookie, randomUUID(), { status: "approved", reason, requestId: randomUUID() })).status).toBe(404);
    expect((await setApproval(admin.cookie, leader.teamId, { status: "maybe", reason, requestId: randomUUID() })).status).toBe(400);
  });
});

describe("E10/E13/E15 lists", () => {
  it("lists bookings with contact details only, filters and paginates", async () => {
    const a = await bookedStall();
    const b = await bookedStall();
    const admin = await createAdmin(["reports.view", "booking.cancel"]);
    await cancelBooking(admin.cookie, a.bookingId, { reason, requestId: randomUUID() });

    const all = await listBookings(admin.cookie, "?limit=100");
    const ids = all.body!.items.map((i: any) => i.bookingId);
    expect(ids).toEqual(expect.arrayContaining([a.bookingId, b.bookingId]));
    const item = all.body!.items.find((i: any) => i.bookingId === b.bookingId);
    expect(item).toMatchObject({ status: "confirmed", leaderEmail: b.leader.email, leaderMobile: "1", track: "senior" });
    expect(Object.keys(item)).not.toContain("cancelReason");
    expect(JSON.stringify(all.body)).not.toMatch(/aadhar|aadhaar|pan_number|panNumber/i);

    const cancelled = await listBookings(admin.cookie, "?status=cancelled&limit=100");
    expect(cancelled.body!.items.every((i: any) => i.status === "cancelled")).toBe(true);
    expect(cancelled.body!.items.find((i: any) => i.bookingId === a.bookingId)).toMatchObject({ cancelReason: reason });

    const page1 = await listBookings(admin.cookie, "?limit=1");
    expect(page1.body!.items).toHaveLength(1);
    const page2 = await listBookings(admin.cookie, `?limit=1&cursor=${page1.body!.nextCursor}`);
    expect(page2.body!.items).toHaveLength(1);
    expect(page2.body!.items[0].bookingId).not.toBe(page1.body!.items[0].bookingId);
    // Walking every page with limit=1 visits each booking exactly once.
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const page: any = await listBookings(admin.cookie, `?limit=1${cursor ? `&cursor=${cursor}` : ""}`);
      seen.push(...page.body.items.map((i: any) => i.bookingId));
      cursor = page.body.nextCursor;
    } while (cursor);
    expect(seen.sort()).toEqual([...ids].sort());

    expect((await listBookings(admin.cookie, "?cursor=bm90LWpzb24")).status).toBe(400);
    expect((await listBookings(admin.cookie, "?limit=0")).status).toBe(400);
    expect((await listBookings(admin.cookie, "?teamId=x")).status).toBe(400);
  });

  it("lists teams with live reservations and counts leaders that need a runbook", async () => {
    const { leader } = await bookedStall();
    const sql = await getDb();
    await sql`
      insert into student_innovators (user_id, team_name, full_name, email, mobile, alt_mobile, domain, city, state, linkedin_url, edition_id)
      values (${leader.userId}, 'Other', 'X', ${leader.email}, '1', '2', 'd', 'c', 's', 'l', 2026)`;
    const admin = await createAdmin(["teams.manage"]);
    const res = await listTeams(admin.cookie);
    expect(res.body!.unresolved).toEqual({ ambiguousLeaders: 1, nullEditionLeaders: 0, leadersWithoutTeam: 0 });
    expect(res.body!.items.find((t: any) => t.teamId === leader.teamId).reservation).toMatchObject({ kind: "booking" });
    const approved = await listTeams(admin.cookie, "?approval=approved&limit=100");
    expect(approved.body!.items.every((t: any) => t.approvalStatus === "approved")).toBe(true);
    expect(approved.body!.items.some((t: any) => t.teamId === leader.teamId)).toBe(false);
  });

  it("shows the audit trail for one booking, newest first, with actor names", async () => {
    const { holdId, bookingId } = await bookedStall();
    const admin = await createAdmin(["reports.view", "booking.cancel"]);
    await cancelBooking(admin.cookie, bookingId, { reason, requestId: randomUUID() });
    const res = await listAudit(admin.cookie, `?reservationId=${holdId}`);
    expect(res.body!.items.map((e: any) => e.action)).toEqual(["booking_cancelled", "booking_confirmed", "hold_created"]);
    expect(res.body!.items[0]).toMatchObject({ actorType: "admin", actorName: admin.name, reason });
  });
});
