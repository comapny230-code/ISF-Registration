/**
 * CLI utility to safely bootstrap or reset an administrator account.
 * Credentials are provided via CLI arguments or environment variables and
 * never committed to source control.
 *
 * Usage:
 *   npx tsx scripts/create-admin.mts <email> <password> [displayName]
 */
import { getDb, closeDb } from "../lib/db.ts";
import { hashPassword } from "../lib/auth/password.ts";

const args = process.argv.slice(2);
const email = (args[0] || process.env.ADMIN_BOOTSTRAP_EMAIL || "").trim().toLowerCase();
const password = args[1] || process.env.ADMIN_BOOTSTRAP_PASSWORD || "";
const displayName = (args[2] || process.env.ADMIN_BOOTSTRAP_NAME || "Administrator").trim();

if (!email || !email.includes("@")) {
  console.error("❌ Usage: npx tsx scripts/create-admin.mts <email> <password> [displayName]");
  process.exit(1);
}

if (!password || password.length < 8) {
  console.error("❌ Password must be at least 8 characters long.");
  process.exit(1);
}

async function run() {
  const sql = await getDb();
  const passwordHash = hashPassword(password);

  console.log(`Configuring administrator account for: ${email}...`);

  const [admin] = await sql`
    insert into app_auth.admin_users (email, display_name, password_hash, created_by)
    values (${email}, ${displayName}, ${passwordHash}, 'cli-bootstrap')
    on conflict (email) do update set
      password_hash = excluded.password_hash,
      display_name = excluded.display_name,
      status = 'active'
    returning id, email, display_name, status;
  `;

  await sql`
    insert into app_auth.admin_grants (admin_user_id, permission, granted_by)
    select ${admin.id}, p.perm, 'cli-bootstrap'
      from (values ('booking.cancel'), ('inventory.manage'), ('teams.manage'), ('reports.view')) as p(perm)
    on conflict do nothing;
  `;

  console.log(`✅ Administrator ready: ${admin.email} (${admin.display_name}) [ID: ${admin.id}]`);
  await closeDb();
}

run().catch(async (err) => {
  console.error("❌ Failed to create administrator:", err);
  await closeDb();
  process.exit(1);
});
