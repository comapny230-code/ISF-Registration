/**
 * AUTH-LOCKOUT: a sign-in code belongs to the browser that requested it. Someone who
 * only knows a leader's email must not be able to burn or cancel that leader's code
 * (for example to keep a rival team out while booking opens).
 */
import { beforeEach, describe, expect, it } from "vitest";
import * as requestRoute from "@/app/v1/auth/otp/request/route";
import * as verifyRoute from "@/app/v1/auth/otp/verify/route";
import { capturedMailForTests } from "@/lib/mail";
import { createLeader } from "../support/booking";
import { apiRequest, call, cookiePair } from "../support/http";

const BINDING = "__Host-sj_otp";

/** One browser: keeps the cookies the server sets, like a real cookie jar would. */
function browser() {
  const jar = new Map<string, string>();
  const cookie = () => [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
  const remember = (headers: Headers) => {
    for (const name of [BINDING, "__Host-sj_session"]) {
      const pair = cookiePair(headers, name);
      if (pair) {
        const value = pair.slice(name.length + 1);
        if (value) jar.set(name, value);
        else jar.delete(name);
      }
    }
  };
  return {
    async request(email: string) {
      const res = await call(requestRoute.POST, apiRequest("/v1/auth/otp/request", { email, audience: "leader" }, { cookie: cookie() }));
      remember(res.headers);
      return res;
    },
    async verify(email: string, code: string) {
      const res = await call(verifyRoute.POST, apiRequest("/v1/auth/otp/verify", { email, audience: "leader", code }, { cookie: cookie() }));
      remember(res.headers);
      return res;
    },
    jar,
  };
}

function lastCode(email: string): string {
  const mail = [...capturedMailForTests].reverse().find((m) => m.to === email);
  return /(\d{6})/.exec(mail!.subject)![1];
}
const wrong = (code: string) => String((Number(code) + 1) % 1_000_000).padStart(6, "0");

beforeEach(() => {
  capturedMailForTests.length = 0;
});

describe("AUTH-LOCKOUT codes are bound to the requesting browser", () => {
  it("wrong guesses from another browser do not burn the leader's code", async () => {
    const leader = await createLeader();
    const victim = browser();
    const attacker = browser();
    await victim.request(leader.email);
    const code = lastCode(leader.email);

    for (let i = 0; i < 6; i++) expect((await attacker.verify(leader.email, wrong(code))).status).toBe(400);
    expect((await victim.verify(leader.email, code)).status).toBe(200);
  });

  it("a code request from another browser does not cancel the leader's code", async () => {
    const leader = await createLeader();
    const victim = browser();
    const attacker = browser();
    await victim.request(leader.email);
    const code = lastCode(leader.email);

    await attacker.request(leader.email);
    expect((await victim.verify(leader.email, code)).status).toBe(200);
  });

  it("the correct code is refused from a browser that did not request it", async () => {
    const leader = await createLeader();
    const victim = browser();
    await victim.request(leader.email);
    const code = lastCode(leader.email);
    expect((await browser().verify(leader.email, code)).status).toBe(400);
    expect((await victim.verify(leader.email, code)).status).toBe(200);
  });

  it("still allows 5 attempts per code in the requesting browser, then locks it", async () => {
    const leader = await createLeader();
    const victim = browser();
    await victim.request(leader.email);
    const code = lastCode(leader.email);
    for (let i = 0; i < 5; i++) expect((await victim.verify(leader.email, wrong(code))).status).toBe(400);
    expect((await victim.verify(leader.email, code)).status).toBe(400);
  });

  it("a newer code in the same browser replaces the older one", async () => {
    const leader = await createLeader();
    const victim = browser();
    await victim.request(leader.email);
    const first = lastCode(leader.email);
    await victim.request(leader.email);
    const second = lastCode(leader.email);
    if (first !== second) expect((await victim.verify(leader.email, first)).status).toBe(400);
    expect((await victim.verify(leader.email, second)).status).toBe(200);
  });

  it("sets the binding cookie for every address, so it reveals nothing about which accounts exist", async () => {
    const leader = await createLeader();
    const real = await browser().request(leader.email);
    const unknown = await browser().request("nobody-here@example.test");
    for (const res of [real, unknown]) {
      expect(res.status).toBe(202);
      expect(res.headers.get("set-cookie")).toMatch(/^__Host-sj_otp=[A-Za-z0-9_-]{43}; Path=\/; HttpOnly; Secure; SameSite=Strict; Max-Age=900$/);
    }
  });

  it("clears the binding cookie after a successful sign-in", async () => {
    const leader = await createLeader();
    const victim = browser();
    await victim.request(leader.email);
    const res = await victim.verify(leader.email, lastCode(leader.email));
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toContain(`${BINDING}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`);
  });
});
