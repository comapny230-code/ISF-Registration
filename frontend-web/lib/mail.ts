import nodemailer from "nodemailer";
import { getAppEnv, getMailConfig } from "./config";
import { isSafeEmailAddress } from "./email-address";

export interface OutgoingMail {
  to: string;
  subject: string;
  html: string;
}

export interface CapturedMail extends OutgoingMail {
  from: string;
  replyTo?: string;
}

/** Messages built by the 'log' transport while APP_ENV=test (for assertions). */
export const capturedMailForTests: CapturedMail[] = [];

function isAllowed(recipient: string, allowlist: string[]): boolean {
  const address = recipient.trim().toLowerCase();
  return allowlist.some((entry) => {
    const rule = entry.toLowerCase();
    return rule === "*" || (rule.startsWith("@") ? address.endsWith(rule) : address === rule);
  });
}

/**
 * Sends one message. Outside production, recipients not on MAIL_RECIPIENT_ALLOWLIST
 * are skipped so staging and local runs can never email real registrants.
 * Returns false when the message was skipped.
 */
export async function sendMail(message: OutgoingMail): Promise<boolean> {
  const config = getMailConfig();

  if (!isSafeEmailAddress(message.to)) {
    console.warn("[MAIL] Recipient is not a plain single address; message skipped.");
    return false;
  }

  if (config.recipientAllowlist && !isAllowed(message.to, config.recipientAllowlist)) {
    console.warn("[MAIL] Recipient is not on MAIL_RECIPIENT_ALLOWLIST; message skipped.");
    return false;
  }

  const envelope = { from: config.from, replyTo: config.replyTo, ...message };

  if (config.transport === "log") {
    const transporter = nodemailer.createTransport({ jsonTransport: true });
    await transporter.sendMail(envelope);
    const appEnv = getAppEnv();
    if (appEnv === "test") capturedMailForTests.push(envelope);
    // Local development only (the log transport is rejected in staging/production).
    if (appEnv === "local") console.info(`[MAIL:log] to=${message.to} subject=${message.subject}`);
    return true;
  }

  const smtp = config.smtp!;
  for (let attempt = 1; ; attempt++) {
    const transporter = createSmtpTransport(smtp);
    try {
      await transporter.sendMail(envelope);
      return true;
    } catch (err) {
      if (attempt < SMTP_MAX_ATTEMPTS && isTransientSmtpError(err)) {
        console.warn("[MAIL] Temporary SMTP failure; retrying once.", { code: (err as any)?.code, responseCode: (err as any)?.responseCode });
        await new Promise((resolve) => setTimeout(resolve, SMTP_RETRY_DELAY_MS));
        continue;
      }
      throw redactedSmtpError(err, smtp);
    } finally {
      transporter.close();
    }
  }
}

type SmtpSettings = NonNullable<ReturnType<typeof getMailConfig>["smtp"]>;

/** Two attempts at most: sign-in and registration codes expire, so a long retry loop does not help. */
const SMTP_MAX_ATTEMPTS = 2;
const SMTP_RETRY_DELAY_MS = 1000;

function createSmtpTransport(smtp: SmtpSettings) {
  return nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    requireTLS: smtp.requireTLS,
    // Certificates are always verified (nodemailer's default); never offer anything below TLS 1.2.
    tls: { minVersion: "TLSv1.2" },
    auth: smtp.auth,
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 20000,
  });
}

/** 4xx replies and dropped connections are worth one more try; 5xx (rejected, bad sign-in) are not. */
function isTransientSmtpError(err: unknown): boolean {
  const e = err as { code?: string; responseCode?: number };
  if (typeof e?.responseCode === "number") return e.responseCode >= 400 && e.responseCode < 500;
  return ["ETIMEDOUT", "ECONNECTION", "ECONNRESET", "ESOCKET", "EDNS"].includes(e?.code ?? "");
}

/** Keeps the server's message and codes for the logs but never the password. */
function redactedSmtpError(err: unknown, smtp: SmtpSettings): Error {
  const e = err as { message?: string; code?: string; responseCode?: number };
  const pass = smtp.auth?.pass;
  const message = String(e?.message ?? err);
  const safe = new Error(pass ? message.split(pass).join("[redacted]") : message);
  Object.assign(safe, { name: "SmtpError", code: e?.code, responseCode: e?.responseCode });
  return safe;
}

/**
 * Checks the configured transport without sending anything: for SMTP it connects and logs in
 * (nodemailer verify). Errors keep the server's message but never include the password.
 */
export async function verifyMailTransport(env: Record<string, string | undefined> = process.env): Promise<{ transport: "smtp" | "log"; detail: string }> {
  const config = getMailConfig(env);
  if (config.transport === "log") return { transport: "log", detail: "log transport: messages are written to the server log; nothing to verify" };
  const smtp = config.smtp!;
  const transporter = createSmtpTransport(smtp);
  try {
    await transporter.verify();
  } catch (err: any) {
    throw new Error(`SMTP check failed (${err?.code ?? "error"}): ${redactedSmtpError(err, smtp).message}`);
  } finally {
    transporter.close();
  }
  return { transport: "smtp", detail: `connected and signed in to ${smtp.host}:${smtp.port}${smtp.secure ? " (TLS)" : smtp.requireTLS ? " (STARTTLS required)" : " (no TLS required: local only)"}` };
}

