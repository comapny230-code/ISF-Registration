/**
 * MIG-0012: removal of the reset script's starter/test stalls (source_ref 'starter', inserted as
 * 'approved') and of the approval on its 'master' zones. Each case runs in a transaction that is
 * rolled back, so the shared test database is unchanged.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import type postgres from "postgres";
import { describe, expect, it } from "vitest";
import { getDb } from "@/lib/db";

const migration = readFileSync(path.resolve(__dirname, "../../../database/migrations/0012_remove_starter_test_stalls.sql"), "utf8");
const ROLLBACK = new Error("rollback");

async function inRolledBackTx(fn: (tx: postgres.TransactionSql) => Promise<void>) {
  const sql = await getDb();
  await expect(
    sql.begin(async (tx) => {
      await fn(tx);
      throw ROLLBACK;
    })
  ).rejects.toBe(ROLLBACK);
}

async function seedLikeResetScript(tx: postgres.TransactionSql) {
  await tx`
    insert into booking.zones (edition_id, code, name, extent_width_ft, extent_depth_ft, inventory_status, source_ref)
    values (2026, 'QA', 'Starter zone A', 100, 100, 'approved', 'master'),
           (2026, 'QB', 'Starter zone B', 100, 100, 'approved', 'master')`;
  await tx`
    insert into booking.stalls (edition_id, zone_id, code, width_ft, depth_ft, x_ft, y_ft, rotation_deg, inventory_status, source_ref)
    select 2026, z.id, v.code, 10, 10, v.x, 5, 0, 'approved', 'starter'
      from (values ('QA', 'QA-A01', 10), ('QA', 'QA-A02', 25), ('QB', 'QB-A01', 10)) as v(zone, code, x)
      join booking.zones z on z.edition_id = 2026 and z.code = v.zone`;
}

describe("MIG-0012 starter stall cleanup", () => {
  it("deletes starter stalls and returns their zones to provisional", async () => {
    await inRolledBackTx(async (tx) => {
      await seedLikeResetScript(tx);
      await tx.unsafe(migration);
      const [row] = await tx`
        select (select count(*)::int from booking.stalls where source_ref = 'starter') as starter,
               (select string_agg(code || '=' || inventory_status, ',' order by code) from booking.zones where code in ('QA', 'QB')) as zones`;
      expect(row).toEqual({ starter: 0, zones: "QA=provisional,QB=provisional" });
    });
  });

  it("keeps a zone approved when it has a stall that was really approved", async () => {
    await inRolledBackTx(async (tx) => {
      await seedLikeResetScript(tx);
      await tx`
        insert into booking.stalls (edition_id, zone_id, code, width_ft, depth_ft, x_ft, y_ft, rotation_deg, inventory_status, source_ref)
        select 2026, id, 'QB-B01', 10, 10, 50, 5, 0, 'approved', 'organiser approval 2026-11-01' from booking.zones where code = 'QB'`;
      await tx.unsafe(migration);
      const rows = await tx`select code, inventory_status from booking.stalls where code like 'Q%' order by code`;
      expect(rows.map((r) => `${r.code}=${r.inventory_status}`)).toEqual(["QB-B01=approved"]);
      const zones = await tx`select code, inventory_status from booking.zones where code in ('QA', 'QB') order by code`;
      expect(zones.map((z) => `${z.code}=${z.inventory_status}`)).toEqual(["QA=provisional", "QB=approved"]);
    });
  });

  it("refuses, changing nothing, when a starter stall has an audit entry", async () => {
    await inRolledBackTx(async (tx) => {
      await seedLikeResetScript(tx);
      await tx`
        insert into booking.audit_events (edition_id, actor_type, action, stall_id, details)
        select 2026, 'system', 'inventory_changed', id, '{}'::jsonb from booking.stalls where code = 'QA-A01'`;
      await tx`savepoint before_0012`;
      await expect(tx.unsafe(migration)).rejects.toThrow(/0012 refused: 1 starter stall/);
      await tx`rollback to savepoint before_0012`;
      const [row] = await tx`select count(*)::int as n from booking.stalls where source_ref = 'starter'`;
      expect(row.n).toBe(3);
    });
  });

  it("is a no-op when there is no starter data", async () => {
    await inRolledBackTx(async (tx) => {
      const before = await tx`select id, inventory_status from booking.zones order by id`;
      const [stalls] = await tx`select count(*)::int as n from booking.stalls`;
      await tx.unsafe(migration);
      expect(await tx`select id, inventory_status from booking.zones order by id`).toEqual(before);
      expect((await tx`select count(*)::int as n from booking.stalls`)[0].n).toBe(stalls.n);
    });
  });
});
