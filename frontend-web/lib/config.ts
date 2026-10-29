/**
 * Runtime configuration (docs/STALL_BOOKING_FINAL_SPEC.md §8.4).
 *
 * Every getter reads process.env lazily so `next build` never needs secrets.
 * There are no defaults for secrets: anything missing or unsafe throws ConfigError,
 * which route handlers turn into a 503 without exposing details.
 */
import { assertTestEnvironmentPreConnect } from "./safety/test-database-guard";

export type AppEnv = "local" | "test" | "staging" | "production";
const APP_ENVS: readonly AppEnv[] = ["local", "test", "staging", "production"];

type Env = Record<string, string | undefined>;

export class ConfigError extends Error {
  constructor(readonly variable: string, message: string) {
    super(`[config] ${variable}: ${message}`);
    this.name = "ConfigError";
  }
}

function required(env: Env, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new ConfigError(name, "is required");
  return value;
}

function optional(env: Env, name: string): string | undefined {
  const value = env[name]?.trim();
  return value ? value : undefined;
}

function list(env: Env, name: string): string[] {
  return (env[name] || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function getAppEnv(env: Env = process.env): AppEnv {
  const value = required(env, "APP_ENV") as AppEnv;
  if (!APP_ENVS.includes(value)) {
    throw new ConfigError("APP_ENV", `must be one of ${APP_ENVS.join(", ")}`);
  }
  return value;
}

function isLocalHost(host: string): boolean {
  const h = host.toLowerCase();
  return h === "localhost" || h === "127.0.0.1" || h === "::1" || h === "[::1]" || /^[a-z0-9-]+$/.test(h);
}

// ---------------------------------------------------------------------------
// Database
// ---------------------------------------------------------------------------

export interface DatabaseConfig {
  url: string;
  ssl: false | { ca: string; rejectUnauthorized: true };
  /** Set only for APP_ENV=test: the database name the post-connect guard must see. */
  testDatabase?: string;
}

function normalizePem(value: string): string {
  return value.includes("\\n") ? value.replace(/\\n/g, "\n") : value;
}

export function getDatabaseConfig(env: Env = process.env): DatabaseConfig {
  const appEnv = getAppEnv(env);

  if (appEnv === "test") {
    // Never DATABASE_URL in tests: the guard requires it to be unset.
    const guarded = assertTestEnvironmentPreConnect(env);
    return { url: guarded.url, ssl: false, testDatabase: guarded.database };
  }

  const url = required(env, "DATABASE_URL");
  if (!/^postgres(ql)?:\/\//i.test(url)) {
    throw new ConfigError("DATABASE_URL", "must be a postgres:// or postgresql:// URL");
  }

  if (appEnv !== "production") {
    const denylist = list(env, "PRODUCTION_DB_DENYLIST");
    if (denylist.length === 0) {
      throw new ConfigError("PRODUCTION_DB_DENYLIST", "is required outside production");
    }
    const lowered = url.toLowerCase();
    if (denylist.some((entry) => lowered.includes(entry.toLowerCase()))) {
      throw new ConfigError("DATABASE_URL", "points at a production database outside APP_ENV=production");
    }
  }

  const ca = optional(env, "DATABASE_CA_CERT");
  if ((appEnv === "staging" || appEnv === "production") && !ca) {
    throw new ConfigError("DATABASE_CA_CERT", "is required in staging and production (TLS must be verified)");
  }

  return { url, ssl: ca ? { ca: normalizePem(ca), rejectUnauthorized: true } : false };
}

// ---------------------------------------------------------------------------
// Mail
// ---------------------------------------------------------------------------

export interface MailConfig {
  transport: "smtp" | "log";
  from: string;
  replyTo?: string;
  smtp?: { host: string; port: number; secure: boolean; auth?: { user: string; pass: string } };
  /** null in production; otherwise only matching recipients receive mail. */
  recipientAllowlist: string[] | null;
}

export function getMailConfig(env: Env = process.env): MailConfig {
  const appEnv = getAppEnv(env);
  const transport = (optional(env, "MAIL_TRANSPORT") || "smtp") as MailConfig["transport"];
  if (transport !== "smtp" && transport !== "log") {
    throw new ConfigError("MAIL_TRANSPORT", "must be 'smtp' or 'log'");
  }
  if (transport === "log" && (appEnv === "staging" || appEnv === "production")) {
    throw new ConfigError("MAIL_TRANSPORT", "'log' is only allowed in local and test");
  }

  const from = required(env, "NOTIFY_EMAIL_FROM");
  const replyTo = optional(env, "NOTIFY_REPLY_TO");

  const allowlist = list(env, "MAIL_RECIPIENT_ALLOWLIST");
  if (appEnv === "production") {
    if (allowlist.length > 0) {
      throw new ConfigError("MAIL_RECIPIENT_ALLOWLIST", "must be unset in production");
    }
  } else if (allowlist.length === 0) {
    throw new ConfigError("MAIL_RECIPIENT_ALLOWLIST", "is required outside production");
  }

  let smtp: MailConfig["smtp"];
  if (transport === "smtp") {
    const host = required(env, "SMTP_HOST");
    const port = Number(required(env, "SMTP_PORT"));
    if (!Number.isInteger(port) || port <= 0 || port > 65535) {
      throw new ConfigError("SMTP_PORT", "must be a valid port number");
    }
    const user = optional(env, "SMTP_USER");
    const pass = optional(env, "SMTP_PASS");
    if ((appEnv === "staging" || appEnv === "production") && (!user || !pass)) {
      throw new ConfigError(user ? "SMTP_PASS" : "SMTP_USER", "is required in staging and production");
    }
    if (Boolean(user) !== Boolean(pass)) {
      throw new ConfigError(user ? "SMTP_PASS" : "SMTP_USER", "SMTP_USER and SMTP_PASS must be set together");
    }
    if ((appEnv === "local" || appEnv === "test") && !isLocalHost(host)) {
      throw new ConfigError("SMTP_HOST", "must be a local mail catcher in local and test");
    }
    smtp = {
      host,
      port,
      secure: port === 465,
      auth: user && pass ? { user, pass: pass.replace(/\s+/g, "") } : undefined,
    };
  }

  return { transport, from, replyTo, smtp, recipientAllowlist: appEnv === "production" ? null : allowlist };
}

// ---------------------------------------------------------------------------
// ImageKit
// ---------------------------------------------------------------------------

export interface ImageKitConfig {
  privateKey: string;
  folder: string;
}

/** Returns null when uploads are disabled (local/test without a key). */
export function getImageKitConfig(env: Env = process.env): ImageKitConfig | null {
  const appEnv = getAppEnv(env);
  const privateKey = optional(env, "IMAGEKIT_PRIVATE_KEY");
  if (!privateKey) {
    if (appEnv === "staging" || appEnv === "production") {
      throw new ConfigError("IMAGEKIT_PRIVATE_KEY", "is required in staging and production");
    }
    return null;
  }
  if (appEnv === "test") {
    throw new ConfigError("IMAGEKIT_PRIVATE_KEY", "must be unset in test");
  }
  return { privateKey, folder: optional(env, "IMAGEKIT_FOLDER") || "/isf_registrations" };
}

// ---------------------------------------------------------------------------
// Authentication
// ---------------------------------------------------------------------------

export interface AuthConfig {
  /** HMAC key for one-time login codes. */
  otpPepper: string;
  /** HMAC key for rate-limit bucket names (so no raw email/IP is stored). */
  rateLimitKey: string;
  /** Origins allowed to send state-changing requests. The first is canonical. */
  allowedOrigins: string[];
}

const MIN_KEY_LENGTH = 32;

function origin(name: string, value: string, requireHttps: boolean): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new ConfigError(name, "must be an absolute origin such as https://register.example.org");
  }
  if (parsed.origin !== value.replace(/\/$/, "")) {
    throw new ConfigError(name, "must be an origin without a path");
  }
  if (requireHttps && parsed.protocol !== "https:") {
    throw new ConfigError(name, "must use https in staging and production");
  }
  return parsed.origin;
}

export function getAuthConfig(env: Env = process.env): AuthConfig {
  const appEnv = getAppEnv(env);
  const deployed = appEnv === "staging" || appEnv === "production";

  const otpPepper = required(env, "OTP_PEPPER");
  if (otpPepper.length < MIN_KEY_LENGTH) throw new ConfigError("OTP_PEPPER", `must be at least ${MIN_KEY_LENGTH} characters`);
  const rateLimitKey = required(env, "RATE_LIMIT_HASH_KEY");
  if (rateLimitKey.length < MIN_KEY_LENGTH) {
    throw new ConfigError("RATE_LIMIT_HASH_KEY", `must be at least ${MIN_KEY_LENGTH} characters`);
  }
  if (rateLimitKey === otpPepper) throw new ConfigError("RATE_LIMIT_HASH_KEY", "must differ from OTP_PEPPER");

  const allowedOrigins = [origin("APP_ORIGIN", required(env, "APP_ORIGIN"), deployed)];
  const extra = list(env, "APP_EXTRA_ORIGINS");
  if (extra.length > 0) {
    if (appEnv === "production") throw new ConfigError("APP_EXTRA_ORIGINS", "must be unset in production");
    allowedOrigins.push(...extra.map((value) => origin("APP_EXTRA_ORIGINS", value, deployed)));
  }

  return { otpPepper, rateLimitKey, allowedOrigins };
}

// ---------------------------------------------------------------------------
// Booking
// ---------------------------------------------------------------------------

export interface BookingConfig {
  /** Key id used to sign new hold tokens. */
  currentKeyId: string;
  /** All keys accepted for verification (current + previous during rotation). */
  holdTokenKeys: Map<string, string>;
}

/** HOLD_TOKEN_KEYS = "kid:secret[,kid:secret...]"; the first entry signs new tokens. */
export function getBookingConfig(env: Env = process.env): BookingConfig {
  getAppEnv(env);
  const entries = list(env, "HOLD_TOKEN_KEYS");
  if (entries.length === 0) throw new ConfigError("HOLD_TOKEN_KEYS", "is required");
  const keys = new Map<string, string>();
  for (const entry of entries) {
    const index = entry.indexOf(":");
    const kid = index > 0 ? entry.slice(0, index) : "";
    const secret = index > 0 ? entry.slice(index + 1) : "";
    if (!/^[a-z0-9]{1,8}$/.test(kid)) throw new ConfigError("HOLD_TOKEN_KEYS", "key ids must be 1-8 lower-case letters or digits");
    if (secret.length < MIN_KEY_LENGTH) throw new ConfigError("HOLD_TOKEN_KEYS", `each secret must be at least ${MIN_KEY_LENGTH} characters`);
    if (keys.has(kid)) throw new ConfigError("HOLD_TOKEN_KEYS", "key ids must be unique");
    keys.set(kid, secret);
  }
  return { currentKeyId: [...keys.keys()][0], holdTokenKeys: keys };
}

// ---------------------------------------------------------------------------
// Feature flags (read without requiring the rest of the configuration so that
// static pages still build; booking APIs enforce their own configuration).
// ---------------------------------------------------------------------------

export function getFeatureFlags(env: Env = process.env): { bookingUi: boolean } {
  return { bookingUi: env.FEATURE_BOOKING_UI?.trim() === "true" };
}

// ---------------------------------------------------------------------------
// Optional Cloudflare Turnstile on registration
// ---------------------------------------------------------------------------

export interface CaptchaConfig {
  /** Server secret; null = the human check is off. */
  secretKey: string | null;
  /** Public site key sent to the form (via the form-token endpoint). */
  siteKey: string | null;
}

export function getCaptchaConfig(env: Env = process.env): CaptchaConfig {
  const secretKey = optional(env, "TURNSTILE_SECRET_KEY") || null;
  const siteKey = optional(env, "TURNSTILE_SITE_KEY") || null;
  if (Boolean(secretKey) !== Boolean(siteKey)) {
    throw new ConfigError(secretKey ? "TURNSTILE_SITE_KEY" : "TURNSTILE_SECRET_KEY", "TURNSTILE_SECRET_KEY and TURNSTILE_SITE_KEY must be set together");
  }
  return { secretKey, siteKey };
}

/** Validates every section; used at startup to log misconfiguration early. */
export function validateRuntimeConfig(env: Env = process.env): ConfigError[] {
  const errors: ConfigError[] = [];
  for (const check of [getAppEnv, getDatabaseConfig, getMailConfig, getImageKitConfig, getAuthConfig, getBookingConfig, getCaptchaConfig]) {
    try {
      check(env);
    } catch (err) {
      if (err instanceof ConfigError) errors.push(err);
      else errors.push(new ConfigError("unknown", err instanceof Error ? err.message : String(err)));
    }
  }
  return errors;
}
