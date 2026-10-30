import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { consumeRateLimit, LIMITS } from "@/lib/auth/rate-limit";
import { createSession, SESSION_COOKIE } from "@/lib/auth/session";
import { getAdminBootstrapConfig } from "@/lib/config";
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

  const emailNorm = body.email.toLowerCase().trim();

  // 1. Support environment-configured administrator (e.g. set in Vercel settings)
  const envAdmin = getAdminBootstrapConfig();
  const isEnvAdmin =
    Boolean(envAdmin.email) &&
    emailNorm === envAdmin.email &&
    Boolean(
      (envAdmin.password && body.password === envAdmin.password) ||
      (envAdmin.hash && verifyPassword(body.password, envAdmin.hash))
    );

  let sql: any = null;
  try {
    sql = await getDb();
    await consumeRateLimit(sql, LIMITS.otpVerifyPerIp, clientAddress(request)).catch(() => {});
  } catch (dbErr) {
    if (!isEnvAdmin) {
      throw new HttpError(
        503,
        "DATABASE_UNAVAILABLE",
        "Unable to connect to database. Please check DATABASE_URL in Vercel settings or set ADMIN_EMAIL & ADMIN_PASSWORD."
      );
    }
  }

  let admin: { id: string; email: string; display_name: string; password_hash?: string | null } | null = null;

  if (sql) {
    try {
      if (isEnvAdmin) {
        // Ensure env admin exists in app_auth.admin_users and has grants
        const passwordHash = hashPassword(body.password);
        const [upserted] = await sql`
          insert into app_auth.admin_users (email, display_name, password_hash, created_by)
          values (${emailNorm}, 'Administrator', ${passwordHash}, 'env-config')
          on conflict (email) do update set status = 'active', password_hash = excluded.password_hash
          returning id, email, display_name`;
        await sql`
          insert into app_auth.admin_grants (admin_user_id, permission, granted_by)
          select ${upserted.id}, p.perm, 'env-config'
            from (values ('booking.cancel'), ('inventory.manage'), ('teams.manage'), ('reports.view')) as p(perm)
          on conflict do nothing`;
        admin = upserted;
      } else {
        const rows = await sql`
          select a.id, a.email, a.display_name, a.password_hash
            from app_auth.admin_users a
           where lower(a.email) = ${emailNorm} and a.status = 'active'
             and exists (select 1 from app_auth.admin_grants g where g.admin_user_id = a.id and g.revoked_at is null)`;
        admin = rows[0] || null;
      }
    } catch (queryErr: any) {
      if (!isEnvAdmin) {
        const msg = String(queryErr?.message || "");
        if (msg.includes("does not exist") || queryErr?.code === "42P01") {
          throw new HttpError(
            503,
            "DB_NOT_INITIALIZED",
            "Database tables are not initialized. Please run database setup or migrations."
          );
        }
        throw new HttpError(
          503,
          "DATABASE_ERROR",
          "Database query failed. Please verify your database connection in Vercel."
        );
      }
    }
  }

  if (!isEnvAdmin) {
    if (!admin || !verifyPassword(body.password, admin.password_hash as string | null)) {
      throw new HttpError(401, "INVALID_CREDENTIALS", "Invalid administrator email or password.");
    }
  }

  // Create admin session and issue secure session cookie
  let session: any = null;
  if (sql && admin) {
    try {
      session = await sql.begin((tx: any) => createSession(tx, "admin", admin.id));
    } catch (sessionErr) {
      console.warn("[admin-login] Session creation in DB failed:", sessionErr);
    }
  }

  if (!session) {
    throw new HttpError(
      503,
      "SESSION_FAILED",
      "Could not establish database session. Please verify database connectivity."
    );
  }

  return json(
    {
      ok: true,
      admin: { id: admin?.id, email: admin?.email, displayName: admin?.display_name },
      sessionExpiresAt: session.absoluteExpiresAt,
    },
    200,
    requestId,
    [["Set-Cookie", sessionCookie(SESSION_COOKIE.admin, session.token, session.maxAgeSeconds)]]
  );
});

