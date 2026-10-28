/**
 * Gives each test file a fresh database cloned from the migrated template,
 * then points TEST_DATABASE_URL (and therefore the app's guarded pool) at it.
 */
import { afterAll, beforeAll } from "vitest";
import postgres from "postgres";
import { closeDb } from "../../lib/db";
import { assertTestDatabasePostConnect, assertTestEnvironmentPreConnect } from "../../lib/safety/test-database-guard";
import { BASE_DATABASE, TEMPLATE_DATABASE, baseTestDatabaseUrl, withDatabase } from "./test-db-urls";

const workerDatabase = `isf_test_w${process.env.VITEST_POOL_ID ?? "1"}`;

beforeAll(async () => {
  const baseUrl = baseTestDatabaseUrl();
  assertTestEnvironmentPreConnect({ ...process.env, TEST_DATABASE_URL: baseUrl });

  const admin = postgres(baseUrl, { max: 1, onnotice: () => {} });
  try {
    await assertTestDatabasePostConnect((q) => admin.unsafe(q), BASE_DATABASE);
    await admin.unsafe(`drop database if exists ${workerDatabase} with (force)`);
    await admin.unsafe(`create database ${workerDatabase} template ${TEMPLATE_DATABASE}`);
  } finally {
    await admin.end();
  }

  process.env.TEST_DATABASE_URL = withDatabase(baseUrl, workerDatabase);
});

afterAll(async () => {
  await closeDb();
});
