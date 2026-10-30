/**
 * DB-RESET: database/reset_database.sql deletes every table. It must refuse to run unless the
 * operator has explicitly confirmed in the same session, and a refusal must change nothing.
 * (On 2026-10-29 a reset was run against the live project and all registrations were lost.)
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { getDb } from "@/lib/db";

const script = readFileSync(path.resolve(__dirname, "../../../database/reset_database.sql"), "utf8");

describe("DB-RESET reset script guard", () => {
  it("refuses without confirmation and leaves every schema in place", async () => {
    const sql = await getDb();
    await expect(sql.unsafe(script).simple()).rejects.toThrow(/reset_database\.sql refused/);
    const [row] = await sql`select to_regclass('booking.reservations') as r, to_regclass('public.user_accounts') as u`;
    expect(row.r).not.toBeNull();
    expect(row.u).not.toBeNull();
  });

  it("seeds no administrator password and no approved stalls", () => {
    for (const file of ["reset_database.sql", "schema.sql"]) {
      const text = readFileSync(path.resolve(__dirname, "../../../database", file), "utf8");
      expect(text).not.toMatch(/[0-9a-f]{32}:[0-9a-f]{128}/);
      expect(text).not.toMatch(/'approved', '(master|pdf-map)'/);
    }
  });
});
