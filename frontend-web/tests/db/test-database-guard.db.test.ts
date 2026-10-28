/** GUARD-01/02 against the real local test server. */
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getDb } from "@/lib/db";
import { assertTestDatabasePostConnect, TestDatabaseGuardError } from "@/lib/safety/test-database-guard";
import { baseTestDatabaseUrl, withDatabase } from "../support/test-db-urls";

const UNMARKED = "isf_test_unmarked";
const FOREIGN = "isf_test_foreign";
const quiet = { max: 1, onnotice: () => {} } as const;

describe("test database guard on a live server", () => {
  beforeAll(async () => {
    const admin = postgres(baseTestDatabaseUrl(), quiet);
    try {
      for (const db of [UNMARKED, FOREIGN]) {
        await admin.unsafe(`drop database if exists ${db} with (force)`);
      }
      await admin.unsafe(`create database ${UNMARKED}`);
      await admin.unsafe(`create database ${FOREIGN} template isf_test_template`);
    } finally {
      await admin.end();
    }
    // Simulate restored production data in a marked database.
    const foreign = postgres(withDatabase(baseTestDatabaseUrl(), FOREIGN), quiet);
    try {
      await foreign`insert into user_accounts (email, full_name) values ('someone@realdomain.in', 'Real Person')`;
    } finally {
      await foreign.end();
    }
  });

  afterAll(async () => {
    const admin = postgres(baseTestDatabaseUrl(), quiet);
    try {
      for (const db of [UNMARKED, FOREIGN]) await admin.unsafe(`drop database if exists ${db} with (force)`);
    } finally {
      await admin.end();
    }
  });

  it("the app pool passes the guard on the per-file database (populated databases are allowed)", async () => {
    const sql = await getDb();
    await sql`insert into user_accounts (email, full_name) values ('fixture@example.test', 'Fixture')`;
    const workerDatabase = new URL(process.env.TEST_DATABASE_URL!).pathname.slice(1);
    await expect(assertTestDatabasePostConnect((q) => sql.unsafe(q), workerDatabase)).resolves.toBeUndefined();
  });

  it("rejects a database without the marker", async () => {
    const sql = postgres(withDatabase(baseTestDatabaseUrl(), UNMARKED), quiet);
    try {
      await expect(assertTestDatabasePostConnect((q) => sql.unsafe(q), UNMARKED)).rejects.toThrow(
        TestDatabaseGuardError
      );
    } finally {
      await sql.end();
    }
  });

  it("rejects a marked database containing non-fixture email addresses", async () => {
    const sql = postgres(withDatabase(baseTestDatabaseUrl(), FOREIGN), quiet);
    try {
      await expect(assertTestDatabasePostConnect((q) => sql.unsafe(q), FOREIGN)).rejects.toThrow(
        /outside @example\.test/
      );
    } finally {
      await sql.end();
    }
  });
});
