#!/usr/bin/env node
/**
 * Disposable local PostgreSQL cluster for tests (no Docker required).
 *
 *   node scripts/test-db.mjs start   # initdb on first use, then start
 *   node scripts/test-db.mjs stop
 *   node scripts/test-db.mjs status
 *
 * The cluster lives in <repo>/.pgdata/isf-test (gitignored), listens only on
 * localhost:54329, and is marked with cluster_name=isf-test. It uses trust
 * authentication, so it must never be exposed beyond localhost.
 * Set PG_BIN if initdb/pg_ctl/psql are not on PATH.
 */
import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const dataRoot = path.resolve(here, "../../.pgdata");
const dataDir = path.join(dataRoot, "isf-test");
const logFile = path.join(dataRoot, "isf-test.log");
const PORT = "54329";
const BOOTSTRAP_USER = "isf_bootstrap";

function bin(name) {
  return process.env.PG_BIN ? path.join(process.env.PG_BIN, name) : name;
}

function run(name, args, { allowFail = false, detachedOutput = false } = {}) {
  // pg_ctl start leaves the server holding inherited pipes on Windows, which would
  // block spawnSync forever; the server logs to logFile instead.
  const result = spawnSync(bin(name), args, { encoding: "utf8", stdio: detachedOutput ? "ignore" : "pipe" });
  if (result.error) throw result.error;
  if (result.status !== 0 && !allowFail) {
    process.stderr.write((result.stdout ?? "") + (result.stderr ?? ""));
    throw new Error(`${name} exited with ${result.status}`);
  }
  return result;
}

function psql(database, user, sql) {
  return run("psql", ["-h", "localhost", "-p", PORT, "-U", user, "-d", database, "-v", "ON_ERROR_STOP=1", "-tAc", sql])
    .stdout.trim();
}

function init() {
  mkdirSync(dataRoot, { recursive: true });
  run("initdb", ["-D", dataDir, "-U", BOOTSTRAP_USER, "-A", "trust", "-E", "UTF8", "--no-locale"]);
  appendFileSync(
    path.join(dataDir, "postgresql.conf"),
    `\n# isf-test settings\nport = ${PORT}\nlisten_addresses = 'localhost'\ncluster_name = 'isf-test'\n`
  );
}

function start() {
  if (!existsSync(path.join(dataDir, "PG_VERSION"))) init();
  const status = run("pg_ctl", ["-D", dataDir, "status"], { allowFail: true });
  if (status.status !== 0) {
    run("pg_ctl", ["-D", dataDir, "-l", logFile, "-w", "start"], { detachedOutput: true });
  }

  const roleExists = psql("postgres", BOOTSTRAP_USER, "select 1 from pg_roles where rolname = 'isf_test'");
  if (!roleExists) {
    psql("postgres", BOOTSTRAP_USER, "create role isf_test login createdb password 'isf_test'");
  }
  const dbExists = psql("postgres", BOOTSTRAP_USER, "select 1 from pg_database where datname = 'isf_test'");
  if (!dbExists) {
    psql("postgres", BOOTSTRAP_USER, "create database isf_test owner isf_test");
  }
  psql(
    "isf_test",
    "isf_test",
    "create schema if not exists isf_test_guard; " +
      "create table if not exists isf_test_guard.marker (key text primary key, value text not null); " +
      "insert into isf_test_guard.marker values ('isf-test-db', 'ISF-TEST-DATABASE-v1') on conflict (key) do nothing"
  );
  console.log(`isf-test cluster ready: TEST_DATABASE_URL=postgresql://isf_test:isf_test@localhost:${PORT}/isf_test`);
}

function stop() {
  if (!existsSync(path.join(dataDir, "PG_VERSION"))) return console.log("isf-test cluster not initialised");
  run("pg_ctl", ["-D", dataDir, "-w", "stop"], { allowFail: true });
  console.log("isf-test cluster stopped");
}

const command = process.argv[2];
if (command === "start") start();
else if (command === "stop") stop();
else if (command === "status") process.exit(run("pg_ctl", ["-D", dataDir, "status"], { allowFail: true }).status ?? 1);
else {
  console.error("usage: node scripts/test-db.mjs start|stop|status");
  process.exit(2);
}
