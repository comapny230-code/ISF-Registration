/**
 * Leader-only booking (every mutation authorises on the server from the session's own
 * leader registration) and the booking ticket download.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as holdsRoute from "@/app/v1/booking/holds/route";
import * as ticketRoute from "@/app/v1/booking/ticket/route";
import { getDb } from "@/lib/db";
import { capturedMailForTests } from "@/lib/mail";
import { createAdmin } from "../support/admin";
import {
  assertInvariants,
  configureBooking,
  confirm,
  createLeader,
  createLeaders,
  hold,
  me,
  newSessionCookie,
  release,
  seedStalls,
  waitForExpiry,
} from "../support/booking";
import { apiRequest, call } from "../support/http";

async function ticket(cookie?: string) {
  const res = await ticketRoute.GET(apiRequest("/v1/booking/ticket", undefined, { cookie }));
  const bytes = Buffer.from(await res.arrayBuffer());
  return { status: res.status, headers: res.headers, bytes, json: res.headers.get("content-type")?.includes("json") ? JSON.parse(bytes.toString()) : null };
}

/** A team member's account with a (forged-for-test) leader-audience session: the worst case if a member ever had one. */
async function memberWithSession(leaderTeamName = "Member's team") {
  const sql = await getDb();
  const [u] = await sql`
    insert into user_accounts (email, full_name, category, team_name)
    values (${`member-${crypto.randomUUID().slice(0, 8)}@example.test`}, 'Team Member', 'startup_team_member', ${leaderTeamName})
    returning id`;
  return { userId: u.id as string, cookie: await newSessionCookie(u.id) };
}

beforeEach(async () => {
  await configureBooking();
});
afterEach(async () => {
  await assertInvariants();
});

describe("LEADER-ONLY booking mutations", () => {
  it("a team member's session cannot hold, confirm, release, read status or download a ticket", async () => {
    const [leader] = await createLeaders(1);
    const [stall] = await seedStalls(1);
    const held = await hold(leader.cookie, stall.id);
    const member = await memberWithSession();

    const tryHold = await hold(member.cookie, stall.id);
    expect(tryHold.status).toBe(403);
    expect(tryHold.body!.error.code).toBe("NOT_TEAM_LEADER");
    expect((await confirm(member.cookie, held.body!.holdId, held.body!.token)).status).toBe(403);
    expect((await release(member.cookie, held.body!.holdId)).status).toBe(403);
    expect((await me(member.cookie)).status).toBe(403);
    expect((await ticket(member.cookie)).status).toBe(403);

    const sql = await getDb();
    const [row] = await sql`select status from booking.reservations where id = ${held.body!.holdId}`;
    expect(row.status).toBe("held");
    const [teams] = await sql`select count(*)::int as n from booking.teams where leader_user_id = ${member.userId}`;
    expect(teams.n).toBe(0);
  });

  it("an unauthenticated caller cannot perform any booking mutation or download a ticket", async () => {
    const [stall] = await seedStalls(1);
    expect((await hold("", stall.id)).status).toBe(401);
    expect((await release("", "00000000-0000-4000-8000-000000000000")).status).toBe(401);
    expect((await ticket()).status).toBe(401);
  });

  it("an administrator's session does not grant leader booking", async () => {
    const admin = await createAdmin(["booking.cancel", "inventory.manage", "teams.manage", "reports.view"]);
    const [leader] = await createLeaders(1);
    const [stall] = await seedStalls(1);
    const held = await hold(leader.cookie, stall.id);

    expect((await hold(admin.cookie, stall.id)).status).toBe(401);
    expect((await confirm(admin.cookie, held.body!.holdId, held.body!.token)).status).toBe(401);
    expect((await release(admin.cookie, held.body!.holdId)).status).toBe(401);
    expect((await me(admin.cookie)).status).toBe(401);
    expect((await ticket(admin.cookie)).status).toBe(401);
  });

  it("a session token only works for its own audience, even when moved into the other cookie", async () => {
    const admin = await createAdmin(["booking.cancel", "reports.view"]);
    const leader = await createLeader();
    const [stall] = await seedStalls(1);
    const adminToken = admin.cookie.split("=")[1];
    const leaderToken = leader.cookie.split("=")[1];

    // An admin token presented as the leader cookie is not a leader session.
    expect((await hold(`__Host-sj_session=${adminToken}`, stall.id)).status).toBe(401);
    expect((await ticket(`__Host-sj_session=${adminToken}`)).status).toBe(401);
    // A leader token presented as the admin cookie gets no admin access.
    const { listBookings } = await import("../support/admin");
    expect((await listBookings(`__Host-sj_admin=${leaderToken}`)).status).toBe(401);
  });

  it("a team id (or any other extra field) in the request body is refused, never used", async () => {
    const [a, b] = await createLeaders(2);
    const [stall] = await seedStalls(1);
    const res = await call(holdsRoute.POST, apiRequest("/v1/booking/holds", { stallId: stall.id, teamId: b.teamId }, { cookie: a.cookie }));
    expect(res.status).toBe(400);
    const sql = await getDb();
    const [row] = await sql`select count(*)::int as n from booking.reservations where stall_id = ${stall.id}`;
    expect(row.n).toBe(0);
  });

  it("another team's hold id cannot be confirmed or released, even with that team's own token", async () => {
    const [a, b] = await createLeaders(2);
    const [stall] = await seedStalls(1);
    const held = await hold(a.cookie, stall.id);
    expect((await confirm(b.cookie, held.body!.holdId, held.body!.token)).status).toBe(404);
    expect((await release(b.cookie, held.body!.holdId)).status).toBe(404);
  });
});

describe("TICKET download", () => {
  it("a confirmed booking downloads as a PDF carrying the database's stall number", async () => {
    const leader = await createLeader();
    const [stall] = await seedStalls(1);
    const held = await hold(leader.cookie, stall.id);
    const booked = await confirm(leader.cookie, held.body!.holdId, held.body!.token);
    expect(booked.status).toBe(201);

    const res = await ticket(leader.cookie);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("content-disposition")).toBe(
      `attachment; filename="startup-jathara-stall-${stall.code}-${booked.body!.bookingRef}.pdf"`
    );
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    const pdf = res.bytes.toString("latin1");
    expect(pdf.startsWith("%PDF-1.4")).toBe(true);
    expect(pdf).toContain(`(${stall.code}) Tj`);
    expect(pdf).toContain(`(${booked.body!.bookingRef}) Tj`);
    expect(pdf).toContain("(Contact number: 9437432282) Tj");
  });

  it("another leader gets only their own (missing) ticket, never someone else's", async () => {
    const [a, b] = await createLeaders(2);
    const [stall] = await seedStalls(1);
    const held = await hold(a.cookie, stall.id);
    await confirm(a.cookie, held.body!.holdId, held.body!.token);

    const res = await ticket(b.cookie);
    expect(res.status).toBe(404);
    expect(res.json.error.code).toBe("NO_BOOKING");
    expect(res.bytes.toString()).not.toContain(stall.code);
  });

  it("a hold that was never confirmed, or that expired, produces no ticket", async () => {
    await configureBooking({ hold_seconds: 2 });
    const leader = await createLeader();
    const [stall] = await seedStalls(1);
    const held = await hold(leader.cookie, stall.id);
    expect((await ticket(leader.cookie)).status).toBe(404);

    await waitForExpiry(held.body!.holdId);
    const late = await confirm(leader.cookie, held.body!.holdId, held.body!.token);
    expect(late.status).toBeGreaterThanOrEqual(400);
    expect((await ticket(leader.cookie)).status).toBe(404);
  });

  it("the database itself refuses to blank or rewrite a stall number", async () => {
    const [stall] = await seedStalls(1);
    const sql = await getDb();
    await expect(sql`update booking.stalls set code = '' where id = ${stall.id}`).rejects.toThrow();
    const [row] = await sql`select code from booking.stalls where id = ${stall.id}`;
    expect(row.code).toBe(stall.code);
  });
});

describe("BOOKING-EMAIL confirmation to the registered address", () => {
  it("emails the leader once per booking, with escaped team details and the arrangements contact", async () => {
    const leader = await createLeader();
    const [stall] = await seedStalls(1);
    const sql = await getDb();
    await sql`update booking.teams set team_name_snapshot = '<img src=x onerror=alert(1)>' where id = ${leader.teamId}`;
    capturedMailForTests.length = 0;

    const held = await hold(leader.cookie, stall.id);
    const booked = await confirm(leader.cookie, held.body!.holdId, held.body!.token);
    expect(booked.status).toBe(201);
    const replay = await confirm(leader.cookie, held.body!.holdId, held.body!.token);
    expect(replay.status).toBe(200);

    const mails = capturedMailForTests.filter((m) => m.to === leader.email);
    expect(mails).toHaveLength(1);
    expect(mails[0].subject).toBe(`Stall ${stall.code} booked for Startup Jathara 2026 (${booked.body!.bookingRef})`);
    expect(mails[0].html).toContain("Contact number: <strong>9437432282</strong>");
    expect(mails[0].html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(mails[0].html).not.toContain("<img src=x");
  });

  it("sends nothing when the confirmation fails", async () => {
    const [a, b] = await createLeaders(2);
    const [stall] = await seedStalls(1);
    const held = await hold(a.cookie, stall.id);
    capturedMailForTests.length = 0;
    expect((await confirm(b.cookie, held.body!.holdId, held.body!.token)).status).toBe(404);
    expect(capturedMailForTests).toHaveLength(0);
  });
});
