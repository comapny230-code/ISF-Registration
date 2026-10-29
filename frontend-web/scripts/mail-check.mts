/**
 * Checks outgoing mail settings without touching any database.
 *
 *   npm run mail:check                          # connect and sign in only
 *   npm run mail:check -- --send-to <address>   # also send one test email
 * Put the settings in the environment first (e.g. a git-ignored env file loaded by your shell).
 *
 * Uses the same rules as the app (lib/config.ts): outside production, --send-to must be on
 * MAIL_RECIPIENT_ALLOWLIST; in local/test, SMTP must be a local mail catcher. Never prints
 * SMTP_PASS. Exit codes: 0 ok, 1 check failed, 2 usage or configuration error.
 */
import { getAppEnv } from "../lib/config.ts";
import { sendMail, verifyMailTransport } from "../lib/mail.ts";

const args = process.argv.slice(2);
const sendTo = args[0] === "--send-to" ? args[1] : undefined;
if ((args.length > 0 && !sendTo) || args.length > 2) {
  console.error("usage: mail-check.mts [--send-to <address>]");
  process.exit(2);
}

let appEnv: string;
try {
  appEnv = getAppEnv();
} catch (err) {
  console.error(`configuration error: ${(err as Error).message}`);
  process.exit(2);
}
console.log(`APP_ENV=${appEnv}`);

try {
  const result = await verifyMailTransport();
  console.log(`OK  ${result.detail}`);
} catch (err) {
  const e = err as Error;
  console.error(`${e.name === "ConfigError" ? "configuration error" : "FAILED"}: ${e.message}`);
  process.exit(e.name === "ConfigError" ? 2 : 1);
}

if (sendTo) {
  const sent = await sendMail({
    to: sendTo,
    subject: "Startup Jathara mail check",
    html: "<p>This is a test message from the Startup Jathara mail check. No action is needed.</p>",
  });
  if (!sent) {
    console.error(`NOT SENT: ${sendTo} is not a plain address or is not on MAIL_RECIPIENT_ALLOWLIST`);
    process.exit(1);
  }
  console.log(`OK  test message handed to the mail server for ${sendTo}; check that inbox (and spam)`);
}
