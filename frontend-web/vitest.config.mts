import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
const root = path.dirname(fileURLToPath(import.meta.url));
const alias = { "@": root };

/**
 * Non-secret settings for every test worker (and for the db global setup, which
 * reads them from the project config). TEST_DATABASE_URL is deliberately NOT set
 * here: it must be supplied explicitly (see tests/README.md).
 */
const TEST_ENV = {
  APP_ENV: "test",
  PRODUCTION_DB_DENYLIST: "ddrremsyzozutyxbxigf",
  MAIL_TRANSPORT: "log",
  NOTIFY_EMAIL_FROM: "ISF Test <no-reply@example.test>",
  MAIL_RECIPIENT_ALLOWLIST: "@example.test",
  APP_ORIGIN: "http://localhost:3000",
  // Test-only keys; never used outside APP_ENV=test.
  OTP_PEPPER: "test-otp-pepper-0123456789abcdef0123",
  RATE_LIMIT_HASH_KEY: "test-rate-limit-key-0123456789abcdef",
  HOLD_TOKEN_KEYS: "t1:test-hold-token-key-0123456789abcdef",
  // Tests submit at machine speed; the minimum fill time is tested on its own.
  REGISTRATION_MIN_FILL_SECONDS: "0",
  // Registration is closed unless explicitly opened (kill switch); tests exercise the open form.
  REGISTRATION_OPEN: "true",
};

export default defineConfig({
  resolve: { alias },
  test: {
    projects: [
      {
        resolve: { alias },
        test: {
          name: "unit",
          include: ["tests/unit/**/*.test.ts"],
          environment: "node",
          env: TEST_ENV,
        },
      },
      {
        resolve: { alias },
        test: {
          name: "db",
          include: ["tests/db/**/*.test.ts", "tests/integration/**/*.test.ts", "tests/concurrency/**/*.test.ts"],
          environment: "node",
          env: TEST_ENV,
          globalSetup: ["tests/support/global-setup.ts"],
          setupFiles: ["tests/support/db-worker-setup.ts"],
          fileParallelism: false,
          testTimeout: 30_000,
          hookTimeout: 60_000,
        },
      },
    ],
  },
});
