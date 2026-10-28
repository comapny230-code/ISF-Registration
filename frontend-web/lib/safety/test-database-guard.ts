/**
 * Fail-closed guard for test databases (docs/STALL_BOOKING_FINAL_SPEC.md §9.4).
 *
 * Used by the test harness and by the app itself when APP_ENV=test. It never
 * falls back to DATABASE_URL and refuses any target that cannot be shown to be
 * a disposable local test database before the first write.
 */

export const TEST_DB_USER = "isf_test";
export const TEST_DB_NAME_PATTERN = /^isf_test(_[a-z0-9]{1,32})?$/;
export const TEST_CLUSTER_NAME = "isf-test";
export const TEST_MARKER_KEY = "isf-test-db";
export const TEST_MARKER_VALUE = "ISF-TEST-DATABASE-v1";
export const TEST_FIXTURE_EMAIL_DOMAIN = "@example.test";

/** Variables that must never be present while tests run. */
export const FORBIDDEN_TEST_VARIABLES = [
  "DATABASE_URL",
  "SMTP_PASS",
  "IMAGEKIT_PRIVATE_KEY",
  "IMAGEKIT_PUBLIC_KEY",
] as const;

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
const HOSTED_PROVIDER_PATTERN = /supabase|pooler|amazonaws|azure|neon|render/i;

export class TestDatabaseGuardError extends Error {
  constructor(message: string) {
    super(`[test-database-guard] ${message}`);
    this.name = "TestDatabaseGuardError";
  }
}

export interface GuardedTestDatabase {
  url: string;
  database: string;
}

type Env = Record<string, string | undefined>;

function splitList(value: string | undefined): string[] {
  return (value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

/**
 * Checks that need no network access. Throws before any client is created.
 */
export function assertTestEnvironmentPreConnect(env: Env = process.env): GuardedTestDatabase {
  if (env.APP_ENV !== "test") {
    throw new TestDatabaseGuardError("APP_ENV must be 'test'.");
  }
  if (env.NODE_ENV !== "test") {
    throw new TestDatabaseGuardError("NODE_ENV must be 'test'.");
  }

  const present = FORBIDDEN_TEST_VARIABLES.filter((name) => env[name] !== undefined && env[name] !== "");
  if (present.length > 0) {
    throw new TestDatabaseGuardError(`These variables must be unset while testing: ${present.join(", ")}.`);
  }

  const raw = env.TEST_DATABASE_URL;
  if (!raw) {
    throw new TestDatabaseGuardError("TEST_DATABASE_URL is required.");
  }

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new TestDatabaseGuardError("TEST_DATABASE_URL is not a valid URL.");
  }

  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    throw new TestDatabaseGuardError("TEST_DATABASE_URL must use the postgres:// or postgresql:// scheme.");
  }

  const host = parsed.hostname.toLowerCase();
  const allowedServiceHosts = new Set(splitList(env.TEST_DB_ALLOWED_HOSTS).map((h) => h.toLowerCase()));
  for (const serviceHost of allowedServiceHosts) {
    if (serviceHost.includes(".")) {
      throw new TestDatabaseGuardError("TEST_DB_ALLOWED_HOSTS may only contain single-label service names.");
    }
  }
  if (HOSTED_PROVIDER_PATTERN.test(host)) {
    throw new TestDatabaseGuardError("TEST_DATABASE_URL points at a hosted database provider.");
  }
  if (!LOOPBACK_HOSTS.has(host) && !allowedServiceHosts.has(host)) {
    throw new TestDatabaseGuardError("TEST_DATABASE_URL host must be loopback or an allowed single-label service name.");
  }

  const denylist = splitList(env.PRODUCTION_DB_DENYLIST);
  if (denylist.length === 0) {
    throw new TestDatabaseGuardError("PRODUCTION_DB_DENYLIST is required.");
  }
  const lowered = raw.toLowerCase();
  if (denylist.some((entry) => lowered.includes(entry.toLowerCase()))) {
    throw new TestDatabaseGuardError("TEST_DATABASE_URL matches PRODUCTION_DB_DENYLIST.");
  }

  if (decodeURIComponent(parsed.username) !== TEST_DB_USER) {
    throw new TestDatabaseGuardError(`TEST_DATABASE_URL must authenticate as '${TEST_DB_USER}'.`);
  }

  const database = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  if (!TEST_DB_NAME_PATTERN.test(database)) {
    throw new TestDatabaseGuardError("TEST_DATABASE_URL database name must match isf_test or isf_test_<suffix>.");
  }

  return { url: raw, database };
}

/** Runs one read-only SQL statement and returns its rows. */
export type ReadOnlyQuery = (text: string) => Promise<ReadonlyArray<Record<string, unknown>>>;

/**
 * Read-only checks against the connected server. Must pass before the first write.
 * A populated test database is allowed; production data is detected by its email domains.
 */
export async function assertTestDatabasePostConnect(query: ReadOnlyQuery, expectedDatabase: string): Promise<void> {
  const [identity] = await query(
    "select current_database() as database, current_user as username, current_setting('cluster_name') as cluster_name"
  );
  if (!identity) {
    throw new TestDatabaseGuardError("Could not read server identity.");
  }
  if (identity.cluster_name !== TEST_CLUSTER_NAME) {
    throw new TestDatabaseGuardError(`Server cluster_name must be '${TEST_CLUSTER_NAME}'.`);
  }
  if (identity.username !== TEST_DB_USER) {
    throw new TestDatabaseGuardError(`Connected role must be '${TEST_DB_USER}'.`);
  }
  if (identity.database !== expectedDatabase) {
    throw new TestDatabaseGuardError("Connected database does not match TEST_DATABASE_URL.");
  }

  const [markerTable] = await query("select to_regclass('isf_test_guard.marker') is not null as present");
  if (!markerTable?.present) {
    throw new TestDatabaseGuardError("Test marker table isf_test_guard.marker is missing.");
  }
  const [marker] = await query(`select value from isf_test_guard.marker where key = '${TEST_MARKER_KEY}'`);
  if (marker?.value !== TEST_MARKER_VALUE) {
    throw new TestDatabaseGuardError("Test marker value is missing or wrong.");
  }

  const [accounts] = await query("select to_regclass('public.user_accounts') is not null as present");
  if (accounts?.present) {
    const [foreign] = await query(
      `select count(*)::int as n from public.user_accounts where email is not null and lower(email) not like '%${TEST_FIXTURE_EMAIL_DOMAIN}'`
    );
    if (Number(foreign?.n ?? 0) !== 0) {
      throw new TestDatabaseGuardError(
        `public.user_accounts contains addresses outside ${TEST_FIXTURE_EMAIL_DOMAIN}; this does not look like a test database.`
      );
    }
  }
}
