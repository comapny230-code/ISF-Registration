// LD-03: more teams than stalls race to hold and confirm random stalls until sold out (spec §9.7).
// Pass: no stall or team booked twice (run scripts/load/check-invariants.mts afterwards),
// bookings never exceed stalls, nearly every stall sold, unexpected 5xx < 0.5 %.
import http from "k6/http";
import { sleep } from "k6";
import { Counter, Rate } from "k6/metrics";
import { baseFor, errorCode, fixtures, leaderParams, vuIndex } from "./common.js";

const STALLS = fixtures.stalls.length;
const bookings = new Counter("bookings");
const serverErrors = new Rate("server_error_rate");

export const options = {
  scenarios: {
    sellout: { executor: "per-vu-iterations", vus: Number(__ENV.VUS || fixtures.leaders.length), iterations: 1, maxDuration: "5m" },
  },
  thresholds: {
    bookings: [`count<=${STALLS}`, `count>=${Math.floor(STALLS * 0.9)}`],
    server_error_rate: ["rate<0.005"],
    "http_req_duration{name:hold}": ["p(95)<1500"],
    "http_req_duration{name:confirm}": ["p(95)<1500"],
  },
};

export default function () {
  const i = vuIndex();
  const base = baseFor(i);
  for (let attempt = 0; attempt < 20; attempt++) {
    const stall = fixtures.stalls[Math.floor(Math.random() * STALLS)];
    const held = http.post(`${base}/v1/booking/holds`, JSON.stringify({ stallId: stall.id }), leaderParams(i, { name: "hold" }));
    serverErrors.add(held.status >= 500);
    if (held.status === 201 || held.status === 200) {
      const hold = JSON.parse(held.body);
      const booked = http.post(`${base}/v1/booking/holds/${hold.holdId}/confirm`, JSON.stringify({ token: hold.token }), leaderParams(i, { name: "confirm" }));
      serverErrors.add(booked.status >= 500);
      if (booked.status === 201) bookings.add(1);
      return;
    }
    if (errorCode(held) === "TEAM_ALREADY_BOOKED") return;
    sleep(held.status === 429 || held.status === 503 ? 1 : 0.2 + Math.random() * 0.3);
  }
}
