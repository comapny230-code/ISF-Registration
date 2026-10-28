import { TestDatabaseGuardError } from "../../lib/safety/test-database-guard";

export const BASE_DATABASE = "isf_test";
export const TEMPLATE_DATABASE = "isf_test_template";

/** Returns the same server/credentials with a different database name. */
export function withDatabase(url: string, database: string): string {
  if (!/^isf_test(_[a-z0-9]{1,32})?$/.test(database)) {
    throw new TestDatabaseGuardError(`Refusing to address database '${database}'.`);
  }
  const parsed = new URL(url);
  parsed.pathname = `/${database}`;
  return parsed.toString();
}

/** The base URL supplied by the developer/CI, remembered before workers repoint TEST_DATABASE_URL. */
export function baseTestDatabaseUrl(): string {
  if (!process.env.ISF_TEST_BASE_DATABASE_URL) {
    const supplied = process.env.TEST_DATABASE_URL;
    if (!supplied) {
      throw new TestDatabaseGuardError(
        "TEST_DATABASE_URL is required. Start the local cluster with `npm run test-db:start` and export the URL it prints."
      );
    }
    process.env.ISF_TEST_BASE_DATABASE_URL = withDatabase(supplied, BASE_DATABASE);
  }
  return process.env.ISF_TEST_BASE_DATABASE_URL;
}

export const MARKER_SQL =
  "create schema if not exists isf_test_guard; " +
  "create table if not exists isf_test_guard.marker (key text primary key, value text not null); " +
  "insert into isf_test_guard.marker values ('isf-test-db', 'ISF-TEST-DATABASE-v1') on conflict (key) do nothing";
