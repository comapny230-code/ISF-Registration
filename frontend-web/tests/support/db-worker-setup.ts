/**
 * Gives each test file a fresh database cloned from the migrated template,
 * then points TEST_DATABASE_URL (and therefore the app's guarded pool) at it.
 *
 * Names are unique per file (isf_test_w<pool><random>) so a database that
 * cannot be dropped yet (e.g. an autovacuum worker the test role may not
 * terminate) never blocks the next file; leftovers are swept best-effort.
 */
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll } from "vitest";
import postgres from "postgres";
import { closeDb } from "../../lib/db";
import { assertTestDatabasePostConnect, assertTestEnvironmentPreConnect } from "../../lib/safety/test-database-guard";
import { BASE_DATABASE, TEMPLATE_DATABASE, baseTestDatabaseUrl, dropDatabaseBestEffort, withDatabase } from "./test-db-urls";

const workerDatabase = `isf_test_w${process.env.VITEST_POOL_ID ?? "1"}${randomBytes(4).toString("hex")}`;

beforeAll(async () => {
  const baseUrl = baseTestDatabaseUrl();
  assertTestEnvironmentPreConnect({ ...process.env, TEST_DATABASE_URL: baseUrl });

  const admin = postgres(baseUrl, { max: 1, onnotice: () => {} });
  try {
    await assertTestDatabasePostConnect((q) => admin.unsafe(q), BASE_DATABASE);
    await admin.unsafe(`create database ${workerDatabase} template ${TEMPLATE_DATABASE}`);
  } finally {
    await admin.end();
  }

  process.env.TEST_DATABASE_URL = withDatabase(baseUrl, workerDatabase);
});

afterAll(async () => {
  await closeDb();
  await dropDatabaseBestEffort(baseTestDatabaseUrl(), workerDatabase);
});
