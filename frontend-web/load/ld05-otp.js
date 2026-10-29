// LD-05: a burst of 100 sign-in code requests in one minute from one client address (spec §9.7).
// Uses addresses with no account, so no email is ever sent. Pass: p95 < 500 ms, no 5xx, only 202
// (accepted) or 429 (per-address limit, 20 per 15 minutes), and the limit actually engages.
import http from "k6/http";
import { check } from "k6";
import { Counter } from "k6/metrics";
import { BASES, ORIGIN } from "./common.js";

const accepted = new Counter("otp_accepted");
const limited = new Counter("otp_rate_limited");
const other = new Counter("otp_other_status");

export const options = {
  scenarios: { burst: { executor: "constant-arrival-rate", rate: 100, timeUnit: "1m", duration: "1m", preAllocatedVUs: 20 } },
  thresholds: {
    "http_req_duration{name:otp_request}": ["p(95)<500"],
    otp_other_status: ["count<1"],
    otp_accepted: ["count<=20"],
    otp_rate_limited: ["count>0"],
  },
};

let n = 0;
export default function () {
  n += 1;
  const email = `load-otp-${__VU}-${n}-${Date.now()}@example.test`;
  const res = http.post(`${BASES[0]}/v1/auth/otp/request`, JSON.stringify({ email, audience: "leader" }), {
    headers: { origin: ORIGIN, "content-type": "application/json" },
    tags: { name: "otp_request" },
  });
  if (res.status === 202) accepted.add(1);
  else if (res.status === 429) limited.add(1);
  else other.add(1, { status: String(res.status) });
  check(res, { "202 or 429": (r) => r.status === 202 || r.status === 429 });
}
