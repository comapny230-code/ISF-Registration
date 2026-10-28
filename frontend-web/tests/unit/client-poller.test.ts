/** LIVE-04 and polling behaviour (spec §4.10), with controllable timers. */
import { describe, expect, it } from "vitest";
import { formatCountdown, remainingMs, serverOffsetMs, StatusPoller } from "@/lib/booking/client-poller";

type Snap = { asOf: string; label: string };

function harness(responses: Array<Snap | Error>) {
  let clock = 0;
  const timers: Array<{ at: number; fn: () => void; id: number; cancelled: boolean }> = [];
  let nextId = 1;
  const applied: string[] = [];
  const errors: number[] = [];
  const poller = new StatusPoller<Snap>({
    fetchSnapshot: async () => {
      const next = responses.shift();
      if (!next) throw new Error("no more responses");
      if (next instanceof Error) throw next;
      return next;
    },
    onSnapshot: (s) => applied.push(s.label),
    onError: (_e, failures) => errors.push(failures),
    now: () => clock,
    setTimer: (fn, ms) => {
      const t = { at: clock + ms, fn, id: nextId++, cancelled: false };
      timers.push(t);
      return t;
    },
    clearTimer: (h) => {
      (h as { cancelled: boolean }).cancelled = true;
    },
  });
  const pending = () => timers.filter((t) => !t.cancelled).sort((a, b) => a.at - b.at);
  const advance = async () => {
    const t = pending()[0];
    if (!t) return null;
    t.cancelled = true;
    clock = t.at;
    t.fn();
    await new Promise((r) => setTimeout(r, 0));
    return t.at;
  };
  return { poller, applied, errors, advance, pending, setClock: (ms: number) => (clock = ms) };
}

const at = (seconds: number, label = `s${seconds}`): Snap => ({ asOf: new Date(Date.UTC(2026, 11, 1, 0, 0, seconds)).toISOString(), label });

describe("LIVE-04 ordering", () => {
  it("ignores a response older than one already applied", () => {
    const { poller, applied } = harness([]);
    expect(poller.accept(at(10, "new"))).toBe(true);
    expect(poller.accept(at(5, "late-old"))).toBe(false);
    expect(poller.accept(at(10, "same-instant"))).toBe(true);
    expect(poller.accept(at(11, "newer"))).toBe(true);
    expect(applied).toEqual(["new", "same-instant", "newer"]);
  });

  it("rejects responses without a valid asOf", () => {
    const { poller, applied } = harness([]);
    expect(poller.accept({ asOf: "garbage", label: "x" })).toBe(false);
    expect(applied).toEqual([]);
  });
});

describe("polling schedule", () => {
  it("polls every 2.5 s while running and stops cleanly", async () => {
    const { poller, applied, advance, pending } = harness([at(1), at(2), at(3)]);
    poller.start();
    await new Promise((r) => setTimeout(r, 0));
    expect(applied).toEqual(["s1"]);
    expect(await advance()).toBe(2500);
    expect(await advance()).toBe(5000);
    expect(applied).toEqual(["s1", "s2", "s3"]);
    poller.stop();
    expect(pending()).toHaveLength(0);
  });

  it("backs off exponentially on errors up to 15 s and resets after success", async () => {
    const { poller, errors, advance } = harness([new Error("a"), new Error("b"), new Error("c"), new Error("d"), at(1), at(2)]);
    poller.start();
    await new Promise((r) => setTimeout(r, 0));
    expect(poller.nextDelay()).toBe(5000);
    expect(await advance()).toBe(5000);
    expect(poller.nextDelay()).toBe(10_000);
    expect(await advance()).toBe(15_000);
    expect(poller.nextDelay()).toBe(15_000); // capped
    await advance();
    await advance(); // success
    expect(errors).toEqual([1, 2, 3, 4]);
    expect(poller.nextDelay()).toBe(2500);
    poller.stop();
  });

  it("refreshAt schedules an extra poll at the requested time (hold expiry)", async () => {
    const { poller, applied, advance, setClock } = harness([at(1), at(2)]);
    setClock(1000);
    poller.start();
    await new Promise((r) => setTimeout(r, 0));
    poller.refreshAt(1800);
    expect(await advance()).toBe(1800);
    expect(applied).toEqual(["s1", "s2"]);
    poller.stop();
  });
});

describe("countdown helpers", () => {
  it("uses the server clock offset", () => {
    const offset = serverOffsetMs("2026-12-01T00:00:10.000Z", Date.parse("2026-12-01T00:00:00.000Z"));
    expect(offset).toBe(10_000);
    expect(remainingMs("2026-12-01T00:05:10.000Z", offset, Date.parse("2026-12-01T00:00:00.000Z"))).toBe(300_000);
    expect(remainingMs("2026-12-01T00:00:05.000Z", offset, Date.parse("2026-12-01T00:00:00.000Z"))).toBe(0);
    expect(formatCountdown(300_000)).toBe("5:00");
    expect(formatCountdown(61_001)).toBe("1:02");
    expect(formatCountdown(0)).toBe("0:00");
  });
});
