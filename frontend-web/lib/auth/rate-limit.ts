/**
 * Fixed-window counters in Postgres, shared by every application instance.
 * Bucket names are keyed HMACs, so no raw email address or IP is stored.
 * Used for login and registration; high-frequency polling is limited elsewhere.
 */
import type postgres from "postgres";
import { getAuthConfig } from "../config";
import { HttpError } from "../http";
import { hmacHex } from "./crypto";

export interface RateLimit {
  name: string;
  windowSeconds: number;
  max: number;
}

export const LIMITS = {
  otpRequestPerEmail: { name: "otp-req:email:15m", windowSeconds: 15 * 60, max: 3 },
  otpRequestPerEmailDaily: { name: "otp-req:email:24h", windowSeconds: 24 * 60 * 60, max: 10 },
  otpRequestPerIp: { name: "otp-req:ip:15m", windowSeconds: 15 * 60, max: 20 },
  otpVerifyPerIp: { name: "otp-verify:ip:15m", windowSeconds: 15 * 60, max: 50 },
  // Generous because many teams may register from one campus network address.
  holdPerUser: { name: "hold:user:1m", windowSeconds: 60, max: 30 },
  confirmPerUser: { name: "confirm:user:1m", windowSeconds: 60, max: 30 },
  releasePerUser: { name: "release:user:1m", windowSeconds: 60, max: 30 },
  ticketPerUser: { name: "ticket:user:1m", windowSeconds: 60, max: 20 },
  adminWritePerAdmin: { name: "admin-write:admin:1m", windowSeconds: 60, max: 30 },
  registrationPerIp: { name: "register:ip:15m", windowSeconds: 15 * 60, max: 30 },
  registrationCodePerEmail: { name: "reg-code:email:15m", windowSeconds: 15 * 60, max: 3 },
  registrationCodePerEmailDaily: { name: "reg-code:email:24h", windowSeconds: 24 * 60 * 60, max: 10 },
  registrationCodePerIp: { name: "reg-code:ip:15m", windowSeconds: 15 * 60, max: 20 },
} satisfies Record<string, RateLimit>;

/** Counts one hit and throws 429 once the window's limit is exceeded. */
export async function consumeRateLimit(sql: postgres.ISql, limit: RateLimit, subject: string): Promise<void> {
  const bucket = `${limit.name}:${hmacHex(getAuthConfig().rateLimitKey, subject)}`;
  const [row] = await sql`
    insert into app_auth.rate_limits (bucket, window_start, hits)
    values (
      ${bucket},
      to_timestamp(floor(extract(epoch from clock_timestamp()) / ${limit.windowSeconds}::int) * ${limit.windowSeconds}::int),
      1
    )
    on conflict (bucket, window_start) do update set hits = app_auth.rate_limits.hits + 1
    returning hits,
      ceil(extract(epoch from (window_start + make_interval(secs => ${limit.windowSeconds}::int) - clock_timestamp())))::int as retry_after`;

  if (Math.random() < 0.02) {
    await sql`delete from app_auth.rate_limits where window_start < clock_timestamp() - interval '2 days'`;
  }

  if (row.hits > limit.max) {
    const retryAfter = Math.max(1, Number(row.retry_after));
    throw new HttpError(
      429,
      "RATE_LIMITED",
      "Too many requests. Please try again later.",
      { retryAfterSeconds: retryAfter },
      { "Retry-After": String(retryAfter) }
    );
  }
}
