/**
 * Registration test support: a valid, unique Aadhaar number per call, and a submission that
 * goes through the email code and form token exactly as the site's form does.
 */
import * as route from "@/app/v1/[...route]/route";
import * as emailCodeRoute from "@/app/v1/auth/register/email-code/route";
import { capturedMailForTests } from "@/lib/mail";
import { withAadhaarCheckDigit } from "@/lib/registration/aadhaar";
import { issueFormToken } from "@/lib/registration/form-guard";
import { cookiePair, ORIGIN } from "./http";

let aadhaarCounter = 0;
/** A different checksum-valid Aadhaar number every call (unique across test files by process and time). */
export function nextAadhaar(): string {
  aadhaarCounter += 1;
  const stem = `${2 + (process.pid % 8)}${String(Date.now() % 1e6).padStart(6, "0")}${String(aadhaarCounter).padStart(4, "0")}`;
  return withAadhaarCheckDigit(stem.slice(0, 11));
}

let ipCounter = 0;
const nextIp = () => {
  ipCounter += 1;
  return `10.77.${Math.floor(ipCounter / 250) % 250}.${ipCounter % 250}`;
};

export interface RegisterOptions {
  /** Send as the site's own form (Origin + same-origin); false = a cross-site or scripted request. */
  sameOrigin?: boolean;
  /** Extra cookies already on the "browser" (e.g. an existing session). */
  cookie?: string;
  /** Skip the email code step (to test that the code is required). */
  skipEmailCode?: boolean;
  /** Override the code that is submitted. */
  emailCode?: string;
  ip?: string;
}

function headersFor(options: RegisterOptions, cookie: string): Record<string, string> {
  const headers: Record<string, string> = { "content-type": "application/json", "x-forwarded-for": options.ip ?? nextIp() };
  if (options.sameOrigin !== false) {
    headers.origin = ORIGIN;
    headers["sec-fetch-site"] = "same-origin";
  }
  if (cookie) headers.cookie = cookie;
  return headers;
}

/** Requests the registration email code in this "browser"; returns the binding cookie pair and the code. */
export async function requestRegistrationCode(email: string, cookie = "") {
  const res = await emailCodeRoute.POST(
    new Request(`${ORIGIN}/v1/auth/register/email-code`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: ORIGIN, "x-forwarded-for": nextIp(), ...(cookie ? { cookie } : {}) },
      body: JSON.stringify({ email }),
    })
  );
  const binding = cookiePair(res.headers, "__Host-sj_otp");
  const mail = [...capturedMailForTests].reverse().find((m) => m.to === email && m.subject.includes("registration code"));
  return { status: res.status, binding, code: mail ? /(\d{6})$/.exec(mail.subject)![1] : null, body: await res.json() };
}

/** A code requested in this "browser", ready to submit with a registration. */
export interface PreparedCode {
  cookie: string;
  code: string | undefined;
}

/**
 * Requests the code like the form's "Send verification code" button. The code email is removed
 * from capturedMailForTests so assertions about later mail (confirmation, booking) stay simple.
 */
export async function prepareRegistration(email: string, cookie = ""): Promise<PreparedCode & { status: number }> {
  const issued = await requestRegistrationCode(email, cookie);
  const index = capturedMailForTests.findIndex((m) => m.to === email && m.subject.includes("registration code"));
  if (index >= 0) capturedMailForTests.splice(index, 1);
  return { status: issued.status, cookie: [cookie, issued.binding].filter(Boolean).join("; "), code: issued.code ?? undefined };
}

export async function submitRegistration(body: Record<string, any>, prepared: PreparedCode, options: RegisterOptions = {}) {
  const res = await route.POST(
    new Request(`${ORIGIN}/v1/auth/register`, {
      method: "POST",
      headers: headersFor(options, prepared.cookie),
      body: JSON.stringify({ formToken: issueFormToken(Date.now() - 60_000), consentAadhaarPan: true, ...body, emailCode: options.emailCode ?? prepared.code }),
    })
  );
  return { status: res.status, headers: res.headers, json: (await res.json()) as Record<string, any> };
}

/** Registers like the site's form: requests the email code, then submits with code and form token. */
export async function registerVerified(body: Record<string, any>, options: RegisterOptions = {}) {
  const email = String(body.email ?? "").toLowerCase().trim();
  const prepared = options.skipEmailCode
    ? { cookie: options.cookie ?? "", code: undefined }
    : await prepareRegistration(email, options.cookie ?? "");
  return submitRegistration(body, prepared, options);
}
