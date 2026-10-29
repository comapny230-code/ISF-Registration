#!/usr/bin/env node
/**
 * ISF Startup Jathara — Database Setup & Verification Runner
 *
 * Usage:
 *   node scripts/db-setup.mjs                  # Uses DATABASE_URL from .env.local
 *   node scripts/db-setup.mjs --url <conn-str> # Uses specified PostgreSQL connection URL
 *   node scripts/db-setup.mjs --verify-only    # Only verify tables and inventory
 */
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "../..");
const schemaPath = path.join(root, "database/schema.sql");
const envLocalPath = path.resolve(__dirname, "../.env.local");

// Parse arguments
const args = process.argv.slice(2);
let customUrl = null;
let verifyOnly = false;

for (let i = 0; i < args.length; i++) {
  if (args[i] === "--url" && args[i + 1]) {
    customUrl = args[++i];
  } else if (args[i] === "--verify-only") {
    verifyOnly = true;
  }
}

// Read DATABASE_URL from environment or .env.local
let dbUrl = customUrl || process.env.DATABASE_URL;
if (!dbUrl && existsSync(envLocalPath)) {
  const content = readFileSync(envLocalPath, "utf8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("DATABASE_URL=")) {
      dbUrl = trimmed.slice("DATABASE_URL=".length).trim();
      break;
    }
  }
}

if (!dbUrl) {
  console.error("❌ ERROR: DATABASE_URL is not set in environment or frontend-web/.env.local");
  process.exit(1);
}

// Mask password for display
const maskedUrl = dbUrl.replace(/:([^:@]+)@/, ":****@");
console.log(`\n======================================================`);
console.log(`🚀 ISF STARTUP JATHARA 2026 — DATABASE SETUP`);
console.log(`Connecting to: ${maskedUrl}`);
console.log(`======================================================\n`);

const sql = postgres(dbUrl, {
  prepare: false,
  max: 1,
  connect_timeout: 10,
});

async function main() {
  try {
    // Test connectivity
    const [ver] = await sql`select version() as ver`;
    console.log(`✅ Connected to PostgreSQL: ${ver.ver.split(" ").slice(0, 2).join(" ")}`);

    if (!verifyOnly) {
      console.log(`\nApplying unified schema from database/schema.sql...`);
      const schemaSql = readFileSync(schemaPath, "utf8");
      await sql.unsafe(schemaSql);
      console.log(`✅ Master schema, triggers, and inventory applied successfully.`);
    }

    // Verify schemas and tables
    console.log(`\nVerifying database state:`);

    const tables = await sql`
      select table_schema, table_name
        from information_schema.tables
       where table_schema in ('public', 'app_auth', 'booking')
         and table_type = 'BASE TABLE'
       order by table_schema, table_name;
    `;

    console.log(`\nFound ${tables.length} tables across public, app_auth, and booking:`);
    for (const t of tables) {
      console.log(`  • ${t.table_schema}.${t.table_name}`);
    }

    // Verify Zones & Stalls
    const [zoneCount] = await sql`select count(*)::int as count from booking.zones where edition_id = 2026`;
    const [stallCount] = await sql`select count(*)::int as total, count(*) filter (where bookable)::int as bookable from booking.stalls where edition_id = 2026`;
    const [settings] = await sql`select booking_enabled, hold_seconds, eligible_tracks, require_team_approval from booking.settings where edition_id = 2026`;

    console.log(`\n📊 Stall Booking Summary (Edition 2026):`);
    console.log(`  • Active Zones:      ${zoneCount?.count ?? 0} (Play Ground, Basketball Ground, Outside Agricultural Gate)`);
    console.log(`  • Total Stalls:      ${stallCount?.total ?? 0}`);
    console.log(`  • Bookable Stalls:   ${stallCount?.bookable ?? 0}`);
    console.log(`  • Booking Enabled:   ${settings?.booking_enabled ? "YES" : "NO"}`);
    console.log(`  • Hold Window:       ${settings?.hold_seconds ?? 300} seconds (5 min)`);
    console.log(`  • Eligible Tracks:   ${(settings?.eligible_tracks || []).join(", ")}`);
    console.log(`  • Team Approval Req: ${settings?.require_team_approval ? "YES" : "NO"}`);

    console.log(`\n🎉 Database setup & verification completed successfully!`);
    await sql.end();
    process.exit(0);
  } catch (err) {
    console.error(`\n❌ Database setup error:`, err.message);
    await sql.end({ timeout: 1 });
    process.exit(1);
  }
}

main();
