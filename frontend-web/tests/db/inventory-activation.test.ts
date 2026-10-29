/**
 * The production activation migration generated from an organiser-approved inventory:
 * activates only APPROVED rows with coordinates, works on an empty (production-like)
 * database and on one carrying the provisional seed (staging), and is safe to re-run.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { getDb } from "@/lib/db";
import { generateActivationMigrationSql, generateProvisionalSeedSql, parseCsv, validateInventory } from "@/scripts/inventory/inventory.mjs";

const csvPath = path.resolve(__dirname, "../../../docs/stall_inventory_provisional.csv");
const { header, rows } = parseCsv(readFileSync(csvPath, "utf8"));

/** Three Play Ground stalls approved with test coordinates; everything else unchanged (provisional). */
function approvedVariant() {
  return rows.map((r) => {
    const i = ["PG-A01", "PG-A02", "PG-A03"].indexOf(r.provisional_stall_code);
    if (i < 0) return r;
    return { ...r, x_ft: String(16 + i * 10), y_ft: "0", rotation_deg: "0", approval_status: "APPROVED - test sign-off", bookable: "true" };
  });
}

const APPROVAL = "Approved by the organisers (test), 2026-10-29, layout v1";

async function stallStates() {
  const sql = await getDb();
  return sql`select code, inventory_status, bookable, x_ft is not null as placed from booking.stalls order by code`;
}

beforeEach(async () => {
  const sql = await getDb();
  await sql`truncate booking.audit_events, booking.reservations, booking.stalls, booking.zones`;
});

describe("inventory activation migration", () => {
  it("the approved variant is a valid inventory", () => {
    expect(validateInventory(header, approvedVariant()).errors).toEqual([]);
  });

  it("on an empty (production-like) database, inserts only the approved stalls, bookable", async () => {
    const sql = await getDb();
    await sql.unsafe(generateActivationMigrationSql(approvedVariant(), { sourceRef: "test.csv", approvalRef: APPROVAL }));
    const states = await stallStates();
    expect(states.map((s) => s.code)).toEqual(["PG-A01", "PG-A02", "PG-A03"]);
    expect(states.every((s) => s.inventory_status === "approved" && s.bookable && s.placed)).toBe(true);
    const [zone] = await sql`select inventory_status, source_ref from booking.zones where code = 'PG'`;
    expect(zone.inventory_status).toBe("approved");
    expect(zone.source_ref).toContain(APPROVAL);
  });

  it("on a database carrying the provisional seed (staging), upgrades only the approved stalls", async () => {
    const sql = await getDb();
    await sql.begin(async (tx) => {
      await tx`select set_config('isf.seed_environment', 'test', true)`;
      await tx.unsafe(generateProvisionalSeedSql(rows, { sourceRef: "seed.csv" }).replace(/^begin;$/m, "").replace(/^commit;$/m, ""));
    });
    await sql.unsafe(generateActivationMigrationSql(approvedVariant(), { sourceRef: "test.csv", approvalRef: APPROVAL }));

    const states = await stallStates();
    expect(states).toHaveLength(rows.length);
    expect(states.filter((s) => s.bookable).map((s) => s.code)).toEqual(["PG-A01", "PG-A02", "PG-A03"]);
    expect(states.filter((s) => s.inventory_status === "provisional")).toHaveLength(rows.length - 3);
  });

  it("is safe to apply twice", async () => {
    const sql = await getDb();
    const migration = generateActivationMigrationSql(approvedVariant(), { sourceRef: "test.csv", approvalRef: APPROVAL });
    await sql.unsafe(migration);
    await sql.unsafe(migration);
    expect((await stallStates()).filter((s) => s.bookable)).toHaveLength(3);
  });

  it("refuses without an approval reference, with nothing approved, or with an approved stall lacking coordinates", () => {
    expect(() => generateActivationMigrationSql(approvedVariant(), { sourceRef: "x", approvalRef: " " })).toThrow(/approval reference/);
    expect(() => generateActivationMigrationSql(rows, { sourceRef: "x", approvalRef: APPROVAL })).toThrow(/no rows are APPROVED/);
    const missing = approvedVariant().map((r) => (r.provisional_stall_code === "PG-A02" ? { ...r, x_ft: "" } : r));
    expect(() => generateActivationMigrationSql(missing, { sourceRef: "x", approvalRef: APPROVAL })).toThrow(/PG-A02: approved without coordinates/);
  });

  it("the provisional repository inventory itself has no approved stall (nothing can be activated by accident)", () => {
    expect(validateInventory(header, rows).summary.approved).toBe(0);
  });
});
