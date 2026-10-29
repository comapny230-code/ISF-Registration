/**
 * Checks outgoing mail settings without touching any database.
 *
 *   npm run mail:check                                   # connect and sign in only
 *   npm run mail:check -- --send-to <address>            # also send one test email
 *   npm run mail:check -- --dns [--dkim-selector <sel>]  # also check the sender domain's SPF/DMARC/DKIM
 * Put the settings in the environment first (e.g. a git-ignored env file loaded by your shell).
 *
 * Uses the same rules as the app (lib/config.ts): outside production, --send-to must be on
 * MAIL_RECIPIENT_ALLOWLIST; in local/test, SMTP must be a local mail catcher. Never prints
 * SMTP_PASS. DNS checks are read-only lookups. Exit codes: 0 ok, 1 check failed, 2 usage or
 * configuration error.
 */
import { getAppEnv } from "../lib/config.ts";
import { sendMail, verifyMailTransport } from "../lib/mail.ts";
import { checkSenderDns } from "../lib/mail-dns.ts";

const USAGE = "usage: mail-check.mts [--send-to <address>] [--dns [--dkim-selector <selector>]]";
const args = process.argv.slice(2);
let sendTo: string | undefined;
let dns = false;
let dkimSelector: string | undefined;
for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === "--send-to" && args[i + 1] && !sendTo) sendTo = args[++i];
  else if (arg === "--dns") dns = true;
  else if (arg === "--dkim-selector" && args[i + 1] && /^[A-Za-z0-9._-]+$/.test(args[i + 1])) dkimSelector = args[++i];
  else {
    console.error(USAGE);
    process.exit(2);
  }
}
if (dkimSelector && !dns) {
  console.error(USAGE);
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

let failed = false;
if (dns) {
  try {
    for (const check of await checkSenderDns(process.env.NOTIFY_EMAIL_FROM ?? "", { dkimSelector })) {
      console.log(`${check.ok ? "OK  " : "FAIL"}  ${check.name}: ${check.detail}`);
      if (!check.ok) failed = true;
    }
    if (!dkimSelector) console.log("NOTE  DKIM not checked: pass --dkim-selector <selector> from your provider's DNS instructions");
  } catch (err) {
    console.error(`FAILED: DNS lookup error (${(err as any)?.code ?? "error"})`);
    failed = true;
  }
}

if (sendTo) {
  const sent = await sendMail({
    to: sendTo,
    subject: "Startup Jathara mail check",
    html: "<p>This is a test message from the Startup Jathara mail check. No action is needed.</p>",
  }).catch((err) => {
    console.error(`FAILED: ${(err as Error).message}`);
    process.exit(1);
  });
  if (!sent) {
    console.error(`NOT SENT: ${sendTo} is not a plain address or is not on MAIL_RECIPIENT_ALLOWLIST`);
    process.exit(1);
  }
  console.log(`OK  test message handed to the mail server for ${sendTo}; check that inbox (and spam)`);
}
process.exit(failed ? 1 : 0);
