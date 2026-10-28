/** The generated provisional seed applies cleanly and never makes a stall bookable. */
import { readFileSync } from "node:fs";
import path from "node:path";
import postgres from "postgres";
import { describe, expect, it } from "vitest";
import { getDb } from "@/lib/db";

const seed = readFileSync(path.resolve(__dirname, "../../../database/seeds/dev_stall_inventory_provisional.sql"), "utf8");

/** Runs the seed as an operator would: a fresh single-connection session (SET does not leak into the app pool). */
async function runSeed(environment: string | null) {
  await getDb(); // the per-file database has already passed the guard via the app pool
  const session = postgres(process.env.TEST_DATABASE_URL!, { max: 1, onnotice: () => {} });
  try {
    if (environment) await session.unsafe(`set isf.seed_environment = '${environment}'`);
    await session.unsafe(seed);
  } finally {
    await session.end();
  }
}

describe("dev_stall_inventory_provisional.sql", () => {
  it("refuses to run unless isf.seed_environment is set to a non-production value", async () => {
    await expect(runSeed(null)).rejects.toThrow(/Refusing to seed provisional stalls/);
    await expect(runSeed("production")).rejects.toThrow(/Refusing to seed provisional stalls/);
    const sql = await getDb();
    const [count] = await sql`select count(*)::int as n from booking.stalls`;
    expect(count.n).toBe(0);
  });

  it("creates 107 provisional stalls in 3 zones, none bookable, and is idempotent", async () => {
    await runSeed("test");
    await runSeed("test");
    const sql = await getDb();
    const [row] = await sql`
      select count(*)::int as stalls,
             count(*) filter (where bookable)::int as bookable,
             count(*) filter (where x_ft is not null)::int as with_geometry,
             count(distinct zone_id)::int as zones
        from booking.stalls`;
    expect(row).toEqual({ stalls: 107, bookable: 0, with_geometry: 0, zones: 3 });
    const zones = await sql`select code, extent_width_ft::int as w, extent_depth_ft::int as d from booking.zones order by code`;
    expect(zones).toEqual([
      { code: "AG", w: null, d: null },
      { code: "BB", w: 101, d: 305 },
      { code: "PG", w: 338, d: 402 },
    ]);
  });
});
