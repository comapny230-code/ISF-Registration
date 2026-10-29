// LD-02: many leaders request the SAME stall at the same instant, for several rounds (spec §9.7).
// Pass per round: exactly one hold created, every other response a 409, no 5xx; p95 < 1.5 s.
import http from "k6/http";
import { check } from "k6";
import { Counter } from "k6/metrics";
import exec from "k6/execution";
import { baseFor, errorCode, fixtures, leaderParams } from "./common.js";

const ROUNDS = Number(__ENV.ROUNDS || 10);
const VUS = Number(__ENV.VUS || 100);
const holdsCreated = new Counter("holds_created");
const serverErrors = new Counter("server_errors");
const unexpected = new Counter("unexpected_responses");

const scenarios = {};
const thresholds = {
  server_errors: ["count<1"],
  unexpected_responses: ["count<1"],
  "http_req_duration{name:hold}": ["p(95)<1500"],
};
for (let r = 0; r < ROUNDS; r++) {
  scenarios[`round_${r}`] = {
    executor: "per-vu-iterations",
    vus: VUS,
    iterations: 1,
    startTime: `${r * 6}s`,
    maxDuration: "30s",
    exec: "round",
    env: { ROUND: String(r) },
  };
  thresholds[`holds_created{round:${r}}`] = ["count==1"];
}
export const options = { scenarios, thresholds };

export function round() {
  const r = Number(__ENV.ROUND);
  // One distinct leader per request within a round. (VU ids are reused across scenarios,
  // so mapping by VU id could give two requests in one round the same leader.)
  const i = exec.scenario.iterationInTest;
  if (i >= fixtures.leaders.length) throw new Error("need at least as many leaders as VUS");
  const stall = fixtures.stalls[r % fixtures.stalls.length];
  const res = http.post(`${baseFor(i)}/v1/booking/holds`, JSON.stringify({ stallId: stall.id }), leaderParams(i, { name: "hold", round: String(r) }));
  if (res.status === 201) holdsCreated.add(1, { round: String(r) });
  if (res.status >= 500) serverErrors.add(1, { round: String(r) });
  const ok = res.status === 201 || (res.status === 409 && ["STALL_UNAVAILABLE", "TEAM_HAS_ACTIVE_HOLD"].includes(errorCode(res)));
  if (!ok) {
    unexpected.add(1, { round: String(r), status: String(res.status) });
    console.error(`unexpected response in round ${r}: ${res.status} ${String(res.body).slice(0, 300)}`);
  }
  check(res, { "201 or expected 409": () => ok });
}
