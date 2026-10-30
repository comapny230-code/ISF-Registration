import { describe, expect, it } from "vitest";
import { sanitizeCsvCell } from "@/lib/csv";

describe("CSV spreadsheet formula sanitization (CWE-1236)", () => {
  it("prefixes dangerous formula trigger characters with a single quote", () => {
    expect(sanitizeCsvCell("=CMD('calc')")).toBe(`"'=CMD('calc')\"`);
    expect(sanitizeCsvCell("+1+2")).toBe(`"'+1+2\"`);
    expect(sanitizeCsvCell("-1-2")).toBe(`"'-1-2\"`);
    expect(sanitizeCsvCell("@SUM(A1:A10)")).toBe(`"'@SUM(A1:A10)\"`);
    expect(sanitizeCsvCell("\tTAB_FORMULA")).toBe(`"'\tTAB_FORMULA\"`);
    expect(sanitizeCsvCell("\rCR_FORMULA")).toBe(`"'\rCR_FORMULA\"`);
  });

  it("safely escapes embedded double quotes", () => {
    expect(sanitizeCsvCell('Team "Superstar"')).toBe(`"Team ""Superstar"""`);
    expect(sanitizeCsvCell('=HYPERLINK("http://attacker.com")')).toBe(`"'=HYPERLINK(""http://attacker.com"")\"`);
  });

  it("handles null, undefined, numbers and safe strings", () => {
    expect(sanitizeCsvCell(null)).toBe('""');
    expect(sanitizeCsvCell(undefined)).toBe('""');
    expect(sanitizeCsvCell(42)).toBe('"42"');
    expect(sanitizeCsvCell("Normal Team Name")).toBe('"Normal Team Name"');
  });
});
