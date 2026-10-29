// LD-01: steady polling of live stall status by many leaders (spec §9.7).
// Pass: p95 < 300 ms, p99 < 800 ms, errors < 0.1 %.
import http from "k6/http";
import { check, sleep } from "k6";
import { baseFor, leaderParams, vuIndex } from "./common.js";

export const options = {
  scenarios: {
    polling: { executor: "constant-vus", vus: Number(__ENV.VUS || 100), duration: __ENV.DURATION || "15m" },
  },
  thresholds: {
    "http_req_duration{name:snapshot}": ["p(95)<300", "p(99)<800"],
    "http_req_failed{name:snapshot}": ["rate<0.001"],
    checks: ["rate>0.999"],
  },
};

export default function () {
  const i = vuIndex();
  const res = http.get(`${baseFor(i)}/v1/booking/stalls`, leaderParams(i, { name: "snapshot" }));
  check(res, { "snapshot 200": (r) => r.status === 200, "no-store": (r) => r.headers["Cache-Control"] === "private, no-store" });
  sleep(2.5);
}
