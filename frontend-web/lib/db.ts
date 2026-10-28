import postgres from "postgres";
import { getDatabaseConfig } from "./config";
import { assertTestDatabasePostConnect } from "./safety/test-database-guard";

let sqlPromise: Promise<postgres.Sql> | null = null;

async function connect(): Promise<postgres.Sql> {
  const config = getDatabaseConfig();
  const sql = postgres(config.url, {
    ssl: config.ssl,
    prepare: false, // Required by the Supabase transaction-mode pooler
    max: 5,
    idle_timeout: 10,
    connect_timeout: 15,
  });

  if (config.testDatabase) {
    try {
      await assertTestDatabasePostConnect((text) => sql.unsafe(text), config.testDatabase);
    } catch (err) {
      await sql.end({ timeout: 1 });
      throw err;
    }
  }
  return sql;
}

/**
 * Shared connection pool. Configuration and (in tests) the database guard are
 * checked before the first query; a failed attempt is retried on the next call.
 */
export function getDb(): Promise<postgres.Sql> {
  if (!sqlPromise) {
    sqlPromise = connect().catch((err) => {
      sqlPromise = null;
      throw err;
    });
  }
  return sqlPromise;
}

/** Closes the pool (used by tests and scripts). */
export async function closeDb(): Promise<void> {
  const pending = sqlPromise;
  sqlPromise = null;
  if (pending) {
    const sql = await pending.catch(() => null);
    await sql?.end({ timeout: 5 });
  }
}
