/**
 * ADMIN-CLI: scripts/create-admin.mts (npm run db:create-admin). Runs the real script against the
 * test database: the password comes only from ADMIN_BOOTSTRAP_PASSWORD, is at least 12 characters,
 * and resetting an existing (even disabled) admin re-enables it and revokes its sessions.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { verifyPassword } from "@/lib/auth/password";
import { getDb } from "@/lib/db";

const root = path.resolve(__dirname, "../..");
const EMAIL = "cli-admin@example.test";
const GOOD = "correct-horse-battery-1";

function createAdmin(args: string[], password?: string) {
  const res = spawnSync(
    process.execPath,
    ["--experimental-transform-types", "--no-warnings", "--import", "./scripts/node-ts-hooks.mjs", "scripts/create-admin.mts", ...args],
    { cwd: root, encoding: "utf8", env: { ...process.env, ADMIN_BOOTSTRAP_PASSWORD: password ?? "" } }
  );
  return { code: res.status, out: `${res.stdout}${res.stderr}` };
}

async function admin() {
  const sql = await getDb();
  const [row] = await sql`
    select a.id, a.status, a.disabled_at, a.password_hash, a.display_name,
           (select count(*)::int from app_auth.admin_grants g where g.admin_user_id = a.id and g.revoked_at is null) as grants
      from app_auth.admin_users a where a.email = ${EMAIL}`;
  return row;
}

afterAll(async () => {
  const sql = await getDb();
  await sql`delete from app_auth.sessions where admin_user_id in (select id from app_auth.admin_users where email = ${EMAIL})`;
  await sql`delete from app_auth.admin_grants where admin_user_id in (select id from app_auth.admin_users where email = ${EMAIL})`;
  await sql`delete from app_auth.admin_users where email = ${EMAIL}`;
});

describe("ADMIN-CLI create-admin script", () => {
  it("refuses a password on the command line, a short password, and a missing email", () => {
    expect(createAdmin([EMAIL, "Name", GOOD], GOOD).out).toMatch(/Do not pass the password as an argument/);
    expect(createAdmin([EMAIL], "short-pass").out).toMatch(/at least 12 characters/);
    expect(createAdmin([], GOOD).out).toMatch(/Usage:/);
  });

  it("creates an active admin with all four permissions and a working password", async () => {
    const res = createAdmin([EMAIL, "CLI Admin"], GOOD);
    expect(res.code, res.out).toBe(0);
    const row = await admin();
    expect(row).toMatchObject({ status: "active", disabled_at: null, display_name: "CLI Admin", grants: 4 });
    expect(verifyPassword(GOOD, row.password_hash)).toBe(true);
    expect(res.out).not.toContain(GOOD);
  });

  it("re-enables a disabled admin, sets the new password and revokes old sessions", async () => {
    const sql = await getDb();
    const before = await admin();
    await sql`update app_auth.admin_users set status = 'disabled', disabled_at = now() where id = ${before.id}`;
    await sql`
      insert into app_auth.sessions (principal_type, admin_user_id, token_hash, idle_expires_at, absolute_expires_at)
      values ('admin', ${before.id}, ${Buffer.alloc(32, 7)}, now() + interval '1 hour', now() + interval '8 hours')`;

    const res = createAdmin([EMAIL, "CLI Admin"], "another-long-passphrase");
    expect(res.code, res.out).toBe(0);
    const after = await admin();
    expect(after).toMatchObject({ status: "active", disabled_at: null });
    expect(verifyPassword("another-long-passphrase", after.password_hash)).toBe(true);
    expect(verifyPassword(GOOD, after.password_hash)).toBe(false);
    const [live] = await sql`select count(*)::int as n from app_auth.sessions where admin_user_id = ${before.id} and revoked_at is null`;
    expect(live.n).toBe(0);
  });
});
