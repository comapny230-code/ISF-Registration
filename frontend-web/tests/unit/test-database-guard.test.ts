import { describe, expect, it } from "vitest";
import {
  assertTestDatabasePostConnect,
  assertTestEnvironmentPreConnect,
  TestDatabaseGuardError,
  type ReadOnlyQuery,
} from "@/lib/safety/test-database-guard";

const GOOD_URL = "postgresql://isf_test:isf_test@localhost:54329/isf_test_w1";
const baseEnv = {
  APP_ENV: "test",
  NODE_ENV: "test",
  PRODUCTION_DB_DENYLIST: "prodref123",
  TEST_DATABASE_URL: GOOD_URL,
};

describe("GUARD-01 pre-connect checks (no network)", () => {
  it("accepts a local isf_test database", () => {
    expect(assertTestEnvironmentPreConnect(baseEnv)).toEqual({ url: GOOD_URL, database: "isf_test_w1" });
  });

  const rejected: Array<[string, Record<string, string | undefined>]> = [
    ["APP_ENV not test", { APP_ENV: "local" }],
    ["NODE_ENV not test", { NODE_ENV: "production" }],
    ["DATABASE_URL present", { DATABASE_URL: "postgresql://x@localhost/isf_test" }],
    ["SMTP_PASS present", { SMTP_PASS: "x" }],
    ["IMAGEKIT_PRIVATE_KEY present", { IMAGEKIT_PRIVATE_KEY: "x" }],
    ["IMAGEKIT_PUBLIC_KEY present", { IMAGEKIT_PUBLIC_KEY: "x" }],
    ["missing TEST_DATABASE_URL", { TEST_DATABASE_URL: undefined }],
    ["unparseable URL", { TEST_DATABASE_URL: "not a url" }],
    ["wrong scheme", { TEST_DATABASE_URL: "mysql://isf_test@localhost/isf_test" }],
    ["supabase pooler host", { TEST_DATABASE_URL: "postgresql://isf_test:x@aws-0-ap-southeast-1.pooler.supabase.com:6543/isf_test" }],
    ["supabase direct host", { TEST_DATABASE_URL: "postgresql://isf_test:x@db.abc.supabase.co:5432/isf_test" }],
    ["arbitrary dotted host", { TEST_DATABASE_URL: "postgresql://isf_test:x@db.example.com/isf_test" }],
    ["non-loopback IP", { TEST_DATABASE_URL: "postgresql://isf_test:x@10.0.0.5/isf_test" }],
    ["unlisted service name", { TEST_DATABASE_URL: "postgresql://isf_test:x@postgres-test/isf_test" }],
    ["denylisted identifier", { TEST_DATABASE_URL: "postgresql://isf_test:x@localhost/isf_test_prodref123" }],
    ["missing denylist", { PRODUCTION_DB_DENYLIST: undefined }],
    ["wrong user (postgres)", { TEST_DATABASE_URL: "postgresql://postgres:x@localhost/isf_test" }],
    ["database 'postgres'", { TEST_DATABASE_URL: "postgresql://isf_test:x@localhost/postgres" }],
    ["database with bad suffix", { TEST_DATABASE_URL: "postgresql://isf_test:x@localhost/isf_test_PROD" }],
    ["dotted allowed host", { TEST_DB_ALLOWED_HOSTS: "db.internal", TEST_DATABASE_URL: "postgresql://isf_test:x@db.internal/isf_test" }],
  ];

  for (const [label, override] of rejected) {
    it(`rejects: ${label}`, () => {
      expect(() => assertTestEnvironmentPreConnect({ ...baseEnv, ...override })).toThrow(TestDatabaseGuardError);
    });
  }

  it("accepts an explicitly allowed single-label CI service host", () => {
    const env = {
      ...baseEnv,
      TEST_DB_ALLOWED_HOSTS: "postgres-test",
      TEST_DATABASE_URL: "postgresql://isf_test:x@postgres-test:5432/isf_test",
    };
    expect(assertTestEnvironmentPreConnect(env).database).toBe("isf_test");
  });
});

/** Fake server answering the guard's read-only queries. */
function fakeServer(overrides: Partial<{
  database: string;
  username: string;
  cluster: string;
  markerTable: boolean;
  marker: string | undefined;
  accountsTable: boolean;
  foreignEmails: number;
}> = {}): ReadOnlyQuery {
  const s = {
    database: "isf_test_w1",
    username: "isf_test",
    cluster: "isf-test",
    markerTable: true,
    marker: "ISF-TEST-DATABASE-v1" as string | undefined,
    accountsTable: true,
    foreignEmails: 0,
    ...overrides,
  };
  return async (text) => {
    if (text.includes("current_database()")) {
      return [{ database: s.database, username: s.username, cluster_name: s.cluster }];
    }
    if (text.includes("to_regclass('isf_test_guard.marker')")) return [{ present: s.markerTable }];
    if (text.includes("from isf_test_guard.marker")) return s.marker === undefined ? [] : [{ value: s.marker }];
    if (text.includes("to_regclass('public.user_accounts')")) return [{ present: s.accountsTable }];
    if (text.includes("from public.user_accounts")) return [{ n: s.foreignEmails }];
    throw new Error(`unexpected query: ${text}`);
  };
}

describe("GUARD-01/02 post-connect checks", () => {
  it("accepts a marked, populated test database", async () => {
    await expect(assertTestDatabasePostConnect(fakeServer(), "isf_test_w1")).resolves.toBeUndefined();
  });

  it("accepts a database before registration tables exist", async () => {
    await expect(
      assertTestDatabasePostConnect(fakeServer({ accountsTable: false }), "isf_test_w1")
    ).resolves.toBeUndefined();
  });

  const rejected: Array<[string, Parameters<typeof fakeServer>[0]]> = [
    ["cluster_name is not isf-test (e.g. a hosted server)", { cluster: "" }],
    ["connected as another role", { username: "postgres" }],
    ["connected to an unexpected database", { database: "isf_test_w2" }],
    ["marker table missing", { markerTable: false }],
    ["marker row missing", { marker: undefined }],
    ["marker value wrong", { marker: "something-else" }],
    ["non-fixture email addresses present (restored production data)", { foreignEmails: 3 }],
  ];
  for (const [label, override] of rejected) {
    it(`rejects: ${label}`, async () => {
      await expect(assertTestDatabasePostConnect(fakeServer(override), "isf_test_w1")).rejects.toThrow(
        TestDatabaseGuardError
      );
    });
  }
});
