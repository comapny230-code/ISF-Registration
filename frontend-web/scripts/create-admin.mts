/**
 * Bootstrap or reset an administrator account (password sign-in, all four permissions).
 * Connects with the app's own settings (DATABASE_URL, APP_ENV, ...), so load the target
 * environment's variables in the shell first.
 *
 * The password is read from ADMIN_BOOTSTRAP_PASSWORD only, never from the command line, so it
 * does not end up in shell history or the process list:
 *
 *   ADMIN_BOOTSTRAP_PASSWORD='<at least 12 characters>' npm run db:create-admin -- <email> [displayName]
 *
 * An existing administrator gets the new password and is re-enabled; their sessions are revoked.
 */
import { closeDb, getDb } from "../lib/db.ts";
import { hashPassword } from "../lib/auth/password.ts";

const MIN_PASSWORD_LENGTH = 12; // same as the admin pages and API

const args = process.argv.slice(2);
const email = (args[0] || process.env.ADMIN_BOOTSTRAP_EMAIL || "").trim().toLowerCase();
const displayName = (args[1] || process.env.ADMIN_BOOTSTRAP_NAME || "Administrator").trim();
const password = process.env.ADMIN_BOOTSTRAP_PASSWORD || "";

if (args.length > 2) {
  console.error("Do not pass the password as an argument; set ADMIN_BOOTSTRAP_PASSWORD instead.");
  process.exit(1);
}
if (!email || !email.includes("@")) {
  console.error("Usage: ADMIN_BOOTSTRAP_PASSWORD='...' npm run db:create-admin -- <email> [displayName]");
  process.exit(1);
}
if (password.length < MIN_PASSWORD_LENGTH) {
  console.error(`ADMIN_BOOTSTRAP_PASSWORD must be at least ${MIN_PASSWORD_LENGTH} characters long.`);
  process.exit(1);
}

async function run() {
  const sql = await getDb();
  const passwordHash = hashPassword(password);

  console.log(`Configuring administrator account for: ${email}...`);

  const admin = await sql.begin(async (tx) => {
    const [row] = await tx`
      insert into app_auth.admin_users (email, display_name, password_hash, created_by)
      values (${email}, ${displayName}, ${passwordHash}, 'cli-bootstrap')
      on conflict (email) do update set
        password_hash = excluded.password_hash,
        display_name = excluded.display_name,
        status = 'active',
        disabled_at = null
      returning id, email, display_name, status`;

    await tx`
      insert into app_auth.admin_grants (admin_user_id, permission, granted_by)
      select ${row.id}, p.perm, 'cli-bootstrap'
        from (values ('booking.cancel'), ('inventory.manage'), ('teams.manage'), ('reports.view')) as p(perm)
      on conflict do nothing`;

    // A reset password must not leave sessions opened with the old one alive.
    await tx`
      update app_auth.sessions set revoked_at = now(), revoke_reason = 'password-reset-cli'
       where admin_user_id = ${row.id} and revoked_at is null`;
    return row;
  });

  console.log(`Administrator ready: ${admin.email} (${admin.display_name}) [ID: ${admin.id}]`);
  await closeDb();
}

run().catch(async (err) => {
  console.error("Failed to create administrator:", (err as Error)?.message ?? err);
  await closeDb();
  process.exit(1);
});
