/**
 * HTTP-ERR: an unreachable database is a retryable 503 with a generic message (no hint about
 * DATABASE_URL or other settings); any other unexpected error is a sanitised 500.
 */
import { describe, expect, it, vi } from "vitest";
import { handler } from "@/lib/http";

const call = async (err: unknown) => {
  const spy = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    const res = await handler(async () => {
      throw err;
    })(new Request("http://localhost:3000/v1/x"));
    return { status: res.status, retryAfter: res.headers.get("retry-after"), body: (await res.json()) as any };
  } finally {
    spy.mockRestore();
  }
};

describe("HTTP-ERR handler", () => {
  it("answers 503 with Retry-After when the database cannot be reached", async () => {
    for (const code of ["ECONNREFUSED", "ETIMEDOUT", "ENOTFOUND", "EAI_AGAIN", "CONNECT_TIMEOUT"]) {
      const res = await call(Object.assign(new Error(`connect ${code} 10.0.0.1:6543`), { code }));
      expect(res.status, code).toBe(503);
      expect(res.retryAfter).toBe("30");
      expect(res.body.error.code).toBe("SERVICE_UNAVAILABLE");
      expect(JSON.stringify(res.body)).not.toMatch(/DATABASE_URL|10\.0\.0\.1|Vercel/);
    }
  });

  it("keeps other errors a sanitised 500, even if their message mentions a timeout or connection", async () => {
    const res = await call(Object.assign(new Error("canceling statement due to lock timeout; connection 7"), { code: "55P03" }));
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe("INTERNAL");
    expect(JSON.stringify(res.body)).not.toContain("lock timeout");
  });
});
