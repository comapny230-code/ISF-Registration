/** GET /v1/health: for uptime monitoring; says only whether the database is reachable. */
import { describe, expect, it } from "vitest";
import * as route from "@/app/v1/health/route";
import { closeDb } from "@/lib/db";
import { apiRequest, call } from "../support/http";

describe("health check", () => {
  it("reports ok, uncached, with nothing else in the body", async () => {
    const res = await call(route.GET, apiRequest("/v1/health"));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
    expect(res.headers.get("cache-control")).toBe("private, no-store");
  });

  it("reports unavailable (503) without details when the database cannot be reached", async () => {
    const saved = process.env.TEST_DATABASE_URL!;
    await closeDb();
    const url = new URL(saved);
    url.port = "1"; // nothing listens here
    process.env.TEST_DATABASE_URL = url.toString();
    try {
      const res = await call(route.GET, apiRequest("/v1/health"));
      expect(res.status).toBe(503);
      expect(res.body).toEqual({ status: "unavailable" });
    } finally {
      process.env.TEST_DATABASE_URL = saved;
      await closeDb();
    }
  });
});
