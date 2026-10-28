/** Builds the e2e database from migrations, behind the same fail-closed guard as the unit/db tests. */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import postgres from "postgres";
import { assertTestDatabasePostConnect, assertTestEnvironmentPreConnect } from "../lib/safety/test-database-guard";
import { MARKER_SQL, withDatabase } from "../tests/support/test-db-urls";
import { E2E_DATABASE, E2E_ENV } from "./env";

export default async function globalSetup() {
  const supplied = process.env.TEST_DATABASE_URL;
  if (!supplied) throw new Error("TEST_DATABASE_URL is required (see tests/README.md).");
  const base = withDatabase(supplied, "isf_test");
  const env = { ...process.env, ...E2E_ENV, TEST_DATABASE_URL: base };
  assertTestEnvironmentPreConnect(env);

  const quiet = { max: 1, onnotice: () => {} } as const;
  const admin = postgres(base, quiet);
  try {
    await assertTestDatabasePostConnect((q) => admin.unsafe(q), "isf_test");
    await admin.unsafe(`drop database if exists ${E2E_DATABASE} with (force)`);
    await admin.unsafe(`create database ${E2E_DATABASE}`);
  } finally {
    await admin.end();
  }

  const db = postgres(withDatabase(supplied, E2E_DATABASE), quiet);
  try {
    await db.unsafe(MARKER_SQL);
    await assertTestDatabasePostConnect((q) => db.unsafe(q), E2E_DATABASE);
    const dir = path.resolve(__dirname, "../../database/migrations");
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
      await db.unsafe(readFileSync(path.join(dir, file), "utf8"));
    }
  } finally {
    await db.end();
  }
}
