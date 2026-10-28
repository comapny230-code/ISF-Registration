/** Inventory tooling (docs/STALL_INVENTORY_PROVISIONAL.md §5). */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  generateProvisionalSeedSql,
  parseCsv,
  polygonsOverlap,
  renderZonePreview,
  stallPolygon,
  validateInventory,
  type InventoryRow,
} from "../../scripts/inventory/inventory.mjs";

const csvPath = path.resolve(__dirname, "../../../docs/stall_inventory_provisional.csv");
const { header, rows } = parseCsv(readFileSync(csvPath, "utf8"));

const base = (over: Partial<InventoryRow> = {}): InventoryRow => ({
  provisional_stall_code: "PG-A01", zone_code: "PG", zone_name: "Play Ground", run_code: "PG-A", index_in_run: "1",
  run_count_in_source: "1", intended_position: "", width_ft: "10", depth_ft: "10", x_ft: "", y_ft: "", rotation_deg: "",
  facing: "", source_evidence: "", count_confidence: "high", position_confidence: "", approval_status: "PROVISIONAL - NOT APPROVED",
  bookable: "false", ...over,
});

describe("the committed provisional inventory", () => {
  it("is valid, has 107 stalls, no coordinates and nothing bookable", () => {
    const report = validateInventory(header, rows);
    expect(report.errors).toEqual([]);
    expect(report.summary).toEqual({ stalls: 107, byZone: { PG: 48, BB: 53, AG: 6 }, withCoordinates: 0, approved: 0, bookable: 0 });
  });

  it("surfaces the Basketball Ground source conflict as a warning", () => {
    expect(validateInventory(header, rows).warnings).toEqual(["BB-B: CONFLICT: DOCX 28 vs PDF 25"]);
  });
});

describe("CSV parsing", () => {
  it("handles quoted commas, escaped quotes and CRLF", () => {
    const parsed = parseCsv('a,b\r\n"x, y","say ""hi"""\r\n');
    expect(parsed.rows).toEqual([{ a: "x, y", b: 'say "hi"' }]);
  });
});

describe("validation rules", () => {
  const check = (list: InventoryRow[]) => validateInventory(Object.keys(base()), list).errors;

  it("rejects bad codes, duplicates and wrong prefixes", () => {
    expect(check([base({ provisional_stall_code: "PG-1" })])[0]).toMatch(/AA-A00/);
    expect(check([base(), base()]).join()).toMatch(/duplicate code/);
    expect(check([base({ provisional_stall_code: "BB-A01" })]).join()).toMatch(/prefix/);
  });

  it("requires each run to be numbered 1..n matching its declared count", () => {
    expect(check([base({ run_count_in_source: "2" })]).join()).toMatch(/expected stalls 1..2/);
    expect(check([base({ provisional_stall_code: "PG-A02", index_in_run: "2" })]).join()).toMatch(/expected stalls 1..1/);
  });

  it("requires complete coordinates, and coordinates before approval", () => {
    expect(check([base({ x_ft: "1" })]).join()).toMatch(/all set or all blank/);
    expect(check([base({ approval_status: "APPROVED by X" })]).join()).toMatch(/needs surveyed coordinates/);
    expect(check([base({ bookable: "true" })]).join()).toMatch(/must have bookable=false/);
    expect(check([base({ x_ft: "1", y_ft: "1", rotation_deg: "360" })]).join()).toMatch(/rotation_deg/);
  });

  it("detects overlapping and out-of-zone stalls, including rotated ones", () => {
    const a = base({ x_ft: "0", y_ft: "0", rotation_deg: "0", run_count_in_source: "2" });
    const overlapping = base({ provisional_stall_code: "PG-A02", index_in_run: "2", run_count_in_source: "2", x_ft: "5", y_ft: "5", rotation_deg: "0" });
    const touching = base({ provisional_stall_code: "PG-A02", index_in_run: "2", run_count_in_source: "2", x_ft: "10", y_ft: "0", rotation_deg: "0" });
    expect(check([a, overlapping]).join()).toMatch(/PG-A01 overlaps PG-A02/);
    expect(check([a, touching])).toEqual([]);
    expect(check([base({ x_ft: "335", y_ft: "0", rotation_deg: "0" })]).join()).toMatch(/outside zone PG/);
    expect(polygonsOverlap(stallPolygon(base({ x_ft: "20", y_ft: "0", rotation_deg: "90" })), stallPolygon(base({ x_ft: "12", y_ft: "2", rotation_deg: "0" })))).toBe(true);
  });
});

describe("seed and previews", () => {
  it("generates a guarded, provisional-only seed", () => {
    const sql = generateProvisionalSeedSql(rows, { sourceRef: "test" });
    expect(sql).toMatch(/current_setting\('isf\.seed_environment', true\)/);
    expect(sql).toMatch(/Never run this in production/);
    expect((sql.match(/^ {4}\('/gm) ?? []).length).toBe(107);
    expect(sql).not.toMatch(/'approved'/);
    expect(sql).not.toMatch(/x_ft|y_ft|rotation_deg/);
  });

  it("matches the committed seed file (regenerate with the CLI after editing the CSV)", () => {
    const committed = readFileSync(path.resolve(__dirname, "../../../database/seeds/dev_stall_inventory_provisional.sql"), "utf8");
    const sourceRef = committed.match(/^-- Source: (.+)$/m)![1];
    expect(generateProvisionalSeedSql(rows, { sourceRef })).toBe(committed);
  });

  it("labels zones without coordinates as a not-to-scale schematic and escapes text", () => {
    const svg = renderZonePreview(rows, "BB");
    expect(svg).toMatch(/SCHEMATIC – NOT TO SCALE/);
    expect(svg).toMatch(/BB-B – 28 stalls \(CONFLICT: DOCX 28 vs PDF 25\)/);
    const evil = renderZonePreview([base({ intended_position: "<script>x</script>" })], "PG");
    expect(evil).not.toContain("<script>");
  });

  it("draws to scale only when every stall has coordinates", () => {
    const placed = [base({ x_ft: "0", y_ft: "0", rotation_deg: "0" })];
    expect(renderZonePreview(placed, "PG")).toMatch(/to scale, 338 × 402 ft/);
  });
});
