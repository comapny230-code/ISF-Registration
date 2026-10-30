/**
 * One CSV cell for spreadsheet export: always quoted (commas, quotes and newlines in user text
 * cannot shift columns), and text starting with = + - @ or a tab/CR is prefixed with ' so
 * spreadsheet programs do not run it as a formula (CSV injection).
 */
export function csvCell(value: unknown): string {
  let text = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}
