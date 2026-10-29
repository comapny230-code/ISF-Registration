export type InventoryRow = Record<string, string>;

export interface ZoneInfo {
  name: string;
  extentWidthFt: number | null;
  extentDepthFt: number | null;
  landmarks: Array<{ label: string; kind: string }>;
}

export const REQUIRED_COLUMNS: string[];
export const ZONES: Record<string, ZoneInfo>;

export function parseCsv(text: string): { header: string[]; rows: InventoryRow[] };
export function stallPolygon(row: InventoryRow): Array<[number, number]>;
export function polygonsOverlap(a: Array<[number, number]>, b: Array<[number, number]>, epsilon?: number): boolean;
export function validateInventory(
  header: string[],
  rows: InventoryRow[]
): {
  errors: string[];
  warnings: string[];
  summary: { stalls: number; byZone: Record<string, number>; withCoordinates: number; approved: number; bookable: number };
};
export function generateProvisionalSeedSql(rows: InventoryRow[], options: { sourceRef: string }): string;
export function generateActivationMigrationSql(rows: InventoryRow[], options: { sourceRef: string; approvalRef: string }): string;
export function renderZonePreview(rows: InventoryRow[], zoneCode: string): string;
