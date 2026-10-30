/**
 * REG-VERIFY: every registration proves the leader's email with a code bound to the browser,
 * passes the bot filters, and uses an Aadhaar number no other registration uses.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getDb } from "@/lib/db";
import { capturedMailForTests } from "@/lib/mail";
import { configureBooking, me } from "../support/booking";
import { cookiePair } from "../support/http";
import { nextAadhaar, prepareRegistration, registerVerified, requestRegistrationCode, submitRegistration, nextMobile } from "../support/registration";

let n = 0;
const PHOTO = "https://ik.imagekit.io/test/photo.jpg";
function payload(overrides: Record<string, unknown> = {}): Record<string, any> {
  n += 1;
  return {
    category: "startup_founder",
    teamName: `Verify Team ${n}`,
    fullName: `Verify Leader ${n}`,
    email: `verify${n}@example.test`,
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
    members: [{ name: `Member ${n}`, photoUrl: PHOTO, phone: "9123456780", email: `verify-member${n}@example.test` }],
    ...overrides,
  };
}

async function leaderRows(email: string): Promise<number> {
  const sql = await getDb();
  const [row] = await sql`
    select (select count(*)::int from startup_team_leaders where lower(email) = ${email})
         + (select count(*)::int from student_innovators where lower(email) = ${email}) as n`;
  return row.n;
}

const wrongCode = (code: string | undefined) => String((Number(code) + 1) % 1e6).padStart(6, "0");

beforeEach(async () => {
  capturedMailForTests.length = 0;
  await configureBooking();
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("REG-VERIFY email code", () => {
  it("emails a 6-digit code and sets the browser binding cookie", async () => {
    const res = await requestRegistrationCode(payload().email);
    expect(res.status).toBe(202);
    expect(res.code).toMatch(/^\d{6}$/);
    expect(res.binding).toMatch(/^__Host-sj_otp=[A-Za-z0-9_-]{43}$/);
  });

  it("refuses a registration without a code, with a wrong code, or with a code from another browser", async () => {
    const body = payload();
    const none = await registerVerified(body, { skipEmailCode: true });
    expect(none.status).toBe(400);
    expect(none.json.code).toBe("EMAIL_CODE_INVALID");

    const prepared = await prepareRegistration(body.email);
    expect((await submitRegistration(body, { ...prepared, code: wrongCode(prepared.code) })).status).toBe(400);
    // The right code, from a browser that did not request it.
    expect((await submitRegistration(body, { cookie: "", code: prepared.code })).status).toBe(400);
    expect(await leaderRows(body.email)).toBe(0);

    expect((await submitRegistration(body, prepared)).status).toBe(200);
    expect(await leaderRows(body.email)).toBe(1);
  });

  it("locks a code after 5 wrong attempts", async () => {
    const body = payload();
    const prepared = await prepareRegistration(body.email);
    for (let i = 0; i < 5; i++) expect((await submitRegistration(body, { ...prepared, code: wrongCode(prepared.code) })).status).toBe(400);
    expect((await submitRegistration(body, prepared)).status).toBe(400);
    expect(await leaderRows(body.email)).toBe(0);
  });

  it("a code survives a registration that failed, and then saves exactly one registration", async () => {
    const body = payload();
    const prepared = await prepareRegistration(body.email);
    expect((await submitRegistration({ ...body, teamName: "T".repeat(201) }, prepared)).status).toBe(400);
    expect((await submitRegistration(body, prepared)).status).toBe(200);
    // The consumed code cannot be used again.
    const again = await submitRegistration({ ...payload(), email: body.email }, prepared);
    expect(again.status).toBe(400);
    expect(await leaderRows(body.email)).toBe(1);
  });

  it("does not issue a code for an address that is already registered", async () => {
    const body = payload();
    expect((await registerVerified(body)).status).toBe(200);
    const again = await requestRegistrationCode(body.email);
    expect(again.status).toBe(409);
    expect(again.code).toBeNull();
  });

  it("limits code requests per email", async () => {
    const email = payload().email;
    const statuses: number[] = [];
    for (let i = 0; i < 4; i++) statuses.push((await requestRegistrationCode(email)).status);
    expect(statuses).toEqual([202, 202, 202, 429]);
  });

  it("signs the verified leader straight in, as before", async () => {
    vi.stubEnv("FEATURE_BOOKING_UI", "true");
    const res = await registerVerified(payload());
    expect(res.json.booking).toEqual({ next: "/book-your-stall", signedIn: true });
    expect((await me(cookiePair(res.headers, "__Host-sj_session")!)).status).toBe(200);
  });
});

describe("REG-VERIFY Aadhaar", () => {
  it("rejects a number that fails the check digit", async () => {
    const res = await registerVerified(payload({ aadharNumber: "123412341234" }));
    expect(res.status).toBe(400);
    expect(res.json.message).toMatch(/Aadhaar/);
  });

  it("allows one registration per Aadhaar number, across both tracks", async () => {
    const aadhaar = nextAadhaar();
    expect((await registerVerified(payload({ aadharNumber: aadhaar }))).status).toBe(200);
    const second = await registerVerified(payload({ aadharNumber: aadhaar, category: "student_innovator" }));
    expect(second.status).toBe(409);
    expect(second.json.code).toBe("AADHAAR_ALREADY_REGISTERED");
  });

  it("serialises concurrent registrations with the same Aadhaar: exactly one succeeds", async () => {
    const aadhaar = nextAadhaar();
    const bodies = [payload({ aadharNumber: aadhaar }), payload({ aadharNumber: aadhaar }), payload({ aadharNumber: aadhaar })];
    const prepared: Awaited<ReturnType<typeof prepareRegistration>>[] = [];
    for (const b of bodies) prepared.push(await prepareRegistration(b.email));
    const results = await Promise.all(bodies.map((b, i) => submitRegistration(b, prepared[i])));
    expect(results.map((r) => r.status).sort()).toEqual([200, 409, 409]);
  });
});

describe("REG-VERIFY bot filters", () => {
  it("refuses a filled-in hidden field, with nothing saved", async () => {
    const body = payload({ website: "http://spam.example" });
    expect((await registerVerified(body)).status).toBe(400);
    expect(await leaderRows(body.email)).toBe(0);
  });

  it("refuses a missing or forged form token", async () => {
    const body = payload();
    const prepared = await prepareRegistration(body.email);
    expect((await submitRegistration({ ...body, formToken: "forged" }, prepared)).status).toBe(400);
    expect((await submitRegistration({ ...body, formToken: null }, prepared)).status).toBe(400);
    expect(await leaderRows(body.email)).toBe(0);
  });
});
