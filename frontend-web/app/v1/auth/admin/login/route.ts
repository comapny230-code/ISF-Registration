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

export const POST = handler(async (request, { requestId }) => {
  assertSameOriginJson(request);
  const body = strict(await readJsonObject(request), {
    email: v.email,
    password: v.string(1, 100),
  });

  const sql = await getDb();
  await consumeRateLimit(sql, LIMITS.otpVerifyPerIp, clientAddress(request));

  const emailNorm = body.email.toLowerCase().trim();

  // Find active admin with live permissions
  const [admin] = await sql`
    select a.id, a.email, a.display_name, a.password_hash
      from app_auth.admin_users a
     where lower(a.email) = ${emailNorm} and a.status = 'active'
       and exists (select 1 from app_auth.admin_grants g where g.admin_user_id = a.id and g.revoked_at is null)`;

  if (!admin || !verifyPassword(body.password, admin.password_hash as string | null)) {
    throw new HttpError(401, "INVALID_CREDENTIALS", "Invalid administrator email or password.");
  }

  // Create admin session and issue secure session cookie
  const session = await sql.begin((tx) => createSession(tx, "admin", admin.id));

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
