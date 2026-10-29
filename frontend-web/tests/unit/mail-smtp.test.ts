/**
 * MAIL-01: the SMTP transport end to end against a local fake server (tests/support/fake-smtp.ts):
 * delivery and headers, sign-in, the recipient allowlist, one retry on temporary failures only,
 * and that the password never appears in an error.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { sendMail, verifyMailTransport } from "@/lib/mail";
import { startFakeSmtp, type FakeSmtp } from "../support/fake-smtp";

const USER = "mailer@example.test";
const PASS = "fakeapppassword"; // Test-only; the fake server's expected password.
let smtp: FakeSmtp;

function useSmtp(extra: Record<string, string> = {}) {
  vi.stubEnv("MAIL_TRANSPORT", "smtp");
  vi.stubEnv("SMTP_HOST", "127.0.0.1");
  vi.stubEnv("SMTP_PORT", String(smtp.port));
  vi.stubEnv("SMTP_USER", USER);
  // Gmail shows app passwords in groups of four; the config strips the spaces.
  vi.stubEnv("SMTP_PASS", "fake appp assw ord");
  vi.stubEnv("NOTIFY_REPLY_TO", "organisers@example.test");
  for (const [k, v] of Object.entries(extra)) vi.stubEnv(k, v);
}

beforeAll(async () => {
  smtp = await startFakeSmtp({ user: USER, pass: PASS });
});
afterAll(async () => {
  await smtp.close();
});
afterEach(() => {
  vi.unstubAllEnvs();
  smtp.messages.length = 0;
});

describe("MAIL-01 SMTP transport", () => {
  it("signs in and delivers one message with sender, reply-to, subject and body", async () => {
    useSmtp();
    const sent = await sendMail({ to: "leader@example.test", subject: "Your Startup Jathara sign-in code: 123456", html: "<p>Code 123456</p>" });
    expect(sent).toBe(true);
    expect(smtp.messages).toHaveLength(1);
    const [m] = smtp.messages;
    expect(m.auth).toEqual({ user: USER, pass: PASS });
    expect(m.from).toBe("no-reply@example.test");
    expect(m.to).toEqual(["leader@example.test"]);
    expect(m.data).toMatch(/^From: ISF Test <no-reply@example\.test>$/m);
    expect(m.data).toMatch(/^Reply-To: organisers@example\.test$/m);
    expect(m.data).toMatch(/^Subject: Your Startup Jathara sign-in code: 123456$/m);
    expect(m.data).toContain("Code 123456");
  });

  it("does not connect at all for a recipient outside the allowlist", async () => {
    useSmtp();
    const before = smtp.connections();
    expect(await sendMail({ to: "someone@gmail.com", subject: "s", html: "<p>x</p>" })).toBe(false);
    expect(smtp.connections()).toBe(before);
    expect(smtp.messages).toHaveLength(0);
  });

  it("retries once after a temporary (4xx) failure and then delivers", async () => {
    useSmtp();
    smtp.failNext("DATA", "451 4.3.0 Temporary failure, try again");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      expect(await sendMail({ to: "leader@example.test", subject: "retry", html: "<p>x</p>" })).toBe(true);
    } finally {
      warn.mockRestore();
    }
    expect(smtp.messages.map((m) => m.data.match(/^Subject: (.*)$/m)?.[1])).toEqual(["retry"]);
  });

  it("gives up after the second temporary failure", async () => {
    useSmtp();
    smtp.failNext("DATA", "451 4.3.0 Temporary failure");
    smtp.failNext("DATA", "451 4.3.0 Temporary failure");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await expect(sendMail({ to: "leader@example.test", subject: "s", html: "<p>x</p>" })).rejects.toMatchObject({ responseCode: 451 });
    } finally {
      warn.mockRestore();
    }
    expect(smtp.messages).toHaveLength(0);
  });

  it("does not retry a permanent rejection", async () => {
    useSmtp();
    const before = smtp.connections();
    smtp.failNext("RCPT", "550 5.1.1 Mailbox unavailable");
    await expect(sendMail({ to: "leader@example.test", subject: "s", html: "<p>x</p>" })).rejects.toMatchObject({ responseCode: 550 });
    expect(smtp.connections() - before).toBe(1);
  });

  it("never includes the password in errors, even when the server echoes it", async () => {
    useSmtp({ SMTP_PASS: "wrongpassword123" });
    const error = await sendMail({ to: "leader@example.test", subject: "s", html: "<p>x</p>" }).catch((e) => e);
    expect(error).toBeInstanceOf(Error);
    expect(error.responseCode).toBe(535);
    expect(error.message).toContain("[redacted]");
    expect(error.message).not.toContain("wrongpassword123");

    const check = await verifyMailTransport(process.env).catch((e) => e);
    expect(check.message).toMatch(/^SMTP check failed/);
    expect(check.message).not.toContain("wrongpassword123");
  });

  it("mail:check's verification signs in without sending anything", async () => {
    useSmtp();
    const result = await verifyMailTransport(process.env);
    expect(result).toEqual({ transport: "smtp", detail: `connected and signed in to 127.0.0.1:${smtp.port} (no TLS required: local only)` });
    expect(smtp.messages).toHaveLength(0);
  });
});
