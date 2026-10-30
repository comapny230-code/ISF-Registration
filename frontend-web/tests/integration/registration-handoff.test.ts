/**
 * Registration → booking handoff: a brand-new leader registering through the site
 * gets a short leader session without an email code, and only in that case.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as route from "@/app/v1/[...route]/route";
import { getDb } from "@/lib/db";
import { MAX_REGISTRATION_BODY_BYTES } from "@/lib/registration/uploads";
import { configureBooking, createLeader, me } from "../support/booking";
import { cookiePair, ORIGIN } from "../support/http";
import { nextAadhaar, registerVerified, requestRegistrationCode, nextMobile } from "../support/registration";

let counter = 0;
const PHOTO = "https://ik.imagekit.io/test/photo.jpg";

function payload(overrides: Record<string, unknown> = {}) {
  counter += 1;
  return {
    category: "startup_founder",
    teamName: `Handoff Team ${counter}`,
    fullName: `Handoff Leader ${counter}`,
    email: `handoff${counter}@example.test`,
    photoUrl: PHOTO,
    mobile: nextMobile(),
    altMobile: "9876543211",
    domain: "Agritech",
    projectDetails: "A project description.",
    city: "Gunupur",
    state: "Odisha",
    country: "India",
    linkedinUrl: "in/leader",
    aadharNumber: nextAadhaar(),
    members: [{ name: `Member ${counter}`, photoUrl: PHOTO, phone: "9123456780", email: `handoff-member${counter}@example.test` }],
    ...overrides,
  };
}

/** Registers the way the site's own form does (verified email, same-origin JSON) unless told otherwise. */
const register = (body: Record<string, any>, options: { sameOrigin?: boolean; cookie?: string } = {}) => registerVerified(body, options);
const sessionCookieOf = (headers: Headers) => headers.getSetCookie().find((c) => c.startsWith("__Host-sj_session=")) ?? null;

async function sessionCount(email: string): Promise<number> {
  const sql = await getDb();
  const [row] = await sql`
    select count(*)::int as n from app_auth.sessions s join user_accounts u on u.id = s.user_id where lower(u.email) = ${email}`;
  return row.n;
}

beforeEach(async () => {
  vi.stubEnv("FEATURE_BOOKING_UI", "true");
  await configureBooking();
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("REG-HANDOFF registration leads straight to booking", () => {
  it("signs a brand-new leader in, so booking works without an email code", async () => {
    const body = payload();
    const res = await register(body);
    expect(res.status).toBe(200);
    expect(res.json.booking).toEqual({ next: "/book-your-stall", signedIn: true });

    const setCookie = sessionCookieOf(res.headers)!;
    expect(setCookie).toMatch(/^__Host-sj_session=[A-Za-z0-9_-]{43}; Path=\/; HttpOnly; Secure; SameSite=Lax; Max-Age=\d+$/);
    expect(Number(/Max-Age=(\d+)/.exec(setCookie)![1])).toBeLessThanOrEqual(120 * 60);
    expect(res.headers.get("cache-control")).toBe("private, no-store");

    // The booking API identifies the team from the new registration, with no other input.
    const status = await me(cookiePair(res.headers, "__Host-sj_session")!);
    expect(status.status).toBe(200);
    expect(status.body!.team).toMatchObject({ name: body.teamName, track: "senior", approvalStatus: "pending" });
  });

  it("the handoff session lasts at most two hours", async () => {
    const body = payload();
    await register(body);
    const sql = await getDb();
    const [row] = await sql`
      select extract(epoch from (s.absolute_expires_at - s.created_at)) / 60 as minutes
        from app_auth.sessions s join user_accounts u on u.id = s.user_id where lower(u.email) = ${body.email}`;
    expect(Number(row.minutes)).toBeCloseTo(120, 0);
  });

  it("reports pending approval honestly instead of showing the new team as eligible", async () => {
    await configureBooking({ require_team_approval: true });
    const res = await register(payload());
    const status = await me(cookiePair(res.headers, "__Host-sj_session")!);
    expect(status.body!.eligibility).toEqual({ canHold: false, reason: "PENDING_APPROVAL" });
  });

  it("does not sign in a request that is not from the site's own form (no Origin / cross-site)", async () => {
    const body = payload();
    const res = await register(body, { sameOrigin: false });
    expect(res.status).toBe(200);
    expect(sessionCookieOf(res.headers)).toBeNull();
    expect(res.json.booking).toEqual({ next: "/login?next=/book-your-stall", signedIn: false });
    expect(await sessionCount(body.email)).toBe(0);
  });

  it("creates no session when registration fails validation", async () => {
    const body = payload({ aadharNumber: "" });
    const res = await register(body);
    expect(res.status).toBe(400);
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(await sessionCount(body.email)).toBe(0);
  });

  it("creates no session when the registration transaction rolls back", async () => {
    const body = payload();
    body.members.push({ name: "x".repeat(201), photoUrl: PHOTO, phone: "9000000002", email: `rollback${counter}@example.test` });
    const sql = await getDb();
    const [before] = await sql`select count(*)::int as n from app_auth.sessions`;

    const res = await register(body);
    expect(res.status).toBe(500);
    expect(res.headers.get("set-cookie")).toBeNull();
    const [after] = await sql`select count(*)::int as n from app_auth.sessions`;
    const [accounts] = await sql`select count(*)::int as n from user_accounts where lower(email) = ${body.email}`;
    expect(accounts.n).toBe(0);
    expect(after.n).toBe(before.n);
  });

  it("re-registering an existing leader's email is refused, with no code and no session", async () => {
    const body = payload();
    const first = await register(body);
    const before = await sessionCount(body.email);
    expect((await requestRegistrationCode(body.email)).status).toBe(409);
    const again = await register({ ...payload(), email: body.email });
    expect(first.status).toBe(200);
    expect(again.status).toBe(400);
    expect(sessionCookieOf(again.headers)).toBeNull();
    expect(await sessionCount(body.email)).toBe(before);
  });

  // A team member may register their own team as leader (rule restored on main, 2026-10-30).
  it("an address that already had an account (a team member) proves it with the code and goes straight to booking", async () => {
    const team = payload();
    await register(team);
    const memberEmail = team.members[0].email;

    const res = await register(payload({ email: memberEmail }));
    expect(res.status).toBe(200);
    expect(res.json.booking).toEqual({ next: "/book-your-stall", signedIn: true });
    expect(await sessionCount(memberEmail)).toBe(1);
  });

  it("does not offer booking at all while the booking page is switched off", async () => {
    vi.stubEnv("FEATURE_BOOKING_UI", "false");
    const res = await register(payload());
    expect(res.json.booking.next).toBeNull();
  });
});

describe("REG-HARDENING handoff session rotation and upload limits", () => {
  it("revokes a leader session already on the browser when the new team's session is issued", async () => {
    const earlier = await createLeader();
    expect((await me(earlier.cookie)).status).toBe(200);

    const res = await register(payload(), { cookie: earlier.cookie });
    expect(res.json.booking.signedIn).toBe(true);
    expect((await me(earlier.cookie)).status).toBe(401);
    const sql = await getDb();
    const [row] = await sql`
      select revoke_reason from app_auth.sessions s where s.user_id = ${earlier.userId} order by created_at desc limit 1`;
    expect(row.revoke_reason).toBe("rotated");
  });

  it.each([
    ["a javascript: URL", "javascript:alert(1)"],
    ["a plain http: URL", "http://example.test/p.jpg"],
    ["an HTML data URL", "data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg=="],
    ["an SVG data URL", "data:image/svg+xml;base64,PHN2Zy8+"],
    ["a data URL that is not base64", "data:image/jpeg;base64,<script>"],
  ])("rejects %s as the leader photo, with no rows written", async (_label, photoUrl) => {
    const body = payload({ photoUrl });
    const res = await register(body);
    expect(res.status).toBe(400);
    expect(res.headers.get("set-cookie")).toBeNull();
    const sql = await getDb();
    const [row] = await sql`select count(*)::int as n from user_accounts where lower(email) = ${body.email}`;
    expect(row.n).toBe(0);
  });

  it("rejects a scriptable member photo and a scriptable project report", async () => {
    const withMember = payload();
    withMember.members[0].photoUrl = "data:text/html;base64,PGI+eDwvYj4=";
    expect((await register(withMember)).status).toBe(400);
    expect((await register(payload({ projectReport: "data:text/html;base64,PGI+eDwvYj4=" }))).status).toBe(400);
    expect((await register(payload({ projectReport: "javascript:alert(1)" }))).status).toBe(400);
  });

  it("accepts the formats the form sends: JPEG data URL photos and a PDF data URL or https link for the report", async () => {
    const jpeg = `data:image/jpeg;base64,${Buffer.from("fake-jpeg-bytes").toString("base64")}`;
    const pdf = `data:application/pdf;base64,${Buffer.from("%PDF-1.4 fake").toString("base64")}`;
    const a = payload({ photoUrl: jpeg, projectReport: pdf });
    a.members[0].photoUrl = jpeg;
    expect((await register(a)).status).toBe(200);
    expect((await register(payload({ projectReport: "https://drive.example.test/report" }))).status).toBe(200);
  });

  it("refuses an oversized body declared by Content-Length before reading it (413)", async () => {
    const res = await route.POST(
      new Request(`${ORIGIN}/v1/auth/register`, {
        method: "POST",
        headers: { "content-type": "application/json", "content-length": String(MAX_REGISTRATION_BODY_BYTES + 1), "x-forwarded-for": "10.99.0.1" },
        body: "{}",
      })
    );
    expect(res.status).toBe(413);
  });

  it("refuses an oversized streamed body without a Content-Length (413), writing nothing", async () => {
    const body = payload({ projectDetails: "x".repeat(MAX_REGISTRATION_BODY_BYTES) });
    const res = await route.POST(
      new Request(`${ORIGIN}/v1/auth/register`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": "10.99.0.2" },
        body: new Blob([JSON.stringify(body)]).stream(),
        // @ts-expect-error Node's fetch needs this for a streamed request body.
        duplex: "half",
      })
    );
    expect(res.status).toBe(413);
    const sql = await getDb();
    const [row] = await sql`select count(*)::int as n from user_accounts where lower(email) = ${body.email}`;
    expect(row.n).toBe(0);
  });

  it("answers malformed JSON with 400, not a server error", async () => {
    const res = await route.POST(
      new Request(`${ORIGIN}/v1/auth/register`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": "10.99.0.3" },
        body: "{not json",
      })
    );
    expect(res.status).toBe(400);
  });
});
