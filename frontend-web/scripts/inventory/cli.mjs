#!/usr/bin/env node
/**
 * Stall inventory CLI (docs/STALL_INVENTORY_PROVISIONAL.md §5).
 *
 *   node scripts/inventory/cli.mjs validate <inventory.csv>
 *   node scripts/inventory/cli.mjs seed     <inventory.csv> <out.sql>
 *   node scripts/inventory/cli.mjs preview  <inventory.csv> <out-dir>
 *   node scripts/inventory/cli.mjs activate <approved.csv> <out.sql> "<approval reference>"
 *     → a migration that activates only the rows marked APPROVED (with coordinates).
 *
 * Reads and writes local files only; never connects to a database.
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { generateActivationMigrationSql, generateProvisionalSeedSql, parseCsv, renderZonePreview, validateInventory } from "./inventory.mjs";

const [command, csvPath, out, approvalRef] = process.argv.slice(2);
if (!command || !csvPath || (command !== "validate" && !out) || (command === "activate" && !approvalRef)) {
  console.error('usage: cli.mjs validate <csv> | seed <csv> <out.sql> | preview <csv> <out-dir> | activate <csv> <out.sql> "<approval reference>"');
  process.exit(2);
}

const text = readFileSync(csvPath, "utf8");
const sha = createHash("sha256").update(text).digest("hex");
const { header, rows } = parseCsv(text);
const report = validateInventory(header, rows);

console.log(`inventory: ${path.basename(csvPath)} sha256:${sha.slice(0, 16)}`);
console.log(JSON.stringify(report.summary));
for (const w of report.warnings) console.log(`WARNING ${w}`);
for (const e of report.errors) console.error(`ERROR ${e}`);
if (report.errors.length > 0) process.exit(1);

if (command === "seed") {
  writeFileSync(out, generateProvisionalSeedSql(rows, { sourceRef: `${path.basename(csvPath)} sha256:${sha.slice(0, 16)}` }));
  console.log(`wrote ${out}`);
} else if (command === "activate") {
  try {
    writeFileSync(out, generateActivationMigrationSql(rows, { sourceRef: `${path.basename(csvPath)} sha256:${sha.slice(0, 16)}`, approvalRef }));
  } catch (err) {
    console.error(`ERROR ${err.message}`);
    process.exit(1);
  }
  console.log(`wrote ${out} (review it, then apply with scripts/migrate.mts)`);
} else if (command === "preview") {
  mkdirSync(out, { recursive: true });
  for (const zone of [...new Set(rows.map((r) => r.zone_code))]) {
    const file = path.join(out, `zone-${zone}.svg`);
    writeFileSync(file, renderZonePreview(rows, zone));
    console.log(`wrote ${file}`);
  }
} else if (command !== "validate") {
  console.error(`unknown command ${command}`);
  process.exit(2);
}
