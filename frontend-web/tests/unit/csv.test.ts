/** CSV-EXPORT: the admin registrations export cannot shift columns or run spreadsheet formulas. */
import { describe, expect, it } from "vitest";
import { csvCell } from "@/lib/csv";

describe("CSV-EXPORT csvCell", () => {
  it("quotes every cell and doubles embedded quotes, keeping commas and newlines inside the cell", () => {
    expect(csvCell("Team, A")).toBe('"Team, A"');
    expect(csvCell('He said "hi"')).toBe('"He said ""hi"""');
    expect(csvCell("line1\nline2")).toBe('"line1\nline2"');
    expect(csvCell(null)).toBe('""');
    expect(csvCell(3)).toBe('"3"');
  });

  it("neutralises formula starters so spreadsheets show them as text", () => {
    for (const evil of ["=HYPERLINK(\"http://x\",\"y\")", "+cmd|' /C calc'!A0", "-2+3", "@SUM(A1)", "\t=1", "\r=1"]) {
      expect(csvCell(evil).startsWith(`"'`), evil).toBe(true);
    }
    expect(csvCell("+919876543210")).toBe(`"'+919876543210"`);
    expect(csvCell("Normal Team")).toBe('"Normal Team"');
  });
});
