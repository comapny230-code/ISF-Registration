#!/usr/bin/env node
/**
 * Database migration runner (docs/STALL_BOOKING_FINAL_SPEC.md §2.7). Run with Node 22+:
 *
 *   node scripts/migrate.mts status   --target <local|test|staging|production>
 *   node scripts/migrate.mts apply    --target <...> [--dry-run]
 *   node scripts/migrate.mts baseline --target <...> --version 0001
 *   node scripts/migrate.mts verify   --target <...>
 *
 * Safety:
 * - Connects ONLY via MIGRATION_DATABASE_URL (never DATABASE_URL), as the schema owner,
 *   over a direct or session-mode connection; the transaction pooler (port 6543) is refused
 *   because the session advisory lock would not hold.
 * - --target must equal APP_ENV. "test" runs the fail-closed test-database guard; "local"
 *   requires a loopback host; non-production targets must not match PRODUCTION_DB_DENYLIST.
 * - "staging" and "production" require a verified TLS CA (MIGRATION_CA_CERT); "production"
 *   also requires --confirm-production <hostname> and MIGRATION_OPERATOR.
 * - Each migration runs in its own transaction and is recorded with its SHA-256; an applied
 *   file whose content changed stops the run.
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import postgres from "postgres";
import { assertTestDatabasePostConnect, assertTestEnvironmentPreConnect } from "../lib/safety/test-database-guard.ts";

type Target = "local" | "test" | "staging" | "production";
const TARGETS: Target[] = ["local", "test", "staging", "production"];
const root = path.resolve(import.meta.dirname, "../..");
const MIGRATIONS_DIR = path.join(root, "database/migrations");
const VERIFY_DIR = path.join(root, "database/verify");
const LOCK_KEY = "isf-migrations";

class RunnerError extends Error {}

function args(argv: string[]) {
  const [command, ...rest] = argv;
  const flags: Record<string, string | true> = {};
  for (let i = 0; i < rest.length; i++) {
    const key = rest[i];
    if (!key.startsWith("--")) throw new RunnerError(`unexpected argument ${key}`);
    const next = rest[i + 1];
    if (next !== undefined && !next.startsWith("--")) {
      flags[key.slice(2)] = next;
      i++;
    } else {
      flags[key.slice(2)] = true;
    }
  }
  return { command, flags };
}

export interface MigrationFile {
  version: string;
  name: string;
  sha256: string;
  sql: string;
}

export function migrationFiles(dir = MIGRATIONS_DIR): MigrationFile[] {
  return readdirSync(dir)
    .filter((f) => /^\d{4}_[a-z0-9_]+\.sql$/.test(f))
    .sort()
    .map((name) => {
      const sql = readFileSync(path.join(dir, name), "utf8");
      return { version: name.slice(0, 4), name, sha256: createHash("sha256").update(sql).digest("hex"), sql };
    });
}

function checkTarget(target: Target, url: URL, env: NodeJS.ProcessEnv, flags: Record<string, string | true>) {
  if (env.APP_ENV !== target) throw new RunnerError(`--target ${target} does not match APP_ENV=${env.APP_ENV ?? "(unset)"}`);
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") throw new RunnerError("MIGRATION_DATABASE_URL must be a postgres URL");
  if (url.port === "6543") throw new RunnerError("refusing the transaction pooler (port 6543); use a direct or session-mode connection");

  if (target !== "production") {
    const deny = (env.PRODUCTION_DB_DENYLIST ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
    if (deny.length === 0) throw new RunnerError("PRODUCTION_DB_DENYLIST is required outside production");
    if (deny.some((d) => url.href.toLowerCase().includes(d))) throw new RunnerError(`MIGRATION_DATABASE_URL matches the production denylist`);
  }
  if (target === "local" && !["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname)) {
    throw new RunnerError("--target local requires a loopback host");
  }
  if (target === "production") {
    if (flags["confirm-production"] !== url.hostname) {
      throw new RunnerError(`production requires --confirm-production ${url.hostname}`);
    }
    if (!env.MIGRATION_OPERATOR?.trim()) throw new RunnerError("production requires MIGRATION_OPERATOR (your name)");
  }
  if ((target === "staging" || target === "production") && !env.MIGRATION_CA_CERT) {
    throw new RunnerError(`${target} requires MIGRATION_CA_CERT (TLS must be verified)`);
  }
}

async function main(argv: string[], env: NodeJS.ProcessEnv): Promise<number> {
  const { command, flags } = args(argv);
  if (!["status", "apply", "baseline", "verify"].includes(command ?? "")) {
    throw new RunnerError("usage: migrate.mts <status|apply|baseline|verify> --target <local|test|staging|production> [--dry-run] [--version NNNN]");
  }
  const target = flags.target as Target;
  if (!TARGETS.includes(target)) throw new RunnerError("--target must be one of local, test, staging, production");
  const raw = env.MIGRATION_DATABASE_URL;
  if (!raw) throw new RunnerError("MIGRATION_DATABASE_URL is required (DATABASE_URL is never used)");
  const url = new URL(raw);
  checkTarget(target, url, env, flags);

  let testDatabase: string | null = null;
  if (target === "test") {
    testDatabase = assertTestEnvironmentPreConnect({ ...env, TEST_DATABASE_URL: raw }).database;
  }

  const ca = env.MIGRATION_CA_CERT?.replace(/\\n/g, "\n");
  const sql = postgres(raw, { max: 1, onnotice: () => {}, ssl: ca ? { ca, rejectUnauthorized: true } : false });
  try {
    if (testDatabase) await assertTestDatabasePostConnect((q) => sql.unsafe(q), testDatabase);
    await sql`select pg_advisory_lock(hashtext(${LOCK_KEY}))`;
    try {
      return await run(sql, command!, flags, env);
    } finally {
      await sql`select pg_advisory_unlock(hashtext(${LOCK_KEY}))`;
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
}

async function run(sql: postgres.Sql, command: string, flags: Record<string, string | true>, env: NodeJS.ProcessEnv): Promise<number> {
  // Created locked down in one transaction: on Supabase a new public table otherwise inherits
  // full anon/authenticated grants from the default privileges and is exposed by the Data API.
  await sql.begin(async (tx) => {
    await tx`
      create table if not exists public.schema_migrations (
        version    text primary key,
        name       text not null,
        sha256     text not null,
        applied_at timestamptz not null default now(),
        applied_by text not null
      )`;
    await tx`alter table public.schema_migrations enable row level security`;
    await tx`revoke all on table public.schema_migrations from public`;
    for (const role of ["anon", "authenticated"]) {
      const [exists] = await tx`select 1 from pg_roles where rolname = ${role}`;
      if (exists) await tx.unsafe(`revoke all on table public.schema_migrations from ${role}`);
    }
  });
  const operator = env.MIGRATION_OPERATOR?.trim() || `${os.userInfo().username}@${os.hostname()}`;
  const files = migrationFiles();
  const applied = new Map((await sql`select version, name, sha256 from public.schema_migrations`).map((r) => [r.version as string, r]));

  const changed = files.filter((f) => applied.has(f.version) && applied.get(f.version)!.sha256 !== f.sha256);
  const unknown = [...applied.keys()].filter((v) => !files.some((f) => f.version === v));
  const pending = files.filter((f) => !applied.has(f.version));

  if (command === "status") {
    for (const f of files) {
      const state = !applied.has(f.version) ? "pending" : changed.includes(f) ? "CHANGED SINCE APPLIED" : "applied";
      console.log(`${f.name}  ${state}`);
    }
    for (const v of unknown) console.log(`${v}  APPLIED BUT FILE MISSING`);
    return changed.length || unknown.length ? 1 : 0;
  }

  if (changed.length || unknown.length) {
    for (const f of changed) console.error(`ERROR ${f.name} changed after it was applied (sha256 differs); write a new migration instead`);
    for (const v of unknown) console.error(`ERROR migration ${v} is recorded but its file is missing`);
    return 1;
  }

  if (command === "baseline") {
    const upTo = flags.version;
    if (typeof upTo !== "string" || !/^\d{4}$/.test(upTo)) throw new RunnerError("baseline requires --version NNNN");
    const toMark = pending.filter((f) => f.version <= upTo);
    for (const f of toMark) {
      if (flags["dry-run"]) {
        console.log(`would baseline ${f.name} (not executed)`);
        continue;
      }
      await sql`insert into public.schema_migrations (version, name, sha256, applied_by) values (${f.version}, ${f.name}, ${f.sha256}, ${`${operator} (baseline)`})`;
      console.log(`baselined ${f.name} (not executed)`);
    }
    return 0;
  }

  if (command === "apply") {
    if (pending.length === 0) console.log("nothing to apply");
    for (const f of pending) {
      if (flags["dry-run"]) {
        console.log(`would apply ${f.name}`);
        continue;
      }
      await sql.begin(async (tx) => {
        await tx.unsafe(f.sql);
        await tx`insert into public.schema_migrations (version, name, sha256, applied_by) values (${f.version}, ${f.name}, ${f.sha256}, ${operator})`;
      });
      console.log(`applied ${f.name}`);
    }
    return 0;
  }

  // verify
  let failures = 0;
  for (const name of readdirSync(VERIFY_DIR).filter((f) => f.endsWith(".sql")).sort()) {
    const rows = await sql.unsafe(readFileSync(path.join(VERIFY_DIR, name), "utf8"));
    for (const row of rows) {
      const ok = row.ok === true;
      if (!ok) failures++;
      console.log(`${ok ? "PASS" : "FAIL"}  ${row.check_name}${row.detail ? ` (${row.detail})` : ""}`);
    }
  }
  console.log(failures === 0 ? "verification passed" : `verification FAILED: ${failures} check(s)`);
  return failures === 0 ? 0 : 1;
}

if (import.meta.main) {
  main(process.argv.slice(2), process.env).then(
    (code) => process.exit(code),
    (err) => {
      console.error(`ERROR ${err instanceof Error ? err.message : String(err)}`);
      process.exit(2);
    }
  );
}
