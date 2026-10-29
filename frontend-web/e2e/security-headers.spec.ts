/** Hardening: every page and API response carries the security headers (next.config.ts). */
import { expect, test } from "@playwright/test";
import { SECURITY_HEADERS } from "../next.config";

for (const path of ["/", "/register", "/login", "/book-your-stall", "/admin/login", "/v1/booking/stalls", "/v1/auth/session"]) {
  test(`security headers on ${path}`, async ({ request }) => {
    const res = await request.get(path, { maxRedirects: 0 });
    for (const { key, value } of SECURITY_HEADERS) {
      expect(res.headers()[key.toLowerCase()], `${key} on ${path}`).toBe(value);
    }
    expect(res.headers()["x-powered-by"]).toBeUndefined();
  });
}
