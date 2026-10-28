import nodemailer from "nodemailer";
import { getAppEnv, getMailConfig } from "./config";

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
    return rule.startsWith("@") ? address.endsWith(rule) : address === rule;
  });
}

/**
 * Sends one message. Outside production, recipients not on MAIL_RECIPIENT_ALLOWLIST
 * are skipped so staging and local runs can never email real registrants.
 * Returns false when the message was skipped.
 */
export async function sendMail(message: OutgoingMail): Promise<boolean> {
  const config = getMailConfig();

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
  const transporter = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    auth: smtp.auth,
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 20000,
  });
  await transporter.sendMail(envelope);
  return true;
}
