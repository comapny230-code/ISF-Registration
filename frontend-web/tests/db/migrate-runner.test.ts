/** MIG-01: the migration runner (scripts/migrate.mts), executed as a real child process. */
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import path from "node:path";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { baseTestDatabaseUrl, dropDatabaseBestEffort, MARKER_SQL, withDatabase } from "../support/test-db-urls";

const script = path.resolve(__dirname, "../../scripts/migrate.mts");
const database = `isf_test_mig${randomBytes(4).toString("hex")}`;
let url = "";

function migrate(args: string[], env: Record<string, string | undefined> = {}) {
  const result = spawnSync(process.execPath, [script, ...args], {
    encoding: "utf8",
    env: {
      PATH: process.env.PATH,
      SystemRoot: process.env.SystemRoot,
      APP_ENV: "test",
      NODE_ENV: "test",
      PRODUCTION_DB_DENYLIST: "ddrremsyzozutyxbxigf",
      MIGRATION_DATABASE_URL: url,
      MIGRATION_OPERATOR: "vitest",
      ...env,
    },
  });
  return { code: result.status, out: `${result.stdout}${result.stderr}` };
}

async function withDb<T>(fn: (sql: postgres.Sql) => Promise<T>): Promise<T> {
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    return await fn(sql);
  } finally {
    await sql.end();
  }
}

beforeAll(async () => {
  const admin = postgres(baseTestDatabaseUrl(), { max: 1, onnotice: () => {} });
  try {
    await admin.unsafe(`create database ${database}`);
  } finally {
    await admin.end();
  }
  url = withDatabase(baseTestDatabaseUrl(), database);
  await withDb((sql) => sql.unsafe(MARKER_SQL));
});

afterAll(async () => {
  await dropDatabaseBestEffort(baseTestDatabaseUrl(), database);
});

describe("migration runner", () => {
  it("dry-run lists pending migrations without changing anything", async () => {
    const res = migrate(["apply", "--target", "test", "--dry-run"]);
    expect(res.code).toBe(0);
    expect(res.out).toMatch(/would apply 0001_registration_init\.sql/);
    expect(res.out).toMatch(/would apply 0005_booking_settings_and_team_backfill\.sql/);
    expect(res.out).toMatch(/would apply 0006_public_tables_rls\.sql/);
    expect(res.out).toMatch(/would apply 0007_login_challenge_binding\.sql/);
    expect(res.out).toMatch(/would apply 0008_registration_email_verification\.sql/);
    expect(res.out).toMatch(/would apply 0009_public_functions_execute\.sql/);
    expect(await withDb(async (sql) => (await sql`select to_regclass('booking.reservations') as t`)[0].t)).toBeNull();
  });

  it("applies every migration once, records checksums, and is a no-op the second time", async () => {
    const first = migrate(["apply", "--target", "test"]);
    expect(first.code, first.out).toBe(0);
    expect(first.out.match(/^applied /gm)).toHaveLength(9);
    const second = migrate(["apply", "--target", "test"]);
    expect(second.out).toMatch(/nothing to apply/);
    const rows = await withDb((sql) => sql`select version, applied_by, length(sha256) as len from public.schema_migrations order by version`);
    expect(rows.map((r) => r.version)).toEqual(["0001", "0002", "0003", "0004", "0005", "0006", "0007", "0008", "0009"]);
    expect(rows.every((r) => r.applied_by === "vitest" && r.len === 64)).toBe(true);
    expect(migrate(["status", "--target", "test"]).out).not.toMatch(/pending|CHANGED/);
  });

  it("verification passes on a correct schema and fails when a guard trigger is missing", async () => {
    const ok = migrate(["verify", "--target", "test"]);
    expect(ok.code, ok.out).toBe(0);
    expect(ok.out).toMatch(/verification passed/);
    await withDb((sql) => sql`alter table booking.reservations disable trigger reservations_guard`);
    await withDb((sql) => sql`drop trigger reservations_guard on booking.reservations`);
    const broken = migrate(["verify", "--target", "test"]);
    expect(broken.code).toBe(1);
    expect(broken.out).toMatch(/FAIL {2}trigger reservations_guard/);
  });

  it("stops when an applied migration's content no longer matches its recorded checksum", async () => {
    await withDb((sql) => sql`update public.schema_migrations set sha256 = repeat('0', 64) where version = '0003'`);
    const res = migrate(["apply", "--target", "test"]);
    expect(res.code).toBe(1);
    expect(res.out).toMatch(/0003_identity_and_auth\.sql changed after it was applied/);
    expect(migrate(["status", "--target", "test"]).out).toMatch(/0003_identity_and_auth\.sql {2}CHANGED SINCE APPLIED/);
  });

  it("baseline marks existing migrations as applied without executing them", async () => {
    const other = `isf_test_mig${randomBytes(4).toString("hex")}`;
    const admin = postgres(baseTestDatabaseUrl(), { max: 1, onnotice: () => {} });
    await admin.unsafe(`create database ${other}`);
    await admin.end();
    const otherUrl = withDatabase(baseTestDatabaseUrl(), other);
    const sql = postgres(otherUrl, { max: 1, onnotice: () => {} });
    try {
      await sql.unsafe(MARKER_SQL);
      const res = migrate(["baseline", "--target", "test", "--version", "0001"], { MIGRATION_DATABASE_URL: otherUrl });
      expect(res.code, res.out).toBe(0);
      expect(res.out).toMatch(/baselined 0001_registration_init\.sql \(not executed\)/);
      const [row] = await sql`select count(*)::int as n, (select to_regclass('public.user_accounts')) as t from public.schema_migrations`;
      expect(row).toEqual({ n: 1, t: null });
    } finally {
      await sql.end();
      await dropDatabaseBestEffort(baseTestDatabaseUrl(), other);
    }
  });

  it.each([
    ["the transaction pooler port", { MIGRATION_DATABASE_URL: "postgresql://isf_test:x@localhost:6543/isf_test" }, ["apply", "--target", "test"], /transaction pooler/],
    ["a target that does not match APP_ENV", {}, ["apply", "--target", "local"], /does not match APP_ENV/],
    ["DATABASE_URL instead of MIGRATION_DATABASE_URL", { MIGRATION_DATABASE_URL: undefined, DATABASE_URL: "postgresql://isf_test:x@localhost/isf_test" }, ["status", "--target", "test"], /MIGRATION_DATABASE_URL is required/],
    ["a production-denylisted database", { MIGRATION_DATABASE_URL: "postgresql://u:x@db.ddrremsyzozutyxbxigf.supabase.co:5432/postgres", APP_ENV: "staging" }, ["status", "--target", "staging"], /production denylist/],
    ["staging without a TLS CA", { MIGRATION_DATABASE_URL: "postgresql://u:x@staging.example.org:5432/postgres", APP_ENV: "staging" }, ["status", "--target", "staging"], /MIGRATION_CA_CERT/],
    ["production without explicit confirmation", { MIGRATION_DATABASE_URL: "postgresql://u:x@prod.example.org:5432/postgres", APP_ENV: "production", MIGRATION_CA_CERT: "x" }, ["apply", "--target", "production"], /--confirm-production prod\.example\.org/],
    ["a non-test database name under --target test", { MIGRATION_DATABASE_URL: "postgresql://isf_test:x@localhost:54329/postgres" }, ["status", "--target", "test"], /database name/],
  ])("refuses %s before connecting", (_label, env, args, message) => {
    const res = migrate(args as string[], env as Record<string, string | undefined>);
    expect(res.code).toBe(2);
    expect(res.out).toMatch(message as RegExp);
  });
});
