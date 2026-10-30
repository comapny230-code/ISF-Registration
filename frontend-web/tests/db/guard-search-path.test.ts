/**
 * DB-SEARCHPATH (0013): the booking guard trigger functions run with an empty search_path, and
 * still enforce their rules (every object they use is schema-qualified).
 */
import { describe, expect, it } from "vitest";
import { getDb } from "@/lib/db";
import { configureBooking, seedStalls } from "../support/booking";

describe("DB-SEARCHPATH guard functions", () => {
  it("pins search_path for every booking guard function", async () => {
    const sql = await getDb();
    const rows = await sql`
      select p.proname, p.proconfig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'booking' and p.proname in ('teams_guard', 'reservations_guard', 'audit_events_append_only', 'stalls_guard')
       order by p.proname`;
    expect(rows.map((r) => r.proname)).toEqual(["audit_events_append_only", "reservations_guard", "stalls_guard", "teams_guard"]);
    for (const r of rows) expect(r.proconfig, r.proname).toEqual(['search_path=""']);
  });

  it("still enforces stall identity and the inventory rules", async () => {
    await configureBooking();
    const [stall] = await seedStalls(1);
    const sql = await getDb();
    await expect(sql`update booking.stalls set code = 'PG-Z98' where id = ${stall.id}`).rejects.toMatchObject({ code: "BK003" });
    await expect(sql`update booking.stalls set inventory_status = 'provisional' where id = ${stall.id}`).rejects.toMatchObject({ code: "BK001" });
  });
});
