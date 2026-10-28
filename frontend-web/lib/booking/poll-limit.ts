/**
 * Soft, per-instance limit for the status poll (spec §5.3 E5). Polling is
 * read-only and frequent, so it is not counted in the database; a platform
 * firewall rule is the shared limit in production (blocker B-11).
 */
import { HttpError } from "../http";

const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 40;
const buckets = new Map<string, { start: number; count: number }>();

export function consumePoll(key: string, now = Date.now()): void {
  if (buckets.size > 10_000) {
    for (const [k, b] of buckets) if (now - b.start >= WINDOW_MS) buckets.delete(k);
  }
  const bucket = buckets.get(key);
  if (!bucket || now - bucket.start >= WINDOW_MS) {
    buckets.set(key, { start: now, count: 1 });
    return;
  }
  bucket.count += 1;
  if (bucket.count > MAX_PER_WINDOW) {
    const retryAfter = Math.max(1, Math.ceil((bucket.start + WINDOW_MS - now) / 1000));
    throw new HttpError(429, "RATE_LIMITED", "Too many requests. Please slow down.", { retryAfterSeconds: retryAfter }, {
      "Retry-After": String(retryAfter),
    });
  }
}
