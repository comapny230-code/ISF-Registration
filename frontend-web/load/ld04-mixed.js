// LD-04: mixed traffic (spec §9.7): 100 leaders polling, 50 leaders booking, 2 admins reading.
// Pass: LD-01 thresholds for polling, writes p95 < 1.5 s, no 5xx; then check invariants.
import http from "k6/http";
import { check, sleep } from "k6";
import { Counter } from "k6/metrics";
import { adminParams, baseFor, errorCode, fixtures, leaderParams, vuIndex } from "./common.js";

const DURATION = __ENV.DURATION || "5m";
const serverErrors = new Counter("server_errors");

export const options = {
  scenarios: {
    polling: { executor: "constant-vus", vus: 100, duration: DURATION, exec: "poll" },
    booking: { executor: "constant-vus", vus: 50, duration: DURATION, exec: "book" },
    admins: { executor: "constant-vus", vus: 2, duration: DURATION, exec: "admin" },
  },
  thresholds: {
    "http_req_duration{name:snapshot}": ["p(95)<300", "p(99)<800"],
    "http_req_duration{name:hold}": ["p(95)<1500"],
    "http_req_duration{name:confirm}": ["p(95)<1500"],
    "http_req_duration{name:release}": ["p(95)<1500"],
    server_errors: ["count<1"],
  },
};

function note(res) {
  if (res.status >= 500) serverErrors.add(1);
}

/** Every VU in the test gets its own leader (VU ids are unique across scenarios). */
function leaderIndex() {
  const i = vuIndex();
  if (i >= fixtures.leaders.length) throw new Error("seed at least as many leaders as total VUs (152)");
  return i;
}

export function poll() {
  const i = leaderIndex();
  const res = http.get(`${baseFor(i)}/v1/booking/stalls`, leaderParams(i, { name: "snapshot" }));
  note(res);
  if (res.status !== 200) console.warn(`snapshot ${res.status} ${String(res.body).slice(0, 160)}`);
  check(res, { "snapshot 200": (r) => r.status === 200 });
  sleep(2.5);
}

let booked = false;
export function book() {
  if (booked) return sleep(5);
  const i = leaderIndex();
  const base = baseFor(i);
  const stall = fixtures.stalls[Math.floor(Math.random() * fixtures.stalls.length)];
  const held = http.post(`${base}/v1/booking/holds`, JSON.stringify({ stallId: stall.id }), leaderParams(i, { name: "hold" }));
  note(held);
  if (held.status === 201 || held.status === 200) {
    const hold = JSON.parse(held.body);
    sleep(1 + Math.random() * 2);
    if (Math.random() < 0.5) {
      const res = http.post(`${base}/v1/booking/holds/${hold.holdId}/confirm`, JSON.stringify({ token: hold.token }), leaderParams(i, { name: "confirm" }));
      note(res);
      booked = res.status === 201 || res.status === 200;
    } else {
      const res = http.del(`${base}/v1/booking/holds/${hold.holdId}`, "{}", leaderParams(i, { name: "release" }));
      note(res);
    }
  } else if (errorCode(held) === "TEAM_ALREADY_BOOKED") {
    booked = true;
  }
  sleep(1 + Math.random() * 2);
}

export function admin() {
  const i = vuIndex();
  const res = http.get(`${baseFor(i)}/v1/admin/bookings?limit=50`, adminParams(i, { name: "admin_list" }));
  note(res);
  check(res, { "admin list 200": (r) => r.status === 200 });
  sleep(5);
}
