/** SCH tests for migration 0003 (identity and auth tables, booking.teams trigger). */
import { describe, expect, it } from "vitest";
import { getDb } from "@/lib/db";

async function seedLeader(email: string) {
  const sql = await getDb();
  const [user] = await sql`insert into user_accounts (email, full_name) values (${email}, 'Leader') returning id`;
  const [leader] = await sql`
    insert into startup_team_leaders (user_id, team_name, full_name, email, mobile, alt_mobile, domain, city, state, linkedin_url, edition_id)
    values (${user.id}, 'Team', 'Leader', ${email}, '1', '2', 'd', 'c', 's', 'l', 2026) returning id`;
  return { userId: user.id as string, leaderId: leader.id as string };
}

describe("booking.teams constraints and trigger", () => {
  it("rejects a team whose leader does not match the registration row (BK008)", async () => {
    const sql = await getDb();
    const a = await seedLeader("schema-a@example.test");
    const b = await seedLeader("schema-b@example.test");
    await expect(
      sql`insert into booking.teams (edition_id, leader_user_id, track, startup_team_leader_id, team_name_snapshot)
          values (2026, ${a.userId}, 'senior', ${b.leaderId}, 'Wrong')`
    ).rejects.toMatchObject({ code: "BK008" });
  });

  it("rejects a team for another edition than its registration row (BK008)", async () => {
    const sql = await getDb();
    await sql`insert into event_editions (id, name) values (2027, 'Next') on conflict do nothing`;
    const a = await seedLeader("schema-c@example.test");
    await expect(
      sql`insert into booking.teams (edition_id, leader_user_id, track, startup_team_leader_id, team_name_snapshot)
          values (2027, ${a.userId}, 'senior', ${a.leaderId}, 'T')`
    ).rejects.toMatchObject({ code: "BK008" });
  });

  it("keeps identity columns immutable (BK003) while allowing approval changes", async () => {
    const sql = await getDb();
    const a = await seedLeader("schema-d@example.test");
    const [team] = await sql`
      insert into booking.teams (edition_id, leader_user_id, track, startup_team_leader_id, team_name_snapshot)
      values (2026, ${a.userId}, 'senior', ${a.leaderId}, 'T') returning id`;
    const other = await seedLeader("schema-e@example.test");
    await expect(sql`update booking.teams set leader_user_id = ${other.userId} where id = ${team.id}`).rejects.toMatchObject({
      code: "BK003",
    });
    const [admin] = await sql`insert into app_auth.admin_users (email, display_name, created_by) values ('a-schema@example.test', 'A', 'test') returning id`;
    await sql`update booking.teams set approval_status = 'approved', approval_changed_at = now(), approval_changed_by = ${admin.id} where id = ${team.id}`;
    const [updated] = await sql`select approval_status from booking.teams where id = ${team.id}`;
    expect(updated.approval_status).toBe("approved");
    await expect(
      sql`update booking.teams set approval_changed_by = null where id = ${team.id}` // who/when must be recorded together
    ).rejects.toMatchObject({ code: "23514" });
  });

  it("enforces one team per leader per edition and requires the track's source column", async () => {
    const sql = await getDb();
    const a = await seedLeader("schema-f@example.test");
    await sql`insert into booking.teams (edition_id, leader_user_id, track, startup_team_leader_id, team_name_snapshot)
              values (2026, ${a.userId}, 'senior', ${a.leaderId}, 'T')`;
    await expect(
      sql`insert into booking.teams (edition_id, leader_user_id, track, startup_team_leader_id, team_name_snapshot)
          values (2026, ${a.userId}, 'senior', ${a.leaderId}, 'T')`
    ).rejects.toMatchObject({ code: "23505" });
    // A junior team pointing at a senior registration row: the BEFORE trigger rejects it
    // before the track/source CHECK is evaluated.
    await expect(
      sql`insert into booking.teams (edition_id, leader_user_id, track, startup_team_leader_id, team_name_snapshot)
          values (2026, ${a.userId}, 'junior', ${a.leaderId}, 'T')`
    ).rejects.toMatchObject({ code: "BK008" });
  });

  it("prevents deleting a user who leads a booking team (RESTRICT)", async () => {
    const sql = await getDb();
    const a = await seedLeader("schema-g@example.test");
    await sql`insert into booking.teams (edition_id, leader_user_id, track, startup_team_leader_id, team_name_snapshot)
              values (2026, ${a.userId}, 'senior', ${a.leaderId}, 'T')`;
    await expect(sql`delete from user_accounts where id = ${a.userId}`).rejects.toMatchObject({ code: "23503" });
  });
});

describe("app_auth constraints", () => {
  it("allows one active grant per permission, and grants again after revocation", async () => {
    const sql = await getDb();
    const [admin] = await sql`insert into app_auth.admin_users (email, display_name, created_by) values ('grants@example.test', 'G', 'test') returning id`;
    await sql`insert into app_auth.admin_grants (admin_user_id, permission, granted_by) values (${admin.id}, 'booking.cancel', 'test')`;
    await expect(
      sql`insert into app_auth.admin_grants (admin_user_id, permission, granted_by) values (${admin.id}, 'booking.cancel', 'test')`
    ).rejects.toMatchObject({ code: "23505" });
    await sql`update app_auth.admin_grants set revoked_at = now(), revoked_by = 'test' where admin_user_id = ${admin.id}`;
    await sql`insert into app_auth.admin_grants (admin_user_id, permission, granted_by) values (${admin.id}, 'booking.cancel', 'test')`;
    await expect(
      sql`insert into app_auth.admin_grants (admin_user_id, permission, granted_by) values (${admin.id}, 'superuser', 'test')`
    ).rejects.toMatchObject({ code: "23514" });
  });

  it("rejects mixed principals and over-long challenge lifetimes", async () => {
    const sql = await getDb();
    const a = await seedLeader("principal@example.test");
    await expect(
      sql`insert into app_auth.sessions (token_hash, principal_type, user_id, idle_expires_at, absolute_expires_at)
          values ('\\x00', 'admin', ${a.userId}, now() + interval '1 hour', now() + interval '2 hours')`
    ).rejects.toMatchObject({ code: "23514" });
    await expect(
      sql`insert into app_auth.login_challenges (id, audience, email, user_id, code_mac, expires_at)
          values (gen_random_uuid(), 'leader', 'principal@example.test', ${a.userId}, '\\x00', now() + interval '1 hour')`
    ).rejects.toMatchObject({ code: "23514" });
  });
});
