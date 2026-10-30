import { verifyPassword } from "@/lib/auth/password";
import { consumeRateLimit, LIMITS } from "@/lib/auth/rate-limit";
import { createSession, SESSION_COOKIE } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import {
  assertSameOriginJson,
  clientAddress,
  handler,
  HttpError,
  json,
  readJsonObject,
  sessionCookie,
  strict,
  v,
} from "@/lib/http";

export const dynamic = "force-dynamic";

// Constant-time mitigation against admin email enumeration: 16-byte salt, 64-byte key
const DUMMY_HASH = "00000000000000000000000000000000:00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000";

export const POST = handler(async (request, { requestId }) => {
  assertSameOriginJson(request);
  const body = strict(await readJsonObject(request), {
    email: v.email,
    password: v.string(1, 100),
  });

  const emailNorm = body.email.toLowerCase().trim();

  let sql: any = null;
  try {
    sql = await getDb();
    await consumeRateLimit(sql, LIMITS.otpVerifyPerIp, clientAddress(request));
  } catch (dbErr: any) {
    if (dbErr instanceof HttpError) throw dbErr;
    throw new HttpError(
      503,
      "DATABASE_UNAVAILABLE",
      "Database service is currently unavailable. Please try again later."
    );
  }

  let admin: { id: string; email: string; display_name: string; password_hash?: string | null } | null = null;

  try {
    const rows = await sql`
      select a.id, a.email, a.display_name, a.password_hash
        from app_auth.admin_users a
       where lower(a.email) = ${emailNorm} and a.status = 'active'
         and exists (select 1 from app_auth.admin_grants g where g.admin_user_id = a.id and g.revoked_at is null)`;
    admin = rows[0] || null;
  } catch (queryErr: any) {
    const msg = String(queryErr?.message || "");
    if (msg.includes("does not exist") || queryErr?.code === "42P01") {
      throw new HttpError(
        503,
        "DB_NOT_INITIALIZED",
        "Database service is currently unavailable. Please try again later."
      );
    }
    throw new HttpError(
      503,
      "DATABASE_ERROR",
      "Database service is currently unavailable. Please try again later."
    );
  }

  // Constant-time check: if admin does not exist, run verifyPassword on dummy hash
  // so the response time does not reveal whether the admin email exists.
  if (!admin) {
    verifyPassword(body.password, DUMMY_HASH);
    throw new HttpError(401, "INVALID_CREDENTIALS", "Invalid administrator email or password.");
  }

  const valid = verifyPassword(body.password, admin.password_hash as string | null);
  if (!valid) {
    throw new HttpError(401, "INVALID_CREDENTIALS", "Invalid administrator email or password.");
  }

  // Create admin session and issue secure session cookie
  const session = await sql.begin((tx: any) => createSession(tx, "admin", admin!.id)).catch((err: any) => {
    console.warn("[admin-login] Session creation in DB failed:", err);
    return null;
  });

  if (!session) {
    throw new HttpError(
      503,
      "SESSION_FAILED",
      "Database service is currently unavailable. Please try again later."
    );
  }

  return json(
    {
      ok: true,
      admin: { id: admin.id, email: admin.email, displayName: admin.display_name },
      sessionExpiresAt: session.absoluteExpiresAt,
    },
    200,
    requestId,
    [["Set-Cookie", sessionCookie(SESSION_COOKIE.admin, session.token, session.maxAgeSeconds)]]
  );
});

