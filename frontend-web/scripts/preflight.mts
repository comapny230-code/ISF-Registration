/**
 * Launch preflight: checks an environment's settings against every rule the app enforces at
 * startup, plus go-live warnings. Prints variable NAMES and problems only, never values.
 * Connects to nothing.
 *
 *   npm run preflight            (with the target environment's variables loaded in the shell)
 *
 * Exit codes: 0 ready (warnings may remain), 1 errors found.
 */
import { getAppEnv, getFeatureFlags, validateRuntimeConfig } from "../lib/config.ts";
import { senderDomain } from "../lib/mail-dns.ts";

const env = process.env;
let appEnv = "(invalid)";
try {
  appEnv = getAppEnv(env);
} catch {
  /* reported below */
}
console.log(`Preflight for APP_ENV=${appEnv}\n`);

const errors = validateRuntimeConfig(env);
for (const e of errors) console.log(`ERROR    ${e.message}`);

const warnings: string[] = [];
const dbUrl = env.DATABASE_URL ?? "";
try {
  const u = new URL(dbUrl);
  const user = decodeURIComponent(u.username).split(".")[0];
  if ((appEnv === "staging" || appEnv === "production") && user !== "isf_app") {
    warnings.push(`DATABASE_URL: the app should connect as the least-privilege role isf_app (currently '${user}'); see database/roles/isf_app_grants.sql`);
  }
} catch {
  /* invalid URL is already an error */
}
if ((appEnv === "staging" || appEnv === "production") && !/^https:\/\//.test(env.APP_ORIGIN ?? "")) {
  warnings.push("APP_ORIGIN: should be the site's https:// address");
}
if (!getFeatureFlags(env).registrationOpen) warnings.push("REGISTRATION_OPEN is not 'true': registration is PAUSED (form shows a notice; email codes and submissions are refused)");
if (!getFeatureFlags(env).bookingUi) warnings.push("FEATURE_BOOKING_UI is not 'true': the booking page and the post-registration booking step are hidden");
if ((appEnv === "staging" || appEnv === "production") && !env.NOTIFY_REPLY_TO) {
  warnings.push("NOTIFY_REPLY_TO is not set: replies to emails will go to the no-reply sender");
}
const fromDomain = senderDomain(env.NOTIFY_EMAIL_FROM ?? "");
if ((appEnv === "staging" || appEnv === "production") && fromDomain && /^(gmail|googlemail)\.com$/.test(fromDomain)) {
  warnings.push("NOTIFY_EMAIL_FROM is a Gmail address: about 500 recipients a day and more spam filtering; use a provider with your own domain for the event (docs/runbooks/email-provider.md)");
}
if (appEnv === "production" && env.REGISTRATION_MIN_FILL_SECONDS) {
  warnings.push("REGISTRATION_MIN_FILL_SECONDS is ignored in production (always 20 s); remove it");
}
if (appEnv === "production" && !env.TURNSTILE_SECRET_KEY?.trim()) {
  warnings.push("Turnstile human check is off (optional): registration relies on email codes, bot filters and daily organiser review");
}
for (const w of warnings) console.log(`WARNING  ${w}`);

console.log(
  `\n${errors.length} error(s), ${warnings.length} warning(s). ${errors.length === 0 ? "Settings are valid." : "Fix the errors before deploying."}`
);
console.log("Not checked here (needs the live systems): database reachability, migrations applied, mail delivery and sender DNS (npm run mail:check -- --dns).");
process.exit(errors.length === 0 ? 0 : 1);
