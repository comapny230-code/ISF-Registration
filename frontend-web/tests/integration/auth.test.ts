/**
 * Email one-time-code login, sessions, CSRF and per-handler guards
 * (AUTH-01..08, AUTH-11, AUTH-12; docs/STALL_BOOKING_FINAL_SPEC.md §3, §9.3).
 */
import { beforeEach, describe, expect, it } from "vitest";
import * as logoutRoute from "@/app/v1/auth/logout/route";
import * as requestRoute from "@/app/v1/auth/otp/request/route";
import * as verifyRoute from "@/app/v1/auth/otp/verify/route";
import * as sessionRoute from "@/app/v1/auth/session/route";
import { requireAdmin, requireLeader } from "@/lib/auth/guards";
import { describeLeaderTeam, lockLeaderTeam } from "@/lib/auth/leader";
import { getDb } from "@/lib/db";
import { HttpError } from "@/lib/http";
import { capturedMailForTests } from "@/lib/mail";
import { nextAadhaar, registerVerified } from "../support/registration";
import { apiRequest, call, cookiePair } from "../support/http";

const LEADER_COOKIE = "__Host-sj_session";
const ADMIN_COOKIE = "__Host-sj_admin";
const PHOTO = "https://ik.imagekit.io/test/photo.jpg";
let n = 0;

async function registerLeader(category = "startup_founder") {
  n += 1;
  const email = `auth-leader${n}@example.test`;
  const memberEmail = `auth-member${n}@example.test`;
  const res = await registerVerified({
    category, teamName: `Auth Team ${n}`, fullName: `Auth Leader ${n}`, email, photoUrl: PHOTO,
    mobile: "9876543210", altMobile: "9876543211", domain: "Agritech", projectDetails: "Details",
    city: "Gunupur", state: "Odisha", country: "India", linkedinUrl: "in/x", aadharNumber: nextAadhaar(),
    members: [{ name: `Member ${n}`, photoUrl: PHOTO, phone: "9123456780", email: memberEmail }],
  });
  expect(res.status).toBe(200);
  const sql = await getDb();
  const [user] = await sql`select id from user_accounts where email = ${email}`;
  return { email, memberEmail, userId: user.id as string, teamName: `Auth Team ${n}` };
}

async function seedAdmin(permissions: string[]) {
  n += 1;
  const sql = await getDb();
  const email = `admin${n}@example.test`;
  const [admin] = await sql`
    insert into app_auth.admin_users (email, display_name, created_by) values (${email}, ${`Admin ${n}`}, 'test') returning id`;
  for (const permission of permissions) {
    await sql`insert into app_auth.admin_grants (admin_user_id, permission, granted_by) values (${admin.id}, ${permission}, 'test')`;
  }
  return { email, id: admin.id as string };
}

function lastCodeFor(email: string): string {
  const mail = [...capturedMailForTests].reverse().find((m) => m.to === email);
  if (!mail) throw new Error(`no code sent to ${email}`);
  return mail.subject.match(/(\d{6})$/)![1];
}

/** The binding cookie each email's "browser" received with its code (codes are bound to the requester). */
const bindings = new Map<string, string>();

async function requestCode(email: string, audience = "leader") {
  const res = await call(requestRoute.POST, apiRequest("/v1/auth/otp/request", { email, audience }, { cookie: bindings.get(email) }));
  const binding = cookiePair(res.headers, "__Host-sj_otp");
  if (binding) bindings.set(email, binding);
  return res;
}

const verify = (email: string, code: string, audience = "leader", cookie?: string) =>
  call(
    verifyRoute.POST,
    apiRequest("/v1/auth/otp/verify", { email, audience, code }, { cookie: [bindings.get(email), cookie].filter(Boolean).join("; ") || undefined })
  );

async function login(email: string, audience = "leader") {
  expect((await requestCode(email, audience)).status).toBe(202);
  const res = await verify(email, lastCodeFor(email), audience);
  expect(res.status).toBe(200);
  return cookiePair(res.headers, audience === "admin" ? ADMIN_COOKIE : LEADER_COOKIE)!;
}

const session = (cookie?: string) => call(sessionRoute.GET, apiRequest("/v1/auth/session", undefined, { cookie }));

beforeEach(() => {
  capturedMailForTests.length = 0;
});

describe("AUTH-01 code requests do not reveal accounts", () => {
  it("returns the same 202 for leader, member, unknown and wrong-audience emails; only real principals get mail", async () => {
    const leader = await registerLeader();
    const admin = await seedAdmin(["reports.view"]);
    const cases: Array<[string, string, boolean]> = [
      [leader.email, "leader", true],
      [leader.memberEmail, "leader", false],
      ["nobody@example.test", "leader", false],
      [leader.email, "admin", false],
      [admin.email, "admin", true],
      [admin.email, "leader", false],
    ];
    const bodies = new Set<string>();
    for (const [email, audience, expectMail] of cases) {
      capturedMailForTests.length = 0;
      const res = await requestCode(email, audience);
      expect(res.status).toBe(202);
      bodies.add(JSON.stringify(res.body));
      expect(capturedMailForTests.length).toBe(expectMail ? 1 : 0);
      if (expectMail) expect(capturedMailForTests[0].subject).toMatch(/\d{6}$/);
    }
    expect(bodies.size).toBe(1);

    const sql = await getDb();
    const [stored] = await sql`select count(*)::int as n from app_auth.login_challenges where email = ${leader.memberEmail}`;
    expect(stored.n).toBe(0);
  });

  it("never stores the code in plaintext", async () => {
    const leader = await registerLeader();
    await requestCode(leader.email);
    const code = lastCodeFor(leader.email);
    const sql = await getDb();
    const [row] = await sql`select encode(code_mac, 'hex') as mac from app_auth.login_challenges where email = ${leader.email}`;
    expect(row.mac).toHaveLength(64);
    expect(row.mac).not.toContain(code);
  });
});

describe("AUTH-02/03 code verification", () => {
  it("locks a challenge after 5 wrong attempts, even for the correct code", async () => {
    const leader = await registerLeader();
    await requestCode(leader.email);
    const code = lastCodeFor(leader.email);
    const wrong = code === "000000" ? "111111" : "000000";
    for (let i = 0; i < 5; i++) expect((await verify(leader.email, wrong)).status).toBe(400);
    const res = await verify(leader.email, code);
    expect(res.status).toBe(400);
    expect(res.body!.error.code).toBe("INVALID_OR_EXPIRED_CODE");
  });

  it("counts parallel wrong guesses atomically (never more than 5 attempts)", async () => {
    const leader = await registerLeader();
    await requestCode(leader.email);
    const wrong = lastCodeFor(leader.email) === "000000" ? "111111" : "000000";
    const results = await Promise.all(Array.from({ length: 12 }, () => verify(leader.email, wrong)));
    expect(results.every((r) => r.status === 400)).toBe(true);
    const sql = await getDb();
    const [row] = await sql`select attempts from app_auth.login_challenges where email = ${leader.email}`;
    expect(row.attempts).toBe(5);
  });

  it("rejects expired, reused and superseded codes", async () => {
    const sql = await getDb();
    const a = await registerLeader();
    await requestCode(a.email);
    await sql`update app_auth.login_challenges
                 set created_at = created_at - interval '11 minutes', expires_at = expires_at - interval '11 minutes'
               where email = ${a.email}`;
    expect((await verify(a.email, lastCodeFor(a.email))).status).toBe(400);

    const b = await registerLeader();
    await requestCode(b.email);
    const codeB = lastCodeFor(b.email);
    expect((await verify(b.email, codeB)).status).toBe(200);
    expect((await verify(b.email, codeB)).status).toBe(400);

    const c = await registerLeader();
    await requestCode(c.email);
    const first = lastCodeFor(c.email);
    await requestCode(c.email);
    const second = lastCodeFor(c.email);
    if (first !== second) expect((await verify(c.email, first)).status).toBe(400);
    expect((await verify(c.email, second)).status).toBe(200);
  });

  it("creates exactly one session when the correct code is submitted twice in parallel", async () => {
    const leader = await registerLeader();
    await requestCode(leader.email);
    const code = lastCodeFor(leader.email);
    // Registration through the site already started its own short handoff session; count only verification's.
    const sql = await getDb();
    const [before] = await sql`select count(*)::int as n from app_auth.sessions where user_id = ${leader.userId}`;
    const results = await Promise.all([verify(leader.email, code), verify(leader.email, code)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 400]);
    const [row] = await sql`select count(*)::int as n from app_auth.sessions where user_id = ${leader.userId}`;
    expect(row.n - before.n).toBe(1);
  });
});

describe("AUTH-04 rate limits", () => {
  it("limits code requests per email with Retry-After", async () => {
    const leader = await registerLeader();
    for (let i = 0; i < 3; i++) expect((await requestCode(leader.email)).status).toBe(202);
    const limited = await requestCode(leader.email);
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
  });

  it("limits code requests per client address", async () => {
    const ip = "192.0.2.10";
    const statuses: number[] = [];
    for (let i = 0; i < 21; i++) {
      statuses.push((await call(requestRoute.POST, apiRequest("/v1/auth/otp/request", { email: `ip${i}@example.test`, audience: "leader" }, { ip }))).status);
    }
    expect(statuses.slice(0, 20).every((s) => s === 202)).toBe(true);
    expect(statuses[20]).toBe(429);
  });
});

describe("AUTH-05/06 sessions", () => {
  it("issues a __Host- cookie with secure attributes and reports the leader's team", async () => {
    const leader = await registerLeader();
    await requestCode(leader.email);
    const res = await verify(leader.email, lastCodeFor(leader.email));
    const cookies = res.headers.getSetCookie();
    const setCookie = cookies.find((c) => c.startsWith("__Host-sj_session="))!;
    expect(setCookie).toMatch(/^__Host-sj_session=[A-Za-z0-9_-]{43}; Path=\/; HttpOnly; Secure; SameSite=Lax; Max-Age=\d+$/);
    // The one-time code's browser binding is cleared once it has been used.
    expect(cookies).toContain("__Host-sj_otp=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0");
    expect(Number(setCookie.match(/Max-Age=(\d+)/)![1])).toBeGreaterThan(11 * 3600);
    expect(res.headers.get("cache-control")).toBe("private, no-store");

    const me = await session(cookiePair(res.headers, LEADER_COOKIE)!);
    expect(me.body!.leader).toMatchObject({
      resolution: "leader",
      team: { name: leader.teamName, track: "senior", approvalStatus: "pending" },
    });
    expect(me.body!.admin).toBeNull();
  });

  it("logout revokes the session and clears the cookie", async () => {
    const leader = await registerLeader();
    const cookie = await login(leader.email);
    const out = await call(logoutRoute.POST, apiRequest("/v1/auth/logout", { audience: "leader" }, { cookie }));
    expect(out.status).toBe(204);
    expect(out.headers.get("set-cookie")).toMatch(/Max-Age=0/);
    expect((await session(cookie)).body!.leader).toBeNull();
  });

  it("expires sessions on idle and absolute limits using the database clock", async () => {
    const sql = await getDb();
    const a = await registerLeader();
    const idle = await login(a.email);
    await sql`update app_auth.sessions set idle_expires_at = clock_timestamp() - interval '1 second' where user_id = ${a.userId}`;
    expect((await session(idle)).body!.leader).toBeNull();

    const b = await registerLeader();
    const absolute = await login(b.email);
    await sql`update app_auth.sessions
                 set idle_expires_at = clock_timestamp() - interval '2 seconds', absolute_expires_at = clock_timestamp() - interval '1 second'
               where user_id = ${b.userId}`;
    expect((await session(absolute)).body!.leader).toBeNull();
  });

  it("rotates the session on re-login and caps live sessions at 5", async () => {
    const sql = await getDb();
    const leader = await registerLeader();
    const first = await login(leader.email);
    await requestCode(leader.email);
    const rotated = await verify(leader.email, lastCodeFor(leader.email), "leader", first);
    expect(rotated.status).toBe(200);
    expect((await session(first)).body!.leader).toBeNull();

    await sql`delete from app_auth.rate_limits`;
    for (let i = 0; i < 6; i++) {
      if (i % 3 === 0) await sql`delete from app_auth.rate_limits`;
      await login(leader.email);
    }
    const [live] = await sql`select count(*)::int as n from app_auth.sessions where user_id = ${leader.userId} and revoked_at is null`;
    expect(live.n).toBe(5);
  });

  it("ignores forged or malformed cookies", async () => {
    expect((await session(`${LEADER_COOKIE}=${"A".repeat(43)}`)).body!.leader).toBeNull();
    expect((await session(`${LEADER_COOKIE}=not-a-token`)).body!.leader).toBeNull();
  });
});

describe("AUTH-07 CSRF and strict bodies", () => {
  const body = { email: "csrf@example.test", audience: "leader" };
  it.each([
    ["wrong origin", { origin: "https://evil.example" }],
    ["missing origin", { origin: null }],
    ["form content type", { contentType: "application/x-www-form-urlencoded" }],
    ["text/plain content type", { contentType: "text/plain" }],
    ["cross-site fetch", { fetchSite: "cross-site" }],
  ])("rejects %s with 403", async (_label, options) => {
    const res = await call(requestRoute.POST, apiRequest("/v1/auth/otp/request", body, options as any));
    expect(res.status).toBe(403);
    expect(res.body!.error.code).toBe("CSRF_REJECTED");
  });

  it("rejects unknown fields and malformed input with 400", async () => {
    const extra = await call(requestRoute.POST, apiRequest("/v1/auth/otp/request", { ...body, teamId: "x" }));
    expect(extra.status).toBe(400);
    const badCode = await call(verifyRoute.POST, apiRequest("/v1/auth/otp/verify", { ...body, code: "12345" }));
    expect(badCode.status).toBe(400);
    const notJson = await call(requestRoute.POST, apiRequest("/v1/auth/otp/request", "{nope"));
    expect(notJson.status).toBe(400);
  });
});

describe("AUTH-08 server-side team resolution", () => {
  it("resolves leaders, refuses members, and flags leaders registered in both tracks", async () => {
    const sql = await getDb();
    const leader = await registerLeader();
    expect(await describeLeaderTeam(sql, leader.userId)).toMatchObject({ resolution: "leader" });

    const [member] = await sql`select id from user_accounts where email = ${leader.memberEmail}`;
    expect(await describeLeaderTeam(sql, member.id)).toEqual({ resolution: "not_leader" });
    await expect(sql.begin((tx) => lockLeaderTeam(tx, member.id))).rejects.toMatchObject({ code: "NOT_TEAM_LEADER" });

    const both = await registerLeader();
    await sql`
      insert into student_innovators (user_id, team_name, full_name, email, mobile, alt_mobile, domain, city, state, linkedin_url, edition_id)
      values (${both.userId}, 'Second Track', 'X', ${both.email}, '1', '2', 'd', 'c', 's', 'l', 2026)`;
    expect(await describeLeaderTeam(sql, both.userId)).toEqual({ resolution: "ambiguous" });
    await expect(sql.begin((tx) => lockLeaderTeam(tx, both.userId))).rejects.toMatchObject({ code: "TEAM_AMBIGUOUS" });
  });

  it("locks the existing team row and is idempotent", async () => {
    const sql = await getDb();
    const leader = await registerLeader("student_innovator");
    const first = await sql.begin((tx) => lockLeaderTeam(tx, leader.userId));
    const again = await sql.begin((tx) => lockLeaderTeam(tx, leader.userId));
    expect(again).toEqual(first);
    expect(first).toMatchObject({ track: "junior", teamName: leader.teamName, approvalStatus: "pending" });
  });

  it("a team member cannot obtain a leader session at all", async () => {
    const leader = await registerLeader();
    capturedMailForTests.length = 0; // discard the leader's registration confirmation
    expect((await requestCode(leader.memberEmail)).status).toBe(202);
    expect(capturedMailForTests).toHaveLength(0);
    const sql = await getDb();
    const [row] = await sql`select count(*)::int as n from app_auth.login_challenges where email = ${leader.memberEmail}`;
    expect(row.n).toBe(0);
  });
});

describe("AUTH-11/12 guards and admin separation", () => {
  it("requires a leader session for requireLeader and ignores admin cookies", async () => {
    const admin = await seedAdmin(["reports.view"]);
    const adminCookie = await login(admin.email, "admin");
    await expect(requireLeader(apiRequest("/x", undefined, { cookie: adminCookie }))).rejects.toMatchObject({ status: 401 });
    const leader = await registerLeader();
    const leaderCookie = await login(leader.email);
    await expect(requireLeader(apiRequest("/x", undefined, { cookie: leaderCookie }))).resolves.toMatchObject({
      session: { audience: "leader", principalId: leader.userId },
    });
  });

  it("enforces each admin permission separately, step-up freshness, grant revocation and disabled admins", async () => {
    const sql = await getDb();
    const admin = await seedAdmin(["booking.cancel"]);
    const cookie = await login(admin.email, "admin");
    const req = () => apiRequest("/x", undefined, { cookie });

    await expect(requireAdmin(req(), "booking.cancel", { stepUp: true })).resolves.toBeTruthy();
    await expect(requireAdmin(req(), "inventory.manage")).rejects.toMatchObject({ code: "FORBIDDEN" });

    await sql`update app_auth.sessions set reauth_at = clock_timestamp() - interval '11 minutes' where admin_user_id = ${admin.id}`;
    await expect(requireAdmin(req(), "booking.cancel", { stepUp: true })).rejects.toMatchObject({ code: "REAUTH_REQUIRED" });
    await expect(requireAdmin(req(), "booking.cancel")).resolves.toBeTruthy();

    await sql`update app_auth.admin_grants set revoked_at = clock_timestamp(), revoked_by = 'test' where admin_user_id = ${admin.id}`;
    await expect(requireAdmin(req(), "booking.cancel")).rejects.toMatchObject({ code: "FORBIDDEN" });

    await sql`update app_auth.admin_users set status = 'disabled', disabled_at = clock_timestamp() where id = ${admin.id}`;
    await expect(requireAdmin(req(), "booking.cancel")).rejects.toBeInstanceOf(HttpError);
    await expect(requireAdmin(req(), "booking.cancel")).rejects.toMatchObject({ status: 401 });
  });

  it("registering with an administrator's email cannot create, change or promote the admin", async () => {
    const sql = await getDb();
    const admin = await seedAdmin(["reports.view"]);
    const [before] = await sql`select * from app_auth.admin_users where id = ${admin.id}`;
    const res = await registerVerified({
      category: "startup_founder", teamName: "Admin Team", fullName: "Impostor", email: admin.email, photoUrl: PHOTO,
      mobile: "9876543210", altMobile: "9876543211", domain: "d", projectDetails: "p", city: "c", state: "s",
      country: "India", linkedinUrl: "in/x", aadharNumber: nextAadhaar(),
      members: [{ name: "M", photoUrl: PHOTO, phone: "9123456780", email: `m-${admin.email}` }],
    });
    expect(res.status).toBe(200);
    const [after] = await sql`select * from app_auth.admin_users where id = ${admin.id}`;
    expect(after).toEqual(before);
    const grants = await sql`select permission from app_auth.admin_grants where admin_user_id = ${admin.id}`;
    expect(grants.map((g) => g.permission)).toEqual(["reports.view"]);
  });
});
