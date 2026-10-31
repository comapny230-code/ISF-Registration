import { describe, expect, it } from "vitest";
import {
  ConfigError,
  getAppEnv,
  getDatabaseConfig,
  getFeatureFlags,
  getImageKitConfig,
  getMailConfig,
} from "@/lib/config";

const PEM = "-----BEGIN CERTIFICATE-----\\nMIIB\\n-----END CERTIFICATE-----";

const local = {
  APP_ENV: "local",
  DATABASE_URL: "postgresql://dev:dev@localhost:5432/isf_dev",
  PRODUCTION_DB_DENYLIST: "prodref123",
  NOTIFY_EMAIL_FROM: "ISF <no-reply@example.test>",
  MAIL_RECIPIENT_ALLOWLIST: "@example.test",
  SMTP_HOST: "localhost",
  SMTP_PORT: "1025",
};

const production = {
  APP_ENV: "production",
  DATABASE_URL: "postgresql://isf_app.prodref123:pw@pooler.example.org:6543/postgres",
  DATABASE_CA_CERT: PEM,
  NOTIFY_EMAIL_FROM: "ISF <no-reply@example.org>",
  SMTP_HOST: "smtp.example.org",
  SMTP_PORT: "465",
  SMTP_USER: "mailer",
  SMTP_PASS: "pw",
  IMAGEKIT_PRIVATE_KEY: "key",
};

function expectConfigError(fn: () => unknown, variable: string) {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(ConfigError);
    expect((err as ConfigError).variable).toBe(variable);
    return;
  }
  throw new Error(`expected ConfigError for ${variable}`);
}

describe("CFG-01 APP_ENV", () => {
  it("is required and validated", () => {
    expectConfigError(() => getAppEnv({}), "APP_ENV");
    expectConfigError(() => getAppEnv({ APP_ENV: "prod" }), "APP_ENV");
    expect(getAppEnv({ APP_ENV: "staging" })).toBe("staging");
  });
});

describe("CFG-01 database", () => {
  it("has no fallback when DATABASE_URL is missing", () => {
    expectConfigError(() => getDatabaseConfig({ ...local, DATABASE_URL: undefined }), "DATABASE_URL");
    expectConfigError(() => getDatabaseConfig({ ...production, DATABASE_URL: undefined }), "DATABASE_URL");
  });

  it("requires the production denylist outside production and enforces it", () => {
    expectConfigError(() => getDatabaseConfig({ ...local, PRODUCTION_DB_DENYLIST: undefined }), "PRODUCTION_DB_DENYLIST");
    expectConfigError(
      () => getDatabaseConfig({ ...local, DATABASE_URL: "postgresql://u:p@host/prodref123" }),
      "DATABASE_URL"
    );
    expectConfigError(
      () =>
        getDatabaseConfig({
          ...production,
          APP_ENV: "staging",
          PRODUCTION_DB_DENYLIST: "prodref123",
        }),
      "DATABASE_URL"
    );
  });

  it("requires a CA and verifies TLS in staging and production", () => {
    expectConfigError(() => getDatabaseConfig({ ...production, DATABASE_CA_CERT: undefined }), "DATABASE_CA_CERT");
    const cfg = getDatabaseConfig(production);
    expect(cfg.ssl).toEqual({ ca: "-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----", rejectUnauthorized: true });
  });

  it("uses TEST_DATABASE_URL only through the guard in test", () => {
    expect(() =>
      getDatabaseConfig({
        APP_ENV: "test",
        NODE_ENV: "test",
        PRODUCTION_DB_DENYLIST: "prodref123",
        DATABASE_URL: local.DATABASE_URL,
        TEST_DATABASE_URL: "postgresql://isf_test:x@localhost/isf_test",
      })
    ).toThrow(/DATABASE_URL/);
    const cfg = getDatabaseConfig({
      APP_ENV: "test",
      NODE_ENV: "test",
      PRODUCTION_DB_DENYLIST: "prodref123",
      TEST_DATABASE_URL: "postgresql://isf_test:x@localhost/isf_test",
    });
    expect(cfg).toMatchObject({ ssl: false, testDatabase: "isf_test" });
  });
});

describe("CFG-01 mail", () => {
  it("requires sender and SMTP credentials in production, with no defaults", () => {
    expectConfigError(() => getMailConfig({ ...production, NOTIFY_EMAIL_FROM: undefined }), "NOTIFY_EMAIL_FROM");
    expectConfigError(() => getMailConfig({ ...production, SMTP_PASS: undefined }), "SMTP_PASS");
    expectConfigError(() => getMailConfig({ ...production, SMTP_PORT: undefined }), "SMTP_PORT");
    expect(getMailConfig(production).smtp).toMatchObject({ host: "smtp.example.org", port: 465, secure: true });
  });

  it("enforces the recipient allowlist outside production and forbids it in production", () => {
    expectConfigError(() => getMailConfig({ ...local, MAIL_RECIPIENT_ALLOWLIST: undefined }), "MAIL_RECIPIENT_ALLOWLIST");
    expectConfigError(() => getMailConfig({ ...production, MAIL_RECIPIENT_ALLOWLIST: "@example.test" }), "MAIL_RECIPIENT_ALLOWLIST");
    expect(getMailConfig(production).recipientAllowlist).toBeNull();
  });

  it("requires STARTTLS on submission ports in staging/production and rejects other ports", () => {
    expect(getMailConfig({ ...production, SMTP_PORT: "587" }).smtp).toMatchObject({ port: 587, secure: false, requireTLS: true });
    expect(getMailConfig({ ...production, SMTP_PORT: "2525" }).smtp).toMatchObject({ secure: false, requireTLS: true });
    expect(getMailConfig(production).smtp).toMatchObject({ secure: true, requireTLS: false });
    expectConfigError(() => getMailConfig({ ...production, SMTP_PORT: "25" }), "SMTP_PORT");
    expectConfigError(
      () => getMailConfig({ ...production, APP_ENV: "staging", SMTP_PORT: "2526", MAIL_RECIPIENT_ALLOWLIST: "@example.test" }),
      "SMTP_PORT"
    );
    // A local mail catcher on any port, without TLS.
    expect(getMailConfig(local).smtp).toMatchObject({ port: 1025, secure: false, requireTLS: false });
  });

  it("keeps local mail on a local catcher and log transport out of staging", () => {
    expectConfigError(() => getMailConfig({ ...local, SMTP_HOST: "smtp.gmail.com" }), "SMTP_HOST");
    expectConfigError(
      () => getMailConfig({ ...production, APP_ENV: "staging", MAIL_TRANSPORT: "log", MAIL_RECIPIENT_ALLOWLIST: "@example.test" }),
      "MAIL_TRANSPORT"
    );
  });
});

describe("CFG-01 ImageKit", () => {
  it("is required in staging/production, optional locally, forbidden in test", () => {
    expectConfigError(() => getImageKitConfig({ ...production, IMAGEKIT_PRIVATE_KEY: undefined }), "IMAGEKIT_PRIVATE_KEY");
    expect(getImageKitConfig(local)).toBeNull();
    expectConfigError(() => getImageKitConfig({ APP_ENV: "test", IMAGEKIT_PRIVATE_KEY: "k" }), "IMAGEKIT_PRIVATE_KEY");
  });
});

describe("CFG-02 Feature flags", () => {
  it("defaults bookingUi to true unless explicitly disabled", () => {
    expect(getFeatureFlags({ FEATURE_BOOKING_UI: "false" }).bookingUi).toBe(false);
    expect(getFeatureFlags({ FEATURE_BOOKING_UI: "true" }).bookingUi).toBe(true);
    expect(getFeatureFlags({}).bookingUi).toBe(true);
  });
});
