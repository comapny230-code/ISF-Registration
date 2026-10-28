/**
 * POST /v1/auth/register: behaviour preserved from the characterisation run (REG-01)
 * and the P2 hardening (REG-02..08; docs/STALL_BOOKING_FINAL_SPEC.md §6).
 */
import { beforeEach, describe, expect, it } from "vitest";
import * as route from "@/app/v1/[...route]/route";
import { closeDb, getDb } from "@/lib/db";
import { capturedMailForTests } from "@/lib/mail";

let counter = 0;
const PHOTO = "https://ik.imagekit.io/test/photo.jpg";

function payload(overrides: Record<string, unknown> = {}) {
  counter += 1;
  return {
    category: "startup_founder",
    teamName: `Team ${counter}`,
    fullName: `Leader ${counter}`,
    email: `leader${counter}@example.test`,
    photoUrl: PHOTO,
    mobile: "9876543210",
    altMobile: "9876543211",
    domain: "Agritech & Food Safety",
    projectDetails: "A project description.",
    city: "Gunupur",
    state: "Odisha",
    country: "India",
    linkedinUrl: "in/leader",
    aadharNumber: "123412341234",
    members: [{ name: `Member ${counter}`, photoUrl: PHOTO, phone: "9123456780", email: `member${counter}@example.test` }],
    ...overrides,
  };
}

let ip = 0;
async function register(body: unknown, clientIp = `10.1.${Math.floor(++ip / 250)}.${ip % 250}`) {
  const res = await route.POST(
    new Request("http://localhost/v1/auth/register", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": clientIp },
      body: JSON.stringify(body),
    })
  );
  return { status: res.status, json: (await res.json()) as Record<string, any> };
}

async function rowCounts(email: string) {
  const sql = await getDb();
  const [row] = await sql`
    select
      (select count(*)::int from user_accounts where lower(email) = ${email}) as accounts,
      (select count(*)::int from startup_team_leaders where lower(email) = ${email}) as senior,
      (select count(*)::int from student_innovators where lower(email) = ${email}) as junior,
      (select count(*)::int from booking.teams t join user_accounts u on u.id = t.leader_user_id where lower(u.email) = ${email}) as teams`;
  return row;
}

beforeEach(() => {
  capturedMailForTests.length = 0;
});

describe("REG-01 registration (behaviour preserved)", () => {
  it("registers a senior-track leader with one member", async () => {
    const body = payload();
    const { status, json } = await register(body);
    expect(status).toBe(200);
    expect(json.ok).toBe(true);

    const sql = await getDb();
    const [leader] = await sql`select id, category, team_name from user_accounts where email = ${body.email}`;
    expect(leader).toMatchObject({ category: "startup_founder", team_name: body.teamName });
    // Response shape preserved apart from the removed Aadhaar/PAN fields.
    expect(Object.keys(json.user).sort()).toEqual(
      ["category", "domain", "email", "fullName", "id", "membersCount", "photoUrl", "projectDetails", "projectReportUrl", "roles", "teamName"]
    );
    expect(json.user.id).toBe(leader.id);
    const roles = await sql`select role from role_grants where user_id = ${leader.id}`;
    expect(roles.map((r) => r.role)).toEqual(["startup_team_leader"]);
    const [access] = await sql`select edition_id from edition_access where user_id = ${leader.id}`;
    expect(access.edition_id).toBe(2026);

    const [stl] = await sql`select startup_id, team_name, edition_id from startup_team_leaders where user_id = ${leader.id}`;
    expect(stl).toMatchObject({ team_name: body.teamName, edition_id: 2026 });
    const memberships = await sql`
      select u.email, m.position from startup_memberships m join user_accounts u on u.id = m.user_id
      where m.startup_id = ${stl.startup_id} order by m.position`;
    expect(memberships.map((m) => [m.email, m.position])).toEqual([
      [body.email, "leader"],
      [body.members[0].email, "member"],
    ]);
    const members = await sql`select email from startup_team_members where leader_user_id = ${leader.id}`;
    expect(members.map((m) => m.email)).toEqual([body.members[0].email]);
    const [memberAccount] = await sql`select category from user_accounts where email = ${body.members[0].email}`;
    expect(memberAccount.category).toBe("startup_team_member");

    expect(capturedMailForTests).toHaveLength(1);
    expect(capturedMailForTests[0]).toMatchObject({ to: body.email });
    expect(capturedMailForTests[0].subject).toContain(body.teamName);
  });

  it("registers a junior-track (student innovator) leader", async () => {
    const body = payload({ category: "student_innovator" });
    expect((await register(body)).status).toBe(200);
    const sql = await getDb();
    const [leader] = await sql`select id from user_accounts where email = ${body.email}`;
    const [si] = await sql`select id, team_name from student_innovators where user_id = ${leader.id}`;
    expect(si.team_name).toBe(body.teamName);
    const members = await sql`select email from student_team_members where student_innovator_id = ${si.id}`;
    expect(members.map((m) => m.email)).toEqual([body.members[0].email]);
  });

  it("rejects a missing Aadhaar number with 400", async () => {
    const { status, json } = await register(payload({ aadharNumber: "" }));
    expect(status).toBe(400);
    expect(json.message).toMatch(/Aadhaar/);
  });
});

describe("REG-02 no takeover by resubmission", () => {
  it("rejects a second registration for the same email in the same track, leaving data unchanged", async () => {
    const first = payload();
    expect((await register(first)).status).toBe(200);
    const { status, json } = await register({ ...payload(), email: first.email, teamName: "Hijacked Team" });
    expect(status).toBe(409);
    expect(json.code).toBe("ALREADY_REGISTERED");

    const sql = await getDb();
    const [stl] = await sql`select team_name from startup_team_leaders where lower(email) = ${first.email}`;
    expect(stl.team_name).toBe(first.teamName);
    expect(await rowCounts(first.email)).toEqual({ accounts: 1, senior: 1, junior: 0, teams: 1 });
  });

  it("rejects a registration of the same email in the other track", async () => {
    const first = payload();
    expect((await register(first)).status).toBe(200);
    expect((await register({ ...payload({ category: "student_innovator" }), email: first.email })).status).toBe(409);
    expect(await rowCounts(first.email)).toEqual({ accounts: 1, senior: 1, junior: 0, teams: 1 });
  });

  it("serialises concurrent first registrations of one email: exactly one succeeds", async () => {
    const email = `race${++counter}@example.test`;
    const results = await Promise.all(
      Array.from({ length: 5 }, (_, i) => register({ ...payload(), email, teamName: `Race ${i}` }))
    );
    expect(results.map((r) => r.status).sort()).toEqual([200, 409, 409, 409, 409]);
    expect(await rowCounts(email)).toEqual({ accounts: 1, senior: 1, junior: 0, teams: 1 });
  });

  it("accepts a 200-character team name and rejects longer ones with a clear 400 (was a raw 500)", async () => {
    const maxName = "T".repeat(200);
    const ok = payload({ teamName: maxName });
    expect((await register(ok)).status).toBe(200);
    const sql = await getDb();
    const [row] = await sql`
      select t.team_name_snapshot from startup_team_leaders l
        join booking.teams t on t.startup_team_leader_id = l.id where lower(l.email) = ${ok.email}`;
    expect(row.team_name_snapshot).toBe(maxName);

    const tooLong = await register(payload({ teamName: "T".repeat(201) }));
    expect(tooLong.status).toBe(400);
    expect(tooLong.json.message).toMatch(/at most 200 characters/);
  });

  it("normalises legacy category aliases to the canonical value (R-06)", async () => {
    const body = payload({ category: "startup_leader" });
    expect((await register(body)).status).toBe(200);
    const sql = await getDb();
    const [account] = await sql`select category from user_accounts where email = ${body.email}`;
    expect(account.category).toBe("startup_founder");
  });
});

describe("REG-03 member records never modify existing accounts", () => {
  it("listing an existing leader as a member does not rename, recategorise or demote them", async () => {
    const leaderA = payload();
    expect((await register(leaderA)).status).toBe(200);
    const sql = await getDb();
    const [before] = await sql`select id, full_name, category, team_name from user_accounts where email = ${leaderA.email}`;

    const leaderB = payload({
      members: [{ name: "Someone Else", photoUrl: PHOTO, phone: "9000000000", email: leaderA.email }],
    });
    expect((await register(leaderB)).status).toBe(200);

    const [after] = await sql`select id, full_name, category, team_name from user_accounts where email = ${leaderA.email}`;
    expect(after).toEqual(before);
    const positions = await sql`select position from startup_memberships where user_id = ${before.id} order by position`;
    expect(positions.map((p) => p.position)).toEqual(["leader", "member"]); // leader of A, member of B; A not demoted
    const [teamA] = await sql`select team_name from startup_team_leaders where user_id = ${before.id}`;
    expect(teamA.team_name).toBe(leaderA.teamName);
  });

  it("rejects a member using the leader's own email", async () => {
    const body = payload();
    body.members = [{ name: "Me Again", photoUrl: PHOTO, phone: "9000000000", email: body.email }];
    const { status, json } = await register(body);
    expect(status).toBe(400);
    expect(json.message).toMatch(/leader's email/);
  });

  it("rejects duplicate member emails within one submission", async () => {
    const body = payload();
    const twin = { name: "Twin", photoUrl: PHOTO, phone: "9000000001", email: `twin${counter}@example.test` };
    body.members = [twin, { ...twin, name: "Twin Two" }];
    expect((await register(body)).status).toBe(400);
  });
});

describe("REG-04/05 atomicity and sanitised errors", () => {
  it("rolls back every row when a member insert fails part-way", async () => {
    const body = payload();
    body.members.push({ name: "x".repeat(201), photoUrl: PHOTO, phone: "9000000002", email: `long${counter}@example.test` });
    const { status, json } = await register(body);
    expect(status).toBe(500);
    expect(json).not.toHaveProperty("detail");
    expect(await rowCounts(body.email)).toEqual({ accounts: 0, senior: 0, junior: 0, teams: 0 });
    expect(await rowCounts(body.members[0].email)).toMatchObject({ accounts: 0 });
    expect(capturedMailForTests).toHaveLength(0);
  });

  it("returns a sanitised 500 with a reference instead of the database error", async () => {
    const { status, json } = await register(payload({ fullName: "y".repeat(201) }));
    expect(status).toBe(500);
    expect(json.requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(json).not.toHaveProperty("detail");
    expect(JSON.stringify(json)).not.toMatch(/violates|constraint|user_accounts|postgres|supabase/i);
  });

  it("returns 503 without details when the database configuration is unsafe", async () => {
    const saved = process.env.TEST_DATABASE_URL;
    await closeDb();
    process.env.TEST_DATABASE_URL = "postgresql://isf_test:x@db.someproject.supabase.co:5432/isf_test";
    try {
      const { status, json } = await register(payload());
      expect(status).toBe(503);
      expect(JSON.stringify(json)).not.toMatch(/supabase|TEST_DATABASE_URL|guard/i);
    } finally {
      process.env.TEST_DATABASE_URL = saved;
      await closeDb();
    }
  });
});

describe("REG-06/07/08 response, email and team identity", () => {
  it("does not echo Aadhaar or PAN numbers in the response (R-11)", async () => {
    const { json } = await register(payload({ panNumber: "ABCDE1234F" }));
    expect(json.user).not.toHaveProperty("aadharNumber");
    expect(json.user).not.toHaveProperty("panNumber");
    expect(JSON.stringify(json)).not.toContain("123412341234");
  });

  it("escapes submitted values in the confirmation email (R-10)", async () => {
    const body = payload({
      teamName: `<script>alert(1)</script>`,
      fullName: `Eve "<img src=x onerror=alert(1)>"`,
      linkedinUrl: "javascript:alert(1)",
    });
    expect((await register(body)).status).toBe(200);
    const html = capturedMailForTests[0].html;
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).not.toMatch(/href="\s*javascript:/i);
    for (const [, href] of html.matchAll(/href="([^"]*)"/g)) expect(href).toMatch(/^https?:\/\//);
  });

  it("creates a pending booking team bound to the leader registration (R-09)", async () => {
    const body = payload({ category: "student_innovator" });
    expect((await register(body)).status).toBe(200);
    const sql = await getDb();
    const [team] = await sql`
      select t.track, t.approval_status, t.team_name_snapshot, t.student_innovator_id = s.id as bound
        from booking.teams t
        join user_accounts u on u.id = t.leader_user_id
        join student_innovators s on s.user_id = u.id
       where u.email = ${body.email}`;
    expect(team).toEqual({ track: "junior", approval_status: "pending", team_name_snapshot: body.teamName, bound: true });
  });

  it("limits registrations per client address", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 31; i++) statuses.push((await register(payload(), "203.0.113.77")).status);
    expect(statuses.slice(0, 30).every((s) => s === 200)).toBe(true);
    expect(statuses[30]).toBe(429);
  });

  it("no longer exports an OPTIONS handler with wildcard CORS (R-12)", () => {
    expect((route as Record<string, unknown>).OPTIONS).toBeUndefined();
  });
});
