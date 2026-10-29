/**
 * SCH tests for migration 0009: functions in public are not executable by PUBLIC (and so not by
 * the Supabase Data API roles, which inherit from PUBLIC), while triggers and event triggers keep
 * working. Mirrors public.rls_auto_enable(), the SECURITY DEFINER event trigger function found on
 * the connected Supabase project.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { getDb } from "@/lib/db";

const root = path.resolve(__dirname, "../../../database");
const migration = readFileSync(path.join(root, "migrations/0009_public_functions_execute.sql"), "utf8");
const verify = readFileSync(path.join(root, "verify/002_registration_data_exposure.sql"), "utf8");

async function publicCanExecute(signature: string): Promise<boolean> {
  const sql = await getDb();
  const [row] = await sql`
    select exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                    where a.grantee = 0 and a.privilege_type = 'EXECUTE') as public_exec
      from pg_proc p where p.oid = ${signature}::regprocedure`;
  return row.public_exec;
}

describe("0009 public functions are closed to the Data API", () => {
  it("revokes EXECUTE from PUBLIC on an existing function, and new functions no longer get it", async () => {
    const sql = await getDb();
    // Created before 0009 runs again: simulate a function that holds the PostgreSQL default.
    await sql.unsafe(`create or replace function public.fn_0009_existing() returns int language sql as 'select 1'`);
    await sql.unsafe(`grant execute on function public.fn_0009_existing() to public`);
    expect(await publicCanExecute("public.fn_0009_existing()")).toBe(true);

    await sql.unsafe(migration);
    expect(await publicCanExecute("public.fn_0009_existing()")).toBe(false);

    await sql.unsafe(`create or replace function public.fn_0009_later() returns int language sql as 'select 2'`);
    expect(await publicCanExecute("public.fn_0009_later()")).toBe(false);

    // The owner (the application's role) can still call them.
    const [row] = await sql.unsafe(`select public.fn_0009_existing() as a, public.fn_0009_later() as b`);
    expect(row).toEqual({ a: 1, b: 2 });
    await sql.unsafe(`drop function public.fn_0009_existing(); drop function public.fn_0009_later()`);
  });

  // The event-trigger case (rls_auto_enable itself) needs a superuser, which the test role is
  // not; it was proven by hand on 2026-10-29 (docs/release/LAUNCH_EVIDENCE.md, LG-04).
  it("a trigger whose function lost PUBLIC EXECUTE still fires", async () => {
    const sql = await getDb();
    await sql.unsafe(`create table public.t_0009_probe (id int, note text)`);
    await sql.unsafe(`
      create or replace function public.fn_0009_note() returns trigger
      language plpgsql security definer set search_path = pg_catalog as $$
      begin new.note := 'set by trigger'; return new; end $$`);
    await sql.unsafe(`create trigger tr_0009_note before insert on public.t_0009_probe for each row execute function public.fn_0009_note()`);
    try {
      await sql.unsafe(migration);
      expect(await publicCanExecute("public.fn_0009_note()")).toBe(false);

      const [row] = await sql.unsafe(`insert into public.t_0009_probe (id) values (1) returning note`);
      expect(row.note).toBe("set by trigger");
    } finally {
      await sql.unsafe(`drop table if exists public.t_0009_probe`);
      await sql.unsafe(`drop function if exists public.fn_0009_note()`);
    }
  });

  it("the verification query passes after the migration", async () => {
    const sql = await getDb();
    await sql.unsafe(migration);
    const failing = (await sql.unsafe(verify)).filter((r) => !r.ok).map((r) => r.check_name);
    expect(failing).toEqual([]);
  });

  it("the verification query fails while PUBLIC can execute a public function", async () => {
    const sql = await getDb();
    await sql.unsafe(`create or replace function public.fn_0009_open() returns int language sql as 'select 3'`);
    await sql.unsafe(`grant execute on function public.fn_0009_open() to public`);
    try {
      const failing = (await sql.unsafe(verify)).filter((r) => !r.ok).map((r) => r.check_name);
      expect(failing).toEqual(["PUBLIC cannot execute public.fn_0009_open()"]);
    } finally {
      await sql.unsafe(`drop function public.fn_0009_open()`);
    }
  });
});
