/**
 * Neutralises CSV / Formula injection (CWE-1236) when data is exported
 * to spreadsheets (Excel, Google Sheets, LibreOffice Calc).
 *
 * If a cell begins with '=', '+', '-', '@', tab, or carriage return,
 * prepend a single quote so the spreadsheet engine interprets the cell
 * strictly as plain text instead of executing macros/formulas.
 */
export function sanitizeCsvCell(value: unknown): string {
  if (value === null || value === undefined) return '""';
  const str = String(value);
  const safeStr = /^[=+\-@\t\r]/.test(str) ? `'${str}` : str;
  return `"${safeStr.replace(/"/g, '""')}"`;
}
