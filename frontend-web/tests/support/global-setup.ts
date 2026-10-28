/**
 * Builds the migrated template database once per run. Every connection is
 * preceded by the fail-closed guard; nothing is written until it passes.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import postgres from "postgres";
import {
  assertTestDatabasePostConnect,
  assertTestEnvironmentPreConnect,
} from "../../lib/safety/test-database-guard";
import type { TestProject } from "vitest/node";
import { BASE_DATABASE, MARKER_SQL, TEMPLATE_DATABASE, baseTestDatabaseUrl, withDatabase } from "./test-db-urls";

const migrationsDir = path.resolve(__dirname, "../../../database/migrations");
const quiet = { max: 1, onnotice: () => {} } as const;

export default async function setup(project: TestProject) {
  try {
    await buildTemplate(project);
  } catch (err) {
    // Vitest's startup-error printer can hide the cause; state it plainly first.
    console.error(`\n[db tests aborted] ${err instanceof Error ? err.message : String(err)}\n`);
    throw err;
  }
}

async function buildTemplate(project: TestProject) {
  const env = process.env as Record<string, string | undefined>;
  env.NODE_ENV ??= "test";
  for (const [key, value] of Object.entries(project.config.env ?? {})) {
    if (typeof value === "string") env[key] ??= value;
  }

  const baseUrl = baseTestDatabaseUrl();
  assertTestEnvironmentPreConnect({ ...process.env, TEST_DATABASE_URL: baseUrl });

  const admin = postgres(baseUrl, quiet);
  try {
    await assertTestDatabasePostConnect((q) => admin.unsafe(q), BASE_DATABASE);
    await admin.unsafe(`drop database if exists ${TEMPLATE_DATABASE} with (force)`);
    await admin.unsafe(`create database ${TEMPLATE_DATABASE}`);
  } finally {
    await admin.end();
  }

  // The template was created a moment ago on the verified server, so marking it is safe.
  const template = postgres(withDatabase(baseUrl, TEMPLATE_DATABASE), quiet);
  try {
    await template.unsafe(MARKER_SQL);
    await assertTestDatabasePostConnect((q) => template.unsafe(q), TEMPLATE_DATABASE);
    const files = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();
    for (const file of files) {
      await template.unsafe(readFileSync(path.join(migrationsDir, file), "utf8"));
    }
  } finally {
    await template.end();
  }
}
