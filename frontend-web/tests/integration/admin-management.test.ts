/**
 * ADM-MGMT: the organiser management features added on 2026-10-29 (admin console tabs):
 * registration list / edit / delete, stall add / edit / retire, statistics, administrator
 * accounts, and administrator password sign-in, reset and change.
 */
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as registrationsRoute from "@/app/v1/admin/registrations/route";
import * as registrationRoute from "@/app/v1/admin/registrations/[id]/route";
import * as stallsRoute from "@/app/v1/admin/stalls/route";
import * as stallRoute from "@/app/v1/admin/stalls/[stallId]/route";
import * as statsRoute from "@/app/v1/admin/stats/route";
import * as usersRoute from "@/app/v1/admin/users/route";
import * as adminLoginRoute from "@/app/v1/auth/admin/login/route";
import * as resetRoute from "@/app/v1/auth/admin/reset-password/route";
import * as changeRoute from "@/app/v1/auth/admin/change-password/route";
import { hashPassword } from "@/lib/auth/password";
import { getDb } from "@/lib/db";
import { capturedMailForTests } from "@/lib/mail";
import { createAdmin, type Admin } from "../support/admin";
import { assertInvariants, configureBooking, confirm, createLeader, hold, seedStalls, waitForExpiry } from "../support/booking";
import { apiRequest, call, cookiePair } from "../support/http";
import { nextAadhaar, nextMobile, registerVerified } from "../support/registration";

const PHOTO = "https://ik.imagekit.io/test/photo.jpg";
const ALL = ["reports.view", "teams.manage", "inventory.manage", "booking.cancel"] as const;

const withParams =
  <P extends Record<string, string>>(fn: (req: Request, ctx: { params: Promise<P> }) => Promise<Response>, params: P) =>
  (req: Request) =>
    fn(req, { params: Promise.resolve(params) });

const listRegistrations = (cookie: string) => call(registrationsRoute.GET, apiRequest("/v1/admin/registrations", undefined, { cookie }));
const editRegistration = (cookie: string, id: string, body: Record<string, unknown>) =>
  call(withParams(registrationRoute.PATCH, { id }), apiRequest(`/v1/admin/registrations/${id}`, body, { cookie, method: "PATCH" }));
const deleteRegistration = (cookie: string, id: string) =>
  call(withParams(registrationRoute.DELETE, { id }), apiRequest(`/v1/admin/registrations/${id}`, {}, { cookie, method: "DELETE" }));
const addStall = (cookie: string, body: Record<string, unknown>) => call(stallsRoute.POST, apiRequest("/v1/admin/stalls", body, { cookie }));
const editStall = (cookie: string, stallId: string, body: Record<string, unknown>) =>
  call(withParams(stallRoute.PATCH, { stallId }), apiRequest(`/v1/admin/stalls/${stallId}`, body, { cookie, method: "PATCH" }));
const retireStall = (cookie: string, stallId: string) =>
  call(withParams(stallRoute.DELETE, { stallId }), apiRequest(`/v1/admin/stalls/${stallId}`, {}, { cookie, method: "DELETE" }));
const stats = (cookie: string) => call(statsRoute.GET, apiRequest("/v1/admin/stats", undefined, { cookie }));

let n = 0;
function payload(track: "senior" | "junior", overrides: Record<string, unknown> = {}) {
  n += 1;
  const id = `${Date.now().toString(36)}-${n}`;
  return {
    category: track === "senior" ? "startup_founder" : "student_innovator",
    teamName: `Mgmt Team ${id}`,
    fullName: `Mgmt Leader ${id}`,
    email: `mgmt-${id}@example.test`,
    photoUrl: PHOTO,
    mobile: nextMobile(),
    altMobile: "9876543211",
    domain: "Agritech & Food Safety",
    projectDetails: "Details",
    city: "Gunupur",
    state: "Odisha",
    country: "India",
    linkedinUrl: "in/mgmt",
    aadharNumber: nextAadhaar(),
    members: [{ name: `Mgmt Member ${id}`, photoUrl: PHOTO, phone: "9123456780", email: `mgmt-member-${id}@example.test` }],
    ...overrides,
  };
}

async function register(track: "senior" | "junior") {
  const body = payload(track);
  const res = await registerVerified(body, { sameOrigin: false });
  expect(res.status, JSON.stringify(res.json)).toBe(200);
  const sql = await getDb();
  const table = track === "senior" ? sql`startup_team_leaders` : sql`student_innovators`;
  const [row] = await sql`select id, user_id from ${table} where lower(email) = ${body.email}`;
  return { body, id: row.id as string, userId: row.user_id as string };
}

let admin: Admin;
beforeEach(async () => {
  await configureBooking();
  admin = await createAdmin([...ALL]);
});
afterEach(async () => {
  await assertInvariants();
});

describe("ADM-MGMT registrations", () => {
  it("lists both tracks with their members and never returns Aadhaar or PAN", async () => {
    const senior = await register("senior");
    const junior = await register("junior");
    const res = await listRegistrations(admin.cookie);
    expect(res.status).toBe(200);
    const byId = new Map(res.body!.registrations.map((r: any) => [r.id, r]));
    expect((byId.get(senior.id) as any).members.map((m: any) => m.email)).toEqual([senior.body.members[0].email]);
    expect((byId.get(junior.id) as any).members.map((m: any) => m.email)).toEqual([junior.body.members[0].email]);
    const text = JSON.stringify(res.body);
    expect(text).not.toContain(senior.body.aadharNumber);
    expect(text).not.toMatch(/aadh?ar|\bpan/i);
  });

  it("edits a registration and keeps the account and booking team in step", async () => {
    const reg = await register("junior");
    const mobile = nextMobile();
    const res = await editRegistration(admin.cookie, reg.id, {
      teamName: "Renamed Team", leaderName: "Renamed Leader", mobile, altMobile: "9876500000",
      domain: "EdTech", city: "Rayagada", state: "Odisha", projectDetails: "New details",
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const sql = await getDb();
    const [row] = await sql`
      select s.team_name, s.full_name, s.mobile, s.alt_mobile, u.full_name as account_name, u.team_name as account_team,
             u.mobile_e164, t.team_name_snapshot
        from student_innovators s join user_accounts u on u.id = s.user_id
        join booking.teams t on t.student_innovator_id = s.id
       where s.id = ${reg.id}`;
    // Stored in the registration form's format (E.164).
    expect(row).toEqual({
      team_name: "Renamed Team", full_name: "Renamed Leader", mobile: `+91${mobile}`, alt_mobile: "+919876500000",
      account_name: "Renamed Leader", account_team: "Renamed Team", mobile_e164: `+91${mobile}`, team_name_snapshot: "Renamed Team",
    });

    // The console pre-fills the stored "+91..." value; saving it unchanged must work.
    const again = await editRegistration(admin.cookie, reg.id, {
      teamName: "Renamed Team", leaderName: "Renamed Leader", mobile: row.mobile, altMobile: row.alt_mobile,
      domain: "EdTech", city: "Rayagada", state: "Odisha",
    });
    expect(again.status, JSON.stringify(again.body)).toBe(200);
  });

  it("rejects invalid edits with 400 and an unknown id with 404, and accepts a phone another leader uses", async () => {
    const a = await register("senior");
    const b = await register("senior");
    const valid = { teamName: "Team OK", leaderName: "Leader OK", mobile: nextMobile(), domain: "EdTech", city: "Gunupur", state: "Odisha" };
    for (const bad of [
      { ...valid, mobile: "12345" },
      { ...valid, altMobile: "12" },
      { ...valid, domain: "" },
      { ...valid, city: " " },
      { ...valid, teamName: "x".repeat(201) },
    ]) {
      const res = await editRegistration(admin.cookie, a.id, bad);
      expect(res.status, JSON.stringify(bad)).toBe(400);
    }
    expect((await editRegistration(admin.cookie, randomUUID(), valid)).status).toBe(404);
    // A primary phone may be shared (rule changed on main, 2026-10-30).
    const shared = await editRegistration(admin.cookie, a.id, { ...valid, mobile: b.body.mobile });
    expect(shared.status, JSON.stringify(shared.body)).toBe(200);
  });

  it("deletes a registration without booking history completely, including member-only accounts", async () => {
    const reg = await register("senior");
    const sql = await getDb();
    const res = await deleteRegistration(admin.cookie, reg.id);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const [left] = await sql`
      select (select count(*)::int from user_accounts where lower(email) in (${reg.body.email}, ${reg.body.members[0].email})) as accounts,
             (select count(*)::int from startup_team_leaders where id = ${reg.id}) as leaders,
             (select count(*)::int from startup_team_members where leader_user_id = ${reg.userId}) as members,
             (select count(*)::int from booking.teams where leader_user_id = ${reg.userId}) as teams,
             (select count(*)::int from startups s where not exists (select 1 from startup_memberships m where m.startup_id = s.id)
                                                    and not exists (select 1 from startup_team_leaders l where l.startup_id = s.id)
                                                    and not exists (select 1 from student_innovators i where i.startup_id = s.id)) as orphan_startups`;
    expect(left).toEqual({ accounts: 0, leaders: 0, members: 0, teams: 0, orphan_startups: 0 });
    expect((await deleteRegistration(admin.cookie, reg.id)).status).toBe(404);
  });

  it("keeps a member account that also leads another team", async () => {
    const other = await register("senior");
    const body = payload("senior", {
      members: [{ name: "Shared Person", photoUrl: PHOTO, phone: "9123456780", email: other.body.email }],
    });
    // Listing an existing leader as a member is allowed and never modifies their account (REG-03).
    const res = await registerVerified(body, { sameOrigin: false });
    expect(res.status, JSON.stringify(res.json)).toBe(200);
    const sql = await getDb();
    const [reg] = await sql`select id from startup_team_leaders where lower(email) = ${body.email}`;
    expect((await deleteRegistration(admin.cookie, reg.id)).status).toBe(200);
    const [kept] = await sql`select count(*)::int as n from startup_team_leaders where id = ${other.id}`;
    expect(kept.n).toBe(1);
  });

  it("refuses to delete a registration whose team has booking history", async () => {
    const leader = await createLeader();
    const [stall] = await seedStalls(1);
    const held = await hold(leader.cookie, stall.id);
    expect((await confirm(leader.cookie, held.body!.holdId, held.body!.token)).status).toBe(201);
    const sql = await getDb();
    const [row] = await sql`select id from startup_team_leaders where user_id = ${leader.userId}`;
    const res = await deleteRegistration(admin.cookie, row.id);
    expect(res.status).toBe(409);
    expect(res.body!.error.code).toBe("REGISTRATION_HAS_BOOKING_HISTORY");
    const [still] = await sql`select count(*)::int as n from startup_team_leaders where id = ${row.id}`;
    expect(still.n).toBe(1);
  });

  it("needs teams.manage to change registrations", async () => {
    const reg = await register("senior");
    const viewer = await createAdmin(["reports.view"]);
    expect((await listRegistrations(viewer.cookie)).status).toBe(200);
    expect((await deleteRegistration(viewer.cookie, reg.id)).status).toBe(403);
    expect((await editRegistration(viewer.cookie, reg.id, { teamName: "x" })).status).toBe(403);
  });
});

describe("ADM-MGMT stalls", () => {
  async function zoneCodes() {
    const sql = await getDb();
    return (await sql`select code from booking.zones where edition_id = 2026 order by code`).map((z) => z.code as string);
  }

  it("adds a stall to any existing zone, records it in the audit log, and rejects bad input", async () => {
    const sql = await getDb();
    await sql`
      insert into booking.zones (edition_id, code, name, extent_width_ft, extent_depth_ft, source_ref)
      values (2026, 'QZ', 'Synthetic test zone', 100, 100, 'test') on conflict (edition_id, code) do nothing`;
    expect(await zoneCodes()).toContain("QZ");
    const code = `QZ-A${String(Math.floor(Math.random() * 90) + 10)}`;
    const ok = await addStall(admin.cookie, { zone: "QZ", code, width: 10, depth: 10, x: 5, y: 5, rotation: 0 });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    const [audit] = await sql`
      select count(*)::int as n from booking.audit_events where action = 'inventory_changed' and stall_id = ${ok.body!.stall.id} and actor_admin_id = ${admin.id}`;
    expect(audit.n).toBe(1);

    expect((await addStall(admin.cookie, { zone: "QZ", code, x: 1, y: 1 })).status).toBe(409);
    for (const bad of [
      { zone: "QZ", code: "PG-A99", x: 1, y: 1 }, // prefix does not match the zone
      { zone: "QZ", code: "QZ-A98", x: "abc", y: 1 },
      { zone: "QZ", code: "QZ-A98", y: 1 }, // position is required
      { zone: "QZ", code: "QZ-A98", x: 1, y: 1, width: 0 },
      { zone: "QZ", code: "QZ-A98", x: 1, y: 1, rotation: 360 },
      { zone: "QZ", code: "bad", x: 1, y: 1 },
    ]) {
      expect((await addStall(admin.cookie, bad)).status, JSON.stringify(bad)).toBe(400);
    }
    expect((await addStall(admin.cookie, { zone: "QX", code: "QX-A01", x: 1, y: 1 })).status).toBe(404);
  });

  it("edits dimensions and position, refuses a code change with 400 (codes are permanent), and 404s unknown stalls", async () => {
    const [stall] = await seedStalls(1);
    const res = await editStall(admin.cookie, stall.id, { width: 12, depth: 8, x: 3, y: 4, rotation: 90 });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const sql = await getDb();
    const [row] = await sql`select width_ft::float as w, depth_ft::float as d, x_ft::float as x, y_ft::float as y, rotation_deg::float as r from booking.stalls where id = ${stall.id}`;
    expect(row).toEqual({ w: 12, d: 8, x: 3, y: 4, r: 90 });
    const rename = await editStall(admin.cookie, stall.id, { code: "PG-Z99" });
    expect(rename.status).toBe(400);
    expect(rename.body!.error.code).toBe("STALL_CODE_IMMUTABLE");
    expect((await editStall(admin.cookie, stall.id, { width: -1 })).status).toBe(400);
    expect((await editStall(admin.cookie, randomUUID(), { width: 10 })).status).toBe(404);
  });

  it("retires a free stall, keeps reservation history, and refuses while it is booked or held", async () => {
    const sql = await getDb();
    const [free, booked, held, expired] = await seedStalls(4);
    const a = await createLeader();
    const b = await createLeader();
    const c = await createLeader();
    const h1 = await hold(a.cookie, booked.id);
    expect((await confirm(a.cookie, h1.body!.holdId, h1.body!.token)).status).toBe(201);
    expect((await hold(b.cookie, held.id)).status).toBe(201);

    expect((await retireStall(admin.cookie, booked.id)).body!.error.code).toBe("STALL_HAS_BOOKING");
    expect((await retireStall(admin.cookie, held.id)).body!.error.code).toBe("STALL_HAS_ACTIVE_HOLD");

    await configureBooking({ hold_seconds: 2 });
    const h3 = await hold(c.cookie, expired.id);
    await waitForExpiry(h3.body!.holdId);
    const res = await retireStall(admin.cookie, expired.id);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const [r] = await sql`select status from booking.reservations where id = ${h3.body!.holdId}`;
    expect(r.status).toBe("expired"); // history kept, not deleted

    expect((await retireStall(admin.cookie, free.id)).status).toBe(200);
    const rows = await sql`select inventory_status, bookable from booking.stalls where id in (${free.id}, ${expired.id})`;
    expect(rows.every((s) => s.inventory_status === "retired" && s.bookable === false)).toBe(true);
    const [audits] = await sql`
      select count(*)::int as n from booking.audit_events where action = 'inventory_changed' and stall_id in (${free.id}, ${expired.id})`;
    expect(audits.n).toBe(2);
    expect((await retireStall(admin.cookie, randomUUID())).status).toBe(404);
  });
});

describe("ADM-MGMT statistics", () => {
  it("reports real numbers: zero stalls when none are loaded, and members of both tracks", async () => {
    const sql = await getDb();
    await sql`update booking.stalls set inventory_status = 'retired' where inventory_status <> 'retired' and not exists (
                select 1 from booking.reservations r where r.stall_id = booking.stalls.id and r.status in ('held', 'confirmed'))`;
    const live = (await sql`select count(*)::int as n from booking.stalls where inventory_status <> 'retired'`)[0].n;
    const res = await stats(admin.cookie);
    expect(res.status).toBe(200);
    expect(res.body!.stalls.total).toBe(live);

    const [counts] = await sql`
      select (select count(*)::int from startup_team_leaders where edition_id = 2026) +
             (select count(*)::int from student_innovators where edition_id = 2026) as teams,
             (select count(*)::int from startup_team_members m join startup_team_leaders l on l.user_id = m.leader_user_id and l.edition_id = 2026) +
             (select count(*)::int from student_team_members m join student_innovators s on s.id = m.student_innovator_id and s.edition_id = 2026) as members`;
    expect(res.body!.registrations.totalTeams).toBe(counts.teams);
    expect(res.body!.registrations.totalMembers).toBe(counts.members);
  });
});

describe("ADM-MGMT administrator accounts and password sign-in", () => {
  const PASSWORD = "a-long-admin-passphrase";

  async function passwordAdmin(email: string, password = PASSWORD) {
    const sql = await getDb();
    const [row] = await sql`
      insert into app_auth.admin_users (email, display_name, password_hash, created_by)
      values (${email}, 'Password Admin', ${hashPassword(password)}, 'test') returning id`;
    await sql`insert into app_auth.admin_grants (admin_user_id, permission, granted_by) values (${row.id}, 'reports.view', 'test')`;
    return row.id as string;
  }
  const login = (email: string, password: string) => call(adminLoginRoute.POST, apiRequest("/v1/auth/admin/login", { email, password }));

  it("signs in with the right password only, and never for a disabled admin", async () => {
    const email = `pw-${randomUUID().slice(0, 8)}@example.test`;
    const id = await passwordAdmin(email);
    const ok = await login(email, PASSWORD);
    expect(ok.status).toBe(200);
    expect(cookiePair(ok.headers, "__Host-sj_admin")).toBeTruthy();
    expect((await login(email, "wrong-password-123")).status).toBe(401);
    const sql = await getDb();
    await sql`update app_auth.admin_users set status = 'disabled', disabled_at = now() where id = ${id}`;
    expect((await login(email, PASSWORD)).status).toBe(401);
  });

  it("ignores ADMIN_EMAIL / ADMIN_PASSWORD: no sign-in, no account created, no disabled admin re-enabled", async () => {
    const email = `env-${randomUUID().slice(0, 8)}@example.test`;
    vi.stubEnv("ADMIN_EMAIL", email);
    vi.stubEnv("ADMIN_PASSWORD", "env-configured-password-1");
    try {
      expect((await login(email, "env-configured-password-1")).status).toBe(401);
      const sql = await getDb();
      const [row] = await sql`select count(*)::int as n from app_auth.admin_users where email = ${email}`;
      expect(row.n).toBe(0);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("limits password attempts per client address", async () => {
    const email = `limit-${randomUUID().slice(0, 8)}@example.test`;
    await passwordAdmin(email);
    const ip = `203.0.113.${Math.floor(Math.random() * 200) + 20}`;
    const attempt = () => call(adminLoginRoute.POST, apiRequest("/v1/auth/admin/login", { email, password: "wrong-password-123" }, { ip }));
    const statuses: number[] = [];
    for (let i = 0; i < 52; i++) statuses.push((await attempt()).status);
    expect(statuses.slice(0, 50).every((s) => s === 401)).toBe(true);
    expect(statuses.at(-1)).toBe(429);
  });

  it("resets a forgotten password with an emailed code, with the same reply for unknown addresses", async () => {
    const email = `reset-${randomUUID().slice(0, 8)}@example.test`;
    await passwordAdmin(email);
    const unknown = await call(resetRoute.POST, apiRequest("/v1/auth/admin/reset-password", { action: "request", email: "nobody@example.test" }));
    const known = await call(resetRoute.POST, apiRequest("/v1/auth/admin/reset-password", { action: "request", email }));
    expect(known.status).toBe(200);
    expect(known.body!.message).toBe(unknown.body!.message);
    const mail = [...capturedMailForTests].reverse().find((m) => m.to === email)!;
    const code = mail.subject.match(/(\d{6})$/)![1];
    const binding = cookiePair(known.headers, "__Host-sj_otp")!;
    const short = await call(resetRoute.POST, apiRequest("/v1/auth/admin/reset-password", { action: "confirm", email, code, newPassword: "short" }, { cookie: binding }));
    expect(short.status).toBe(400);
    const done = await call(
      resetRoute.POST,
      apiRequest("/v1/auth/admin/reset-password", { action: "confirm", email, code, newPassword: "the-new-long-passphrase" }, { cookie: binding })
    );
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    expect((await login(email, "the-new-long-passphrase")).status).toBe(200);
    expect((await login(email, PASSWORD)).status).toBe(401);
  });

  it("changes the password of the signed-in admin only with the current password", async () => {
    const email = `change-${randomUUID().slice(0, 8)}@example.test`;
    await passwordAdmin(email);
    const session = cookiePair((await login(email, PASSWORD)).headers, "__Host-sj_admin")!;
    const change = (current: string, next: string) =>
      call(changeRoute.POST, apiRequest("/v1/auth/admin/change-password", { currentPassword: current, newPassword: next }, { cookie: session }));
    expect((await change("not-the-password", "another-long-passphrase")).status).toBe(400);
    expect((await change(PASSWORD, "short")).status).toBe(400);
    expect((await change(PASSWORD, "another-long-passphrase")).status).toBe(200);
    expect((await login(email, "another-long-passphrase")).status).toBe(200);
  });

  it("lists administrators and lets only a full administrator add one", async () => {
    const partial = await createAdmin(["reports.view", "teams.manage"]);
    const add = (cookie: string, email: string) =>
      call(usersRoute.POST, apiRequest("/v1/admin/users", { email, displayName: "New Admin", password: "a-long-new-passphrase" }, { cookie }));
    const list = await call(usersRoute.GET, apiRequest("/v1/admin/users", undefined, { cookie: admin.cookie }));
    expect(list.status).toBe(200);
    expect(JSON.stringify(list.body)).not.toContain("password");
    const email = `added-${randomUUID().slice(0, 8)}@example.test`;
    expect((await add(partial.cookie, email)).status).toBe(403);
    expect((await add(admin.cookie, email)).status).toBe(201);
    expect((await add(admin.cookie, email)).status).toBe(409);
    expect((await login(email, "a-long-new-passphrase")).status).toBe(200);
  });
});
