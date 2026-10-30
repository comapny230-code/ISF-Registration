/**
 * MAIL-FAIL: email delivery failures. The mail server is a closed local port (nothing is ever
 * sent). A registration whose confirmation email fails is still saved exactly once, and a retry
 * does not create a duplicate; a failed code email still answers 202 (no account enumeration).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { getDb } from "@/lib/db";
import { capturedMailForTests } from "@/lib/mail";
import { nextAadhaar, nextMobile, prepareRegistration, submitRegistration } from "../support/registration";

const PHOTO = "https://ik.imagekit.io/test/photo.jpg";

function unreachableMailServer() {
  vi.stubEnv("MAIL_TRANSPORT", "smtp");
  vi.stubEnv("SMTP_HOST", "127.0.0.1");
  vi.stubEnv("SMTP_PORT", "1"); // closed: connection refused
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("MAIL-FAIL email delivery failures", () => {
  it("saves a registration once when its confirmation email cannot be sent, and a retry is refused", async () => {
    const id = Date.now().toString(36);
    const body = {
      category: "startup_founder", teamName: `Mailfail Team ${id}`, fullName: `Mailfail Leader ${id}`,
      email: `mailfail-${id}@example.test`, photoUrl: PHOTO, mobile: nextMobile(), altMobile: "9876543211",
      domain: "Agritech & Food Safety", projectDetails: "Details", city: "Gunupur", state: "Odisha", country: "India",
      linkedinUrl: "in/mailfail", aadharNumber: nextAadhaar(),
      members: [{ name: `Mailfail Member ${id}`, photoUrl: PHOTO, phone: "9123456780", email: `mailfail-member-${id}@example.test` }],
    };
    const prepared = await prepareRegistration(body.email); // code sent while mail still works
    expect(prepared.status).toBe(202);

    unreachableMailServer();
    const sentBefore = capturedMailForTests.length;
    const res = await submitRegistration(body, prepared);
    expect(res.status, JSON.stringify(res.json)).toBe(200);
    expect(capturedMailForTests.length).toBe(sentBefore);

    const sql = await getDb();
    const count = async () =>
      (await sql`select count(*)::int as n from startup_team_leaders where lower(email) = ${body.email}`)[0].n;
    expect(await count()).toBe(1);

    // Retrying (e.g. the user resubmits after not getting the email) cannot duplicate it: the used
    // code is refused (400); a new code is not issued for a registered address (REG-VERIFY tests).
    const retry = await submitRegistration(body, prepared);
    expect(retry.status).toBe(400);
    expect(await count()).toBe(1);
  }, 20_000);

  it("answers 202 when the registration code email cannot be sent, and stores nothing else", async () => {
    unreachableMailServer();
    const email = `mailfail-code-${Date.now().toString(36)}@example.test`;
    const sentBefore = capturedMailForTests.length;
    const res = await prepareRegistration(email);
    expect(res.status).toBe(202);
    expect(capturedMailForTests.length).toBe(sentBefore);
    const sql = await getDb();
    const [accounts] = await sql`select count(*)::int as n from user_accounts where lower(email) = ${email}`;
    expect(accounts.n).toBe(0);
  }, 20_000);
});
