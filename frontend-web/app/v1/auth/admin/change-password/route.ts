import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { getSession } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import {
  assertSameOriginJson,
  handler,
  HttpError,
  json,
  readJsonObject,
  strict,
  v,
} from "@/lib/http";

export const dynamic = "force-dynamic";

export const POST = handler(async (request, { requestId }) => {
  assertSameOriginJson(request);
  const sql = await getDb();

  const session = await getSession(sql, request, "admin");
  if (!session) {
    throw new HttpError(401, "UNAUTHORIZED", "Administrator session is required.");
  }

  const body = strict(await readJsonObject(request), {
    currentPassword: v.string(1, 100),
    newPassword: v.string(12, 100),
  });

  const [admin] = await sql`
    select id, email, password_hash
      from app_auth.admin_users
     where id = ${session.principalId} and status = 'active'`;

  if (!admin || !verifyPassword(body.currentPassword, admin.password_hash as string | null)) {
    throw new HttpError(400, "INVALID_CURRENT_PASSWORD", "Current password is incorrect.");
  }

  const newHash = hashPassword(body.newPassword);
  await sql`
    update app_auth.admin_users
       set password_hash = ${newHash}
     where id = ${admin.id}`;

  return json({ ok: true, message: "Administrator password updated successfully." }, 200, requestId);
});
