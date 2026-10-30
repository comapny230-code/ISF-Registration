/**
 * REG-PAUSE: the registration kill switch (REGISTRATION_OPEN). While paused, the form token
 * endpoint tells the page to show a notice, and no email code is sent and no registration is
 * stored; reopening needs exactly "true". Sign-in and booking are unaffected (other suites).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { getFeatureFlags } from "@/lib/config";
import { getDb } from "@/lib/db";
import { capturedMailForTests } from "@/lib/mail";
import * as formTokenRoute from "@/app/v1/auth/register/form-token/route";
import { nextAadhaar, registerVerified, requestRegistrationCode, submitRegistration, nextMobile } from "../support/registration";

const PHOTO = "https://ik.imagekit.io/test/photo.jpg";
let n = 0;
function payload(): Record<string, any> {
  n += 1;
  return {
    category: "startup_founder",
    teamName: `Pause Team ${n}`,
    fullName: `Pause Leader ${n}`,
    email: `pause${n}@example.test`,
    photoUrl: PHOTO,
    mobile: nextMobile(),
    altMobile: "9876543211",
    domain: "Agritech",
    projectDetails: "Details",
    city: "Gunupur",
    state: "Odisha",
    country: "India",
    linkedinUrl: "in/x",
    aadharNumber: nextAadhaar(),
    members: [{ name: `Member ${n}`, photoUrl: PHOTO, phone: "9123456780", email: `pause-member${n}@example.test` }],
  };
}

async function accounts(email: string): Promise<number> {
  const sql = await getDb();
  const [row] = await sql`select count(*)::int as n from user_accounts where lower(email) = ${email}`;
  return row.n;
}

async function formToken() {
  const res = await formTokenRoute.GET(new Request("http://localhost:3000/v1/auth/register/form-token"));
  return { status: res.status, body: (await res.json()) as Record<string, any> };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("REG-PAUSE registration kill switch", () => {
  it("is closed unless REGISTRATION_OPEN is exactly 'true'", () => {
    expect(getFeatureFlags({}).registrationOpen).toBe(false);
    expect(getFeatureFlags({ REGISTRATION_OPEN: "false" }).registrationOpen).toBe(false);
    expect(getFeatureFlags({ REGISTRATION_OPEN: "TRUE" }).registrationOpen).toBe(false);
    expect(getFeatureFlags({ REGISTRATION_OPEN: "yes" }).registrationOpen).toBe(false);
    expect(getFeatureFlags({ REGISTRATION_OPEN: " true " }).registrationOpen).toBe(true);
  });

  it("while paused: the page gets a notice and no token, no code is emailed, and nothing is stored", async () => {
    const body = payload();
    vi.stubEnv("REGISTRATION_OPEN", "false");

    const token = await formToken();
    expect(token.status).toBe(200);
    expect(token.body).toMatchObject({ registrationOpen: false, message: expect.stringMatching(/paused/i) });
    expect(token.body.token).toBeUndefined();

    const mailBefore = capturedMailForTests.length;
    const code = await requestRegistrationCode(body.email);
    expect(code.status).toBe(503);
    expect(code.body.error.code).toBe("REGISTRATION_PAUSED");
    expect(capturedMailForTests.length).toBe(mailBefore);

    const submitted = await submitRegistration(body, { cookie: "", code: "123456" });
    expect(submitted.status).toBe(503);
    expect(submitted.json.code).toBe("REGISTRATION_PAUSED");
    expect(submitted.headers.get("retry-after")).toBe("3600");
    expect(await accounts(body.email)).toBe(0);
  });

  it("a form opened before the pause cannot complete after it, and works again once reopened", async () => {
    const body = payload();
    const open = await formToken();
    expect(open.body).toMatchObject({ registrationOpen: true, token: expect.any(String) });
    const prepared = await requestRegistrationCode(body.email);
    expect(prepared.status).toBe(202);

    vi.stubEnv("REGISTRATION_OPEN", "false");
    const paused = await submitRegistration(body, { cookie: prepared.binding ?? "", code: prepared.code ?? undefined });
    expect(paused.status).toBe(503);
    expect(await accounts(body.email)).toBe(0);

    vi.stubEnv("REGISTRATION_OPEN", "true");
    const reopened = await registerVerified(body);
    expect(reopened.status).toBe(200);
    expect(await accounts(body.email)).toBe(1);
  });
});
