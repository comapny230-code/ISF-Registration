/**
 * Shared HTTP conventions for /v1 handlers (docs/STALL_BOOKING_FINAL_SPEC.md §5.1).
 */
import { randomUUID } from "node:crypto";
import { ConfigError, getAuthConfig } from "./config";
import { isSafeEmailAddress } from "./email-address";
import { TestDatabaseGuardError } from "./safety/test-database-guard";

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>,
    readonly headers?: Record<string, string>
  ) {
    super(message);
    this.name = "HttpError";
  }
}

const BASE_HEADERS = { "Cache-Control": "private, no-store" };

export function json(body: unknown, status: number, requestId: string, headers: HeadersInit = {}): Response {
  const res = Response.json(body, { status, headers: { ...BASE_HEADERS, "X-Request-Id": requestId } });
  new Headers(headers).forEach((value, key) => res.headers.append(key, value));
  return res;
}

export function noContent(requestId: string, headers: HeadersInit = {}): Response {
  const res = new Response(null, { status: 204, headers: { ...BASE_HEADERS, "X-Request-Id": requestId } });
  new Headers(headers).forEach((value, key) => res.headers.append(key, value));
  return res;
}

export interface HandlerContext<P = Record<string, string>> {
  requestId: string;
  /** Dynamic route segments (e.g. { holdId }). */
  params: P;
}

/** Wraps a handler with request IDs, error mapping and sanitised failures. */
export function handler<P extends Record<string, string> = Record<string, string>>(
  fn: (request: Request, ctx: HandlerContext<P>) => Promise<Response>
) {
  return async (request: Request, routeContext?: { params: Promise<P> }): Promise<Response> => {
    const requestId = randomUUID();
    try {
      const params = (routeContext?.params ? await routeContext.params : {}) as P;
      return await fn(request, { requestId, params });
    } catch (err) {
      if (err instanceof HttpError) {
        return json(
          { error: { code: err.code, message: err.message, requestId, ...(err.details ? { details: err.details } : {}) } },
          err.status,
          requestId,
          err.headers
        );
      }
      const misconfigured = err instanceof ConfigError || err instanceof TestDatabaseGuardError;
      const isDbConnError =
        (err as any)?.code === "ECONNREFUSED" ||
        (err as any)?.code === "ETIMEDOUT" ||
        (err as any)?.code === "ENOTFOUND" ||
        (err as any)?.code === "ENODATA" ||
        (err as any)?.code === "EAI_AGAIN" ||
        (err as any)?.code === "CONNECT_TIMEOUT" ||
        String((err as any)?.message || "").toLowerCase().includes("timeout") ||
        String((err as any)?.message || "").toLowerCase().includes("connect");

      console.error(misconfigured ? "[CONFIG ERROR]" : isDbConnError ? "[DB ERROR]" : "[UNHANDLED ERROR]", {
        requestId,
        path: new URL(request.url).pathname,
        name: (err as any)?.name,
        code: (err as any)?.code,
        constraint: (err as any)?.constraint_name,
        message: (err as any)?.message,
      });
      if (misconfigured) {
        return json(
          { error: { code: "SERVICE_MISCONFIGURED", message: (err as any)?.message || "This service is temporarily unavailable.", requestId } },
          503,
          requestId
        );
      }
      if (isDbConnError) {
        return json(
          {
            error: {
              code: "DATABASE_UNAVAILABLE",
              message: "Unable to reach database. Please check DATABASE_URL in Vercel settings.",
              requestId,
            },
          },
          503,
          requestId
        );
      }
      return json({ error: { code: "INTERNAL", message: "An unexpected error occurred.", requestId } }, 500, requestId);
    }
  };
}

// ---------------------------------------------------------------------------
// CSRF: every state-changing request must be same-origin JSON.
// ---------------------------------------------------------------------------

export function assertSameOriginJson(request: Request): void {
  const { allowedOrigins } = getAuthConfig();
  let origin = request.headers.get("origin");

  // Fallback to referer origin if origin header is omitted by browser on same-site fetch
  if (!origin) {
    const referer = request.headers.get("referer");
    if (referer) {
      try {
        origin = new URL(referer).origin;
      } catch {}
    }
  }

  if (!origin) {
    throw new HttpError(403, "CSRF_REJECTED", "Request origin is not allowed.");
  }

  let allowed = false;
  try {
    const originUrl = new URL(origin);
    const reqUrl = new URL(request.url);

    const forwardedHost = request.headers.get("x-forwarded-host") || request.headers.get("host") || reqUrl.host;
    const forwardedProto = request.headers.get("x-forwarded-proto") || (reqUrl.protocol ? reqUrl.protocol.replace(":", "") : "http");
    const currentOrigin = `${forwardedProto}://${forwardedHost}`.toLowerCase();

    if (
      originUrl.origin.toLowerCase() === reqUrl.origin.toLowerCase() ||
      originUrl.origin.toLowerCase() === currentOrigin ||
      originUrl.host.toLowerCase() === forwardedHost.toLowerCase() ||
      originUrl.hostname === "localhost" ||
      originUrl.hostname === "127.0.0.1" ||
      originUrl.hostname === "::1" ||
      originUrl.hostname.endsWith(".vercel.app") ||
      originUrl.hostname.endsWith(".startupjathara.com") ||
      originUrl.hostname === "startupjathara.com" ||
      allowedOrigins.some((allowedO) => allowedO.toLowerCase() === originUrl.origin.toLowerCase())
    ) {
      allowed = true;
    }
  } catch {
    allowed = false;
  }

  if (!allowed) {
    throw new HttpError(403, "CSRF_REJECTED", "Request origin is not allowed.");
  }

  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin") {
    throw new HttpError(403, "CSRF_REJECTED", "Cross-site requests are not allowed.");
  }
  const contentType = (request.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
  if (contentType !== "application/json") {
    throw new HttpError(403, "CSRF_REJECTED", "Requests must be sent as application/json.");
  }
}

// ---------------------------------------------------------------------------
// Strict JSON bodies
// ---------------------------------------------------------------------------

export async function readJsonObject(request: Request, maxBytes = 4096): Promise<Record<string, unknown>> {
  const text = await request.text();
  if (text.length > maxBytes) throw new HttpError(413, "PAYLOAD_TOO_LARGE", "Request body is too large.");
  let parsed: unknown;
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    throw new HttpError(400, "VALIDATION", "Request body must be valid JSON.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new HttpError(400, "VALIDATION", "Request body must be a JSON object.");
  }
  return parsed as Record<string, unknown>;
}

type Validator<T> = (value: unknown, field: string) => T;

/** Validates a body against field validators and rejects unknown keys. */
export function strict<T extends Record<string, unknown>>(
  body: Record<string, unknown>,
  shape: { [K in keyof T]: Validator<T[K]> }
): T {
  const unknown = Object.keys(body).filter((key) => !(key in shape));
  if (unknown.length > 0) {
    throw new HttpError(400, "VALIDATION", "Request contains unexpected fields.", { fields: unknown });
  }
  const out = {} as T;
  for (const key of Object.keys(shape) as Array<keyof T>) {
    out[key] = shape[key](body[key as string], key as string);
  }
  return out;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const v = {
  email: (value: unknown, field: string): string => {
    const email = typeof value === "string" ? value.trim().toLowerCase() : "";
    if (!email || !EMAIL_PATTERN.test(email) || !isSafeEmailAddress(email)) {
      throw new HttpError(400, "VALIDATION", `${field} must be a valid email address.`, { field });
    }
    return email;
  },
  oneOf:
    <T extends string>(...allowed: T[]) =>
    (value: unknown, field: string): T => {
      if (typeof value !== "string" || !allowed.includes(value as T)) {
        throw new HttpError(400, "VALIDATION", `${field} must be one of: ${allowed.join(", ")}.`, { field });
      }
      return value as T;
    },
  uuid: (value: unknown, field: string): string => {
    if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value)) {
      throw new HttpError(400, "VALIDATION", `${field} must be a valid identifier.`, { field });
    }
    return value;
  },
  /** Mandatory human-readable reason for administrative changes (10–500 characters). */
  reason: (value: unknown, field: string): string => {
    const text = typeof value === "string" ? value.trim() : "";
    if (text.length < 10 || text.length > 500) {
      throw new HttpError(400, "VALIDATION", `${field} must be between 10 and 500 characters.`, { field });
    }
    return text;
  },
  optionalBoolean: (value: unknown, field: string): boolean => {
    if (value === undefined) return false;
    if (typeof value !== "boolean") throw new HttpError(400, "VALIDATION", `${field} must be true or false.`, { field });
    return value;
  },
  string:
    (min = 1, max = 500) =>
    (value: unknown, field: string): string => {
      const text = typeof value === "string" ? value.trim() : "";
      if (text.length < min || text.length > max) {
        throw new HttpError(400, "VALIDATION", `${field} must be between ${min} and ${max} characters.`, { field });
      }
      return text;
    },
  pattern:
    (re: RegExp) =>
    (value: unknown, field: string): string => {
      if (typeof value !== "string" || !re.test(value)) {
        throw new HttpError(400, "VALIDATION", `${field} has an invalid format.`, { field });
      }
      return value;
    },
};

/** Reads and validates list query parameters; unknown parameters are rejected. */
export function listQuery<T extends Record<string, string | null>>(
  request: Request,
  allowed: { [K in keyof T]: (value: string | null) => T[K] },
  maxLimit: number
): T & { cursor: string | null; limit: number } {
  const params = new URL(request.url).searchParams;
  const known = new Set([...Object.keys(allowed), "cursor", "limit"]);
  const unknown = [...params.keys()].filter((k) => !known.has(k));
  if (unknown.length > 0) throw new HttpError(400, "VALIDATION", "Unexpected query parameters.", { fields: unknown });

  const out = {} as T;
  for (const key of Object.keys(allowed) as Array<keyof T>) out[key] = allowed[key](params.get(key as string));
  const rawLimit = params.get("limit");
  const limit = rawLimit === null ? Math.min(50, maxLimit) : Number(rawLimit);
  if (!Number.isInteger(limit) || limit < 1 || limit > maxLimit) {
    throw new HttpError(400, "VALIDATION", `limit must be between 1 and ${maxLimit}.`);
  }
  const cursor = params.get("cursor");
  if (cursor !== null && !/^[A-Za-z0-9_-]{1,512}$/.test(cursor)) throw new HttpError(400, "VALIDATION", "cursor is invalid.");
  return { ...out, cursor, limit };
}

export const q = {
  oneOfOrNull:
    <T extends string>(...allowed: T[]) =>
    (value: string | null): T | null => {
      if (value === null) return null;
      if (!allowed.includes(value as T)) throw new HttpError(400, "VALIDATION", `Expected one of: ${allowed.join(", ")}.`);
      return value as T;
    },
  uuidOrNull: (value: string | null): string | null => (value === null ? null : v.uuid(value, "id")),
  zoneOrNull: (value: string | null): string | null => {
    if (value === null) return null;
    if (!/^[A-Z]{2}$/.test(value)) throw new HttpError(400, "VALIDATION", "zone must be a two-letter zone code.");
    return value;
  },
};

// ---------------------------------------------------------------------------
// Cookies and client address
// ---------------------------------------------------------------------------

export function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index > 0 && part.slice(0, index).trim() === name) return part.slice(index + 1).trim() || null;
  }
  return null;
}

export function sessionCookie(name: string, value: string, maxAgeSeconds: number): string {
  return `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${Math.max(0, Math.floor(maxAgeSeconds))}`;
}

export function clearedCookie(name: string): string {
  return `${name}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

/**
 * Client IP for rate limiting. On Vercel the platform sets x-forwarded-for
 * (verify under blocker B-11); elsewhere requests share the "unknown" bucket.
 */
export function clientAddress(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  const first = forwarded?.split(",")[0]?.trim();
  return first || request.headers.get("x-real-ip")?.trim() || "unknown";
}
