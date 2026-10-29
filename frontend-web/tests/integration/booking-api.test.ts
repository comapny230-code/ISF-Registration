/**
 * Booking endpoints E5–E9: eligibility, authorisation, IDOR, CSRF, token misuse
 * and live status (spec §5.3, §9.3 AUTH-08/09/13, LIVE-01..03).
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as holdsRoute from "@/app/v1/booking/holds/route";
import { getDb } from "@/lib/db";
import { issueHoldToken } from "@/lib/booking/token";
import {
  assertInvariants,
  confirm,
  configureBooking,
  createLeader,
  createLeaders,
  hold,
  me,
  release,
  seedStalls,
  stalls,
  waitForExpiry,
} from "../support/booking";
import { apiRequest, call } from "../support/http";

beforeEach(async () => {
  await configureBooking();
});
afterEach(async () => {
  await assertInvariants();
});

describe("happy path", () => {
  it("holds, confirms and reports the booking", async () => {
    const leader = await createLeader();
    const [stall] = await seedStalls(1);
    const held = await hold(leader.cookie, stall.id);
    expect(held.status).toBe(201);
    expect(held.body).toMatchObject({ stallId: stall.id, stallCode: stall.code });
    expect(held.body!.token).toMatch(/^v1\.t1\.[A-Za-z0-9_-]{43}$/);
    const seconds = (Date.parse(held.body!.expiresAt) - Date.parse(held.body!.serverNow)) / 1000;
    expect(seconds).toBeGreaterThan(299);
    expect(seconds).toBeLessThanOrEqual(300);

    const booked = await confirm(leader.cookie, held.body!.holdId, held.body!.token);
    expect(booked.status).toBe(201);
    expect(booked.body).toMatchObject({ stallId: stall.id, stallCode: stall.code });

    const view = await me(leader.cookie);
    expect(view.body!.reservation).toMatchObject({ kind: "booking", bookingRef: booked.body!.bookingRef });
    const again = await hold(leader.cookie, (await seedStalls(1))[0].id);
    expect(again.body!.error.code).toBe("TEAM_ALREADY_BOOKED");
    expect(again.body!.error.details.booking.bookingId).toBe(booked.body!.bookingId);
  });

  it("releases a hold idempotently and refuses to release a booking", async () => {
    const leader = await createLeader();
    const [s1, s2] = await seedStalls(2);
    const held = await hold(leader.cookie, s1.id);
    expect((await release(leader.cookie, held.body!.holdId)).body).toEqual({ status: "released" });
    expect((await release(leader.cookie, held.body!.holdId)).body).toEqual({ status: "released" });
    expect((await confirm(leader.cookie, held.body!.holdId, held.body!.token)).body!.error.code).toBe("HOLD_RELEASED");

    const second = await hold(leader.cookie, s2.id);
    await confirm(leader.cookie, second.body!.holdId, second.body!.token);
    const refused = await release(leader.cookie, second.body!.holdId);
    expect(refused.status).toBe(409);
    expect(refused.body!.error.code).toBe("BOOKING_CONFIRMED");
  });
});

describe("eligibility and booking window", () => {
  it.each([
    ["paused", { booking_enabled: false, eligible_tracks: [] as string[] }, 409, "BOOKING_SUSPENDED"],
    ["not open yet", { opens_in_seconds: 600, closes_in_seconds: 3600 }, 409, "BOOKING_NOT_OPEN"],
    ["closed", { opens_in_seconds: -7200, closes_in_seconds: -60 }, 409, "BOOKING_CLOSED"],
    ["track not eligible", { eligible_tracks: ["junior"] }, 403, "TEAM_NOT_ELIGIBLE"],
    ["approval required but pending", { require_team_approval: true }, 403, "TEAM_NOT_ELIGIBLE"],
  ])("refuses new holds when %s", async (_label, settings, status, code) => {
    await configureBooking(settings);
    const leader = await createLeader();
    const [stall] = await seedStalls(1);
    const res = await hold(leader.cookie, stall.id);
    expect(res.status).toBe(status);
    expect(res.body!.error.code).toBe(code);
    const view = await me(leader.cookie);
    expect(view.body!.eligibility.canHold).toBe(false);
  });

  it("a retry after closing still recovers the existing hold, which can be confirmed until it expires", async () => {
    const leader = await createLeader();
    const [stall] = await seedStalls(1);
    const held = await hold(leader.cookie, stall.id);
    await configureBooking({ opens_in_seconds: -7200, closes_in_seconds: -1 });
    const retry = await hold(leader.cookie, stall.id);
    expect(retry.status).toBe(200);
    expect(retry.body!.holdId).toBe(held.body!.holdId);
    expect((await confirm(leader.cookie, held.body!.holdId, held.body!.token)).status).toBe(201);
  });

  it("pausing booking blocks confirmation (kill switch)", async () => {
    const leader = await createLeader();
    const [stall] = await seedStalls(1);
    const held = await hold(leader.cookie, stall.id);
    await configureBooking({ booking_enabled: false, eligible_tracks: [] });
    const res = await confirm(leader.cookie, held.body!.holdId, held.body!.token);
    expect(res.body!.error.code).toBe("BOOKING_SUSPENDED");
  });

  it("provisional (unapproved) inventory is never bookable", async () => {
    const leader = await createLeader();
    const [stall] = await seedStalls(1, "provisional");
    const res = await hold(leader.cookie, stall.id);
    expect(res.status).toBe(409);
    expect(res.body!.error).toMatchObject({ code: "STALL_UNAVAILABLE", details: { reason: "unavailable" } });
  });

  it("reports an unknown stall as 404 and a malformed id as 400", async () => {
    const leader = await createLeader();
    expect((await hold(leader.cookie, "00000000-0000-4000-8000-000000000000")).status).toBe(404);
    expect((await hold(leader.cookie, "not-a-uuid")).status).toBe(400);
  });
});

describe("authorisation, IDOR, CSRF and tokens", () => {
  it("requires a leader session on every booking endpoint", async () => {
    const [stall] = await seedStalls(1);
    expect((await hold("", stall.id)).status).toBe(401);
    expect((await me()).status).toBe(401);
    expect((await stalls()).status).toBe(401);
    expect((await confirm("", "00000000-0000-4000-8000-000000000000", issueHoldToken("a", "b", "1"))).status).toBe(401);
  });

  it("hides another team's hold (404) and rejects its token for anyone else", async () => {
    const [a, b] = await createLeaders(2);
    const [stall] = await seedStalls(1);
    const held = await hold(a.cookie, stall.id);
    const confirmByB = await confirm(b.cookie, held.body!.holdId, held.body!.token);
    expect(confirmByB.status).toBe(404);
    expect(confirmByB.body!.error.code).toBe("HOLD_NOT_FOUND");
    expect((await release(b.cookie, held.body!.holdId)).status).toBe(404);
    const sql = await getDb();
    const [row] = await sql`select status from booking.reservations where id = ${held.body!.holdId}`;
    expect(row.status).toBe("held");
  });

  it("rejects tokens for a different hold, with altered signatures, or with unknown key ids", async () => {
    await configureBooking({ rehold_cooldown_seconds: 0 });
    const leader = await createLeader();
    const [s1, s2] = await seedStalls(2);
    const first = await hold(leader.cookie, s1.id);
    await release(leader.cookie, first.body!.holdId);
    const second = await hold(leader.cookie, s2.id);

    const wrongHold = await confirm(leader.cookie, second.body!.holdId, first.body!.token);
    expect(wrongHold.body!.error.code).toBe("INVALID_HOLD_TOKEN");
    const token: string = second.body!.token;
    // Alter a middle character: the last base64url character also carries padding bits,
    // so changing it can leave the decoded signature unchanged (a flaky "tamper").
    const at = token.length - 10;
    const flipped = token.slice(0, at) + (token[at] === "A" ? "B" : "A") + token.slice(at + 1);
    expect((await confirm(leader.cookie, second.body!.holdId, flipped)).body!.error.code).toBe("INVALID_HOLD_TOKEN");
    const unknownKid = token.replace(/^v1\.t1\./, "v1.zz.");
    expect((await confirm(leader.cookie, second.body!.holdId, unknownKid)).body!.error.code).toBe("INVALID_HOLD_TOKEN");
    expect((await confirm(leader.cookie, second.body!.holdId, "garbage")).status).toBe(400);
    expect((await confirm(leader.cookie, second.body!.holdId, token)).status).toBe(201);
  });

  it("enforces same-origin JSON and strict bodies", async () => {
    const leader = await createLeader();
    const [stall] = await seedStalls(1);
    const crossSite = await call(holdsRoute.POST, apiRequest("/v1/booking/holds", { stallId: stall.id }, { cookie: leader.cookie, origin: "https://evil.example" }));
    expect(crossSite.status).toBe(403);
    const forged = await call(holdsRoute.POST, apiRequest("/v1/booking/holds", { stallId: stall.id, teamId: leader.teamId }, { cookie: leader.cookie }));
    expect(forged.status).toBe(400);
  });

  it("refuses a leader registered in both tracks", async () => {
    const leader = await createLeader();
    const sql = await getDb();
    await sql`
      insert into student_innovators (user_id, team_name, full_name, email, mobile, alt_mobile, domain, city, state, linkedin_url, edition_id)
      values (${leader.userId}, 'Other', 'X', ${leader.email}, '1', '2', 'd', 'c', 's', 'l', 2026)`;
    const [stall] = await seedStalls(1);
    expect((await hold(leader.cookie, stall.id)).body!.error.code).toBe("TEAM_AMBIGUOUS");
    expect((await me(leader.cookie)).status).toBe(409);
  });
});

describe("LIVE status snapshot", () => {
  it("LIVE-01: an expired hold shows as available without any write", async () => {
    await configureBooking({ hold_seconds: 2 });
    const leader = await createLeader();
    const [stall] = await seedStalls(1);
    const held = await hold(leader.cookie, stall.id);
    const before = await stalls(leader.cookie);
    expect(before.body!.stalls.find((s: any) => s.id === stall.id).status).toBe("held");

    const sql = await getDb();
    const [audit] = await sql`select count(*)::int as n from booking.audit_events`;
    await waitForExpiry(held.body!.holdId, 100);
    const after = await stalls(leader.cookie);
    expect(after.body!.stalls.find((s: any) => s.id === stall.id).status).toBe("available");
    expect(Date.parse(after.body!.asOf)).toBeGreaterThan(Date.parse(before.body!.asOf));
    const [auditAfter] = await sql`select count(*)::int as n from booking.audit_events`;
    expect(auditAfter.n).toBe(audit.n); // status changed with no write
  });

  it("LIVE-02: only the holder sees its hold id and expiry; nobody sees the token or another team's identity", async () => {
    const [a, b] = await createLeaders(2);
    const [stall] = await seedStalls(1);
    await hold(a.cookie, stall.id);
    const mine = (await stalls(a.cookie)).body!.stalls.find((s: any) => s.id === stall.id);
    expect(mine).toMatchObject({ status: "held", heldByYou: true });
    expect(mine.holdId).toBeDefined();
    expect(mine.expiresAt).toBeDefined();

    const theirs = await stalls(b.cookie);
    const seen = theirs.body!.stalls.find((s: any) => s.id === stall.id);
    expect(seen).toEqual({ id: stall.id, code: stall.code, zone: "PG", x: expect.any(Number), y: 0, w: 10, d: 10, rot: 0, status: "held" });
    expect(JSON.stringify(theirs.body)).not.toContain(a.teamId);
    expect(JSON.stringify(theirs.body)).not.toContain("v1.t1.");
  });

  it("LIVE-02: hold expiry is visible to others only when the organisers enable it", async () => {
    await configureBooking({ show_hold_expiry_publicly: true });
    const [a, b] = await createLeaders(2);
    const [stall] = await seedStalls(1);
    await hold(a.cookie, stall.id);
    const seen = (await stalls(b.cookie)).body!.stalls.find((s: any) => s.id === stall.id);
    expect(seen.expiresAt).toBeDefined();
    expect(seen.holdId).toBeUndefined();
  });

  it("LIVE-03: snapshots are private, uncacheable and carry no ETag; booked beats unavailable", async () => {
    const leader = await createLeader();
    const [stall] = await seedStalls(1);
    const held = await hold(leader.cookie, stall.id);
    await confirm(leader.cookie, held.body!.holdId, held.body!.token);
    const sql = await getDb();
    await sql`update booking.stalls set admin_status = 'disabled', disabled_at = now(), disabled_reason = 'test' where id = ${stall.id}`;
    const res = await stalls(leader.cookie);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(res.headers.get("vary")).toBe("Cookie");
    expect(res.headers.get("etag")).toBeNull();
    const row = res.body!.stalls.find((s: any) => s.id === stall.id);
    expect(row).toMatchObject({ status: "booked", bookingRef: expect.stringMatching(/^SJ26-/) });
  });

  it("allows anonymous viewing only when the public map is enabled", async () => {
    await seedStalls(1);
    expect((await stalls()).status).toBe(401);
    await configureBooking({ public_map: true });
    const anon = await stalls();
    expect(anon.status).toBe(200);
    expect(anon.body!.stalls.every((s: any) => s.heldByYou === undefined)).toBe(true);
  });

  it("validates the zone filter", async () => {
    const leader = await createLeader();
    expect((await stalls(leader.cookie, "?zone=pg")).status).toBe(400);
    const res = await stalls(leader.cookie, "?zone=BB");
    expect(res.status).toBe(200);
    expect(res.body!.stalls).toEqual([]);
  });
});

describe("GET /v1/booking/me", () => {
  it("returns the live hold with its token so another device can confirm", async () => {
    const leader = await createLeader();
    const [stall] = await seedStalls(1);
    const held = await hold(leader.cookie, stall.id);
    const view = await me(leader.cookie);
    expect(view.status).toBe(200);
    expect(view.body).toMatchObject({
      team: { track: "senior", approvalStatus: "pending" },
      eligibility: { canHold: true },
      reservation: { kind: "hold", holdId: held.body!.holdId, token: held.body!.token },
    });
  });
});
