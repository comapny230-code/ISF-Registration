import { afterEach, describe, expect, it } from "vitest";
import { ConfigError, getBookingConfig } from "@/lib/config";
import { consumePoll } from "@/lib/booking/poll-limit";
import { assertHoldSecondsAllowed } from "@/lib/booking/service";
import { HOLD_TOKEN_PATTERN, issueHoldToken, newBookingRef, verifyHoldToken } from "@/lib/booking/token";
import { armFault, clearFaults, fault } from "@/lib/db/faults";

const KEY = "k".repeat(32);
const saved = { ...process.env };
afterEach(() => {
  process.env.HOLD_TOKEN_KEYS = saved.HOLD_TOKEN_KEYS;
  process.env.APP_ENV = saved.APP_ENV;
  clearFaults();
});

describe("hold tokens (AUTH-13/14)", () => {
  it("are deterministic, bound to hold, team and expiry, and verified in constant time", () => {
    const token = issueHoldToken("hold-1", "team-1", "1000");
    expect(token).toMatch(HOLD_TOKEN_PATTERN);
    expect(issueHoldToken("hold-1", "team-1", "1000")).toBe(token);
    expect(verifyHoldToken(token, "hold-1", "team-1", "1000")).toBe(true);
    expect(verifyHoldToken(token, "hold-2", "team-1", "1000")).toBe(false);
    expect(verifyHoldToken(token, "hold-1", "team-2", "1000")).toBe(false);
    expect(verifyHoldToken(token, "hold-1", "team-1", "1001")).toBe(false);
    expect(verifyHoldToken("v1.t1.short", "hold-1", "team-1", "1000")).toBe(false);
  });

  it("supports key rotation: old tokens verify while the old key is still listed", () => {
    process.env.HOLD_TOKEN_KEYS = `old:${KEY}`;
    const oldToken = issueHoldToken("h", "t", "1");
    process.env.HOLD_TOKEN_KEYS = `new:${"n".repeat(32)},old:${KEY}`;
    expect(issueHoldToken("h", "t", "1")).toMatch(/^v1\.new\./);
    expect(verifyHoldToken(oldToken, "h", "t", "1")).toBe(true);
    process.env.HOLD_TOKEN_KEYS = `new:${"n".repeat(32)}`;
    expect(verifyHoldToken(oldToken, "h", "t", "1")).toBe(false);
  });

  it("validates key configuration", () => {
    for (const bad of ["", "nokey", `UPPER:${KEY}`, "k1:short", `k1:${KEY},k1:${KEY}`]) {
      expect(() => getBookingConfig({ APP_ENV: "test", HOLD_TOKEN_KEYS: bad })).toThrow(ConfigError);
    }
  });
});

describe("booking references", () => {
  it("use the SJ26 prefix and an unambiguous alphabet", () => {
    for (let i = 0; i < 200; i++) expect(newBookingRef()).toMatch(/^SJ26-[0-9A-HJKMNP-TV-Z]{8}$/);
  });
});

describe("production guards", () => {
  it("only allows the approved five-minute hold in production", () => {
    expect(() => assertHoldSecondsAllowed("production", 300)).not.toThrow();
    expect(() => assertHoldSecondsAllowed("production", 3)).toThrow(/temporarily unavailable/);
    expect(() => assertHoldSecondsAllowed("staging", 3)).not.toThrow();
  });

  it("fault hooks can only be armed, and only fire, under APP_ENV=test", async () => {
    let fired = 0;
    armFault("beforeCommit", () => {
      fired++;
    });
    process.env.APP_ENV = "production";
    await fault("beforeCommit");
    expect(fired).toBe(0);
    expect(() => armFault("beforeCommit", () => {})).toThrow(/APP_ENV=test/);
    process.env.APP_ENV = "test";
    await fault("beforeCommit");
    expect(fired).toBe(1);
  });
});

describe("poll limiter", () => {
  it("allows 40 polls per minute per key", () => {
    const key = `k-${Math.random()}`;
    for (let i = 0; i < 40; i++) consumePoll(key, 1_000);
    expect(() => consumePoll(key, 1_000)).toThrow(/Too many requests/);
    expect(() => consumePoll(key, 61_001)).not.toThrow();
  });
});
