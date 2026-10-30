/**
 * REG-RULES: rules added to registration on 2026-10-29: Aadhaar/PAN consent is required and
 * recorded; one registration per PAN and per primary phone (in any format); PAN format checked
 * on the server as well as in the form.
 */
import { describe, expect, it } from "vitest";
import { getDb } from "@/lib/db";
import { nextAadhaar, nextMobile, registerVerified } from "../support/registration";

const PHOTO = "https://ik.imagekit.io/test/photo.jpg";
let n = 0;
function payload(overrides: Record<string, unknown> = {}) {
  n += 1;
  const id = `${Date.now().toString(36)}-${n}`;
  return {
    category: "startup_founder",
    teamName: `Rules Team ${id}`,
    fullName: `Rules Leader ${id}`,
    email: `rules-${id}@example.test`,
    photoUrl: PHOTO,
    mobile: nextMobile(),
    altMobile: "9876543211",
    domain: "Agritech & Food Safety",
    projectDetails: "Details",
    city: "Gunupur",
    state: "Odisha",
    country: "India",
    linkedinUrl: "in/rules",
    aadharNumber: nextAadhaar(),
    members: [{ name: `Rules Member ${id}`, photoUrl: PHOTO, phone: "9123456780", email: `rules-member-${id}@example.test` }],
    ...overrides,
  };
}

let ip = 0;
const register = (body: Record<string, unknown>) => registerVerified(body, { sameOrigin: false, ip: `10.9.${Math.floor(++ip / 250)}.${ip % 250}` });

async function accounts(email: string) {
  const sql = await getDb();
  const [row] = await sql`select count(*)::int as n from user_accounts where lower(email) = ${email}`;
  return row.n as number;
}

function nextPan(): string {
  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const k = Date.now() + n++;
  const pick = (i: number) => letters[Math.floor(k / 26 ** i) % 26];
  return `${pick(0)}${pick(1)}${pick(2)}P${pick(3)}${String(k % 10000).padStart(4, "0")}${pick(4)}`;
}

describe("REG-RULES consent", () => {
  it("refuses a registration without the Aadhaar/PAN consent and stores nothing", async () => {
    for (const consent of [false, undefined, "true", 1]) {
      const body = payload({ consentAadhaarPan: consent });
      const res = await register(body);
      expect(res.status, String(consent)).toBe(400);
      expect(res.json.code).toBe("CONSENT_REQUIRED");
      expect(await accounts(body.email as string)).toBe(0);
    }
  });

  it("records the consent, its time and the client address with the registration", async () => {
    const body = payload();
    expect((await register(body)).status).toBe(200);
    const sql = await getDb();
    const [row] = await sql`
      select u.id_consent_given as account_consent, u.id_consent_at is not null as account_at, u.id_consent_ip is not null as account_ip,
             l.id_consent_given as leader_consent, l.id_consent_at is not null as leader_at
        from user_accounts u join startup_team_leaders l on l.user_id = u.id where lower(u.email) = ${body.email}`;
    expect(row).toEqual({ account_consent: true, account_at: true, account_ip: true, leader_consent: true, leader_at: true });
  });
});

describe("REG-RULES PAN", () => {
  it("rejects a malformed PAN on the server, and accepts a blank one", async () => {
    for (const pan of ["ABCDE12345", "12345ABCDE", "ABCD1234F", "ABCDE1234FF"]) {
      const body = payload({ panNumber: pan });
      const res = await register(body);
      expect(res.status, pan).toBe(400);
      expect(await accounts(body.email as string)).toBe(0);
    }
    expect((await register(payload({ panNumber: "" }))).status).toBe(200);
  });

  it("allows one registration per PAN, whatever its case or spacing, across both tracks", async () => {
    const pan = nextPan();
    expect((await register(payload({ panNumber: pan }))).status).toBe(200);
    for (const again of [pan.toLowerCase(), `${pan.slice(0, 5)} ${pan.slice(5)}`]) {
      const body = payload({ panNumber: again, category: "student_innovator" });
      const res = await register(body);
      expect(res.status, again).toBe(409);
      expect(res.json.code).toBe("PAN_ALREADY_REGISTERED");
      expect(await accounts(body.email as string)).toBe(0);
    }
  });
});

describe("REG-RULES primary phone", () => {
  it("allows one leader registration per primary phone, in any format, across both tracks", async () => {
    const mobile = nextMobile();
    expect((await register(payload({ mobile }))).status).toBe(200);
    for (const again of [`+91 ${mobile.slice(0, 5)} ${mobile.slice(5)}`, `0${mobile}`]) {
      const body = payload({ mobile: again, category: "student_innovator" });
      const res = await register(body);
      expect(res.status, again).toBe(409);
      expect(res.json.code).toBe("PHONE_ALREADY_REGISTERED");
      expect(await accounts(body.email as string)).toBe(0);
    }
  });
});
