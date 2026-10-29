// Shared helpers for the k6 load scenarios (see load/README.md).
import exec from "k6/execution";

/** Fixture file written by scripts/load/seed-fixtures.mts (contains session tokens; keep it out of git). */
export const fixtures = JSON.parse(open(__ENV.FIXTURES));

/** One or more app instances, used round-robin (multi-instance runs). */
export const BASES = (__ENV.BASE_URLS || "http://localhost:3000").split(",").map((s) => s.trim());

/** Must equal the app's APP_ORIGIN (or an APP_EXTRA_ORIGINS entry) for state-changing requests. */
export const ORIGIN = __ENV.ORIGIN || BASES[0];

export function vuIndex() {
  return exec.vu.idInTest - 1;
}

export function baseFor(i) {
  return BASES[i % BASES.length];
}

export function leaderParams(i, tags = {}) {
  return {
    headers: {
      cookie: `__Host-sj_session=${fixtures.leaders[i % fixtures.leaders.length]}`,
      origin: ORIGIN,
      "content-type": "application/json",
    },
    tags,
  };
}

export function adminParams(i, tags = {}) {
  return { headers: { cookie: `__Host-sj_admin=${fixtures.admins[i % fixtures.admins.length]}`, origin: ORIGIN }, tags };
}

export function errorCode(res) {
  try {
    return JSON.parse(res.body).error.code;
  } catch {
    return null;
  }
}
