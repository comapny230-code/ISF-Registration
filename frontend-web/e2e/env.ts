/** Settings for the end-to-end server. Non-secret, test-only values. */
export const E2E_PORT = 3100;
export const E2E_ORIGIN = `http://localhost:${E2E_PORT}`;
export const E2E_DATABASE = "isf_test_e2e";

export const E2E_ENV = {
  NODE_ENV: "test",
  APP_ENV: "test",
  PRODUCTION_DB_DENYLIST: "ddrremsyzozutyxbxigf",
  MAIL_TRANSPORT: "log",
  NOTIFY_EMAIL_FROM: "ISF Test <no-reply@example.test>",
  MAIL_RECIPIENT_ALLOWLIST: "@example.test",
  APP_ORIGIN: E2E_ORIGIN,
  OTP_PEPPER: "e2e-otp-pepper-0123456789abcdef012345",
  RATE_LIMIT_HASH_KEY: "e2e-rate-limit-key-0123456789abcdef01",
  HOLD_TOKEN_KEYS: "e2e:e2e-hold-token-key-0123456789abcdef0",
  FEATURE_BOOKING_UI: "true",
  REGISTRATION_MIN_FILL_SECONDS: "0",
};

/** The guarded e2e database on the developer-supplied local test server. */
export function e2eDatabaseUrl(): string {
  const base = process.env.TEST_DATABASE_URL;
  if (!base) throw new Error("TEST_DATABASE_URL is required (see tests/README.md).");
  const url = new URL(base);
  url.pathname = `/${E2E_DATABASE}`;
  return url.toString();
}
