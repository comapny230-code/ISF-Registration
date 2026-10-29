/**
 * SCH tests for migration 0006: registration data in public is closed to the Supabase
 * Data API (row-level security on, no grants to PUBLIC/anon/authenticated) while the
 * application, as table owner, keeps working.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { getDb } from "@/lib/db";

const root = path.resolve(__dirname, "../../../database");
const migration = readFileSync(path.join(root, "migrations/0006_public_tables_rls.sql"), "utf8");
const verify = readFileSync(path.join(root, "verify/002_registration_data_exposure.sql"), "utf8");

const SENSITIVE = ["user_accounts", "startup_team_leaders", "student_innovators", "startup_team_members", "student_team_members"];

async function publicTables() {
  const sql = await getDb();
  return sql`
    select c.relname, c.relrowsecurity as rls, c.relforcerowsecurity as forced,
           exists (select 1 from aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a where a.grantee = 0) as public_grant
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind in ('r', 'p')
     order by c.relname`;
}

describe("0006 public tables are closed to the Data API", () => {
  it("enables (not forced) row-level security on every public table, including those holding Aadhaar and PAN", async () => {
    const tables = await publicTables();
    expect(tables.map((t) => t.relname)).toEqual(expect.arrayContaining(SENSITIVE));
    for (const t of tables) {
      expect({ table: t.relname, rls: t.rls, forced: t.forced, publicGrant: t.public_grant }).toEqual({
        table: t.relname,
        rls: true,
        forced: false,
        publicGrant: false,
      });
    }
  });

  it("re-running the migration removes a privilege granted to PUBLIC afterwards", async () => {
    const sql = await getDb();
    await sql`grant select on public.user_accounts to public`;
    expect((await publicTables()).find((t) => t.relname === "user_accounts")!.public_grant).toBe(true);

    await sql.unsafe(migration);
    expect((await publicTables()).find((t) => t.relname === "user_accounts")!.public_grant).toBe(false);
  });

  it("the application, as owner, still reads and writes registration rows", async () => {
    const sql = await getDb();
    const [u] = await sql`insert into user_accounts (email, full_name) values ('rls-owner@example.test', 'Owner check') returning id`;
    const [row] = await sql`select full_name from user_accounts where id = ${u.id}`;
    expect(row.full_name).toBe("Owner check");
  });

  it("the launch-gate verification query reports every check as passing", async () => {
    const sql = await getDb();
    const rows = await sql.unsafe(verify);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.filter((r) => !r.ok)).toEqual([]);
  });
});
