/**
 * AUTH-15: every /v1 route handler must authorise itself (no reliance on
 * middleware). Unauthenticated endpoints are an explicit, reviewed list.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const v1 = path.resolve(__dirname, "../../app/v1");

const UNAUTHENTICATED_BY_DESIGN = new Map<string, string>([
  ["[...route]/route.ts", "public registration (E16) and 404 fallback"],
  ["auth/otp/request/route.ts", "login step 1 (E1)"],
  ["auth/otp/verify/route.ts", "login step 2 (E2)"],
  ["auth/logout/route.ts", "revokes only the caller's own cookie (E3)"],
  ["auth/session/route.ts", "reports the caller's own sessions (E4)"],
  ["auth/register/email-code/route.ts", "registration step: emails a code to the address being registered"],
  ["auth/register/form-token/route.ts", "registration step: signed form timestamp, no data"],
  ["health/route.ts", "uptime check: database reachable or not, nothing else"],
  ["booking/stalls/route.ts", "authorises inline: leader or admin session, or organiser-enabled public map (E5)"],
]);

function routeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return routeFiles(full);
    return name === "route.ts" ? [full] : [];
  });
}

describe("AUTH-15 per-handler authorisation", () => {
  const files = routeFiles(v1).map((f) => path.relative(v1, f).split(path.sep).join("/"));

  it("finds the route files", () => {
    expect(files.length).toBeGreaterThanOrEqual(UNAUTHENTICATED_BY_DESIGN.size);
  });

  it("every exemption still exists (the list cannot silently go stale)", () => {
    for (const exempt of UNAUTHENTICATED_BY_DESIGN.keys()) expect(files).toContain(exempt);
  });

  it("every other route calls requireLeader or requireAdmin", () => {
    const unguarded = files
      .filter((f) => !UNAUTHENTICATED_BY_DESIGN.has(f))
      .filter((f) => !/\brequire(Leader|Admin)\(/.test(readFileSync(path.join(v1, f), "utf8")));
    expect(unguarded).toEqual([]);
  });

  it("the status route still refuses anonymous callers unless the public map is enabled", () => {
    const source = readFileSync(path.join(v1, "booking/stalls/route.ts"), "utf8");
    expect(source).toMatch(/getSession\(sql, request, "leader"\)/);
    expect(source).toMatch(/if \(!settings\?\.public_map\) throw new HttpError\(401/);
  });

  it("every state-changing exempt route except registration enforces same-origin JSON", () => {
    for (const f of ["auth/otp/request/route.ts", "auth/otp/verify/route.ts", "auth/logout/route.ts", "auth/register/email-code/route.ts"]) {
      expect(readFileSync(path.join(v1, f), "utf8")).toMatch(/assertSameOriginJson\(request\)/);
    }
  });
});
