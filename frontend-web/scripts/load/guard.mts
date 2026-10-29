/**
 * Target guard for load-test tooling. Production is always refused. "test" uses the
 * fail-closed test-database guard; "staging" requires a staging marker table that an
 * operator creates once (see load/README.md), the production denylist and a TLS CA.
 */
import postgres from "postgres";
import { assertTestDatabasePostConnect, assertTestEnvironmentPreConnect } from "../../lib/safety/test-database-guard.ts";

export const STAGING_MARKER = "ISF-STAGING-DATABASE-v1";

export async function connectLoadDatabase(env: NodeJS.ProcessEnv): Promise<postgres.Sql> {
  const target = env.APP_ENV;
  const raw = env.LOAD_DATABASE_URL;
  if (target !== "test" && target !== "staging") throw new Error("APP_ENV must be 'test' or 'staging'; load tooling never runs against production");
  if (!raw) throw new Error("LOAD_DATABASE_URL is required (DATABASE_URL is never used)");

  const deny = (env.PRODUCTION_DB_DENYLIST ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (deny.length === 0) throw new Error("PRODUCTION_DB_DENYLIST is required");
  if (deny.some((d) => raw.toLowerCase().includes(d))) throw new Error("LOAD_DATABASE_URL matches the production denylist");

  if (target === "test") {
    const { database } = assertTestEnvironmentPreConnect({ ...env, TEST_DATABASE_URL: raw });
    const sql = postgres(raw, { max: 4, onnotice: () => {} });
    await assertTestDatabasePostConnect((q) => sql.unsafe(q), database);
    return sql;
  }

  const ca = env.LOAD_CA_CERT?.replace(/\\n/g, "\n");
  if (!ca) throw new Error("staging requires LOAD_CA_CERT (TLS must be verified)");
  const sql = postgres(raw, { max: 4, onnotice: () => {}, ssl: { ca, rejectUnauthorized: true } });
  const [marker] = await sql`select to_regclass('isf_staging_guard.marker') is not null as present`;
  const [value] = marker.present ? await sql`select value from isf_staging_guard.marker where key = 'isf-staging-db'` : [];
  if (value?.value !== STAGING_MARKER) {
    await sql.end();
    throw new Error("staging marker isf_staging_guard.marker is missing; this does not look like the staging database");
  }
  return sql;
}
