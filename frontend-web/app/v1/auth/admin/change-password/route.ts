import { requireAdmin } from "@/lib/auth/guards";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
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
  const { sql, session } = await requireAdmin(request, [
    "reports.view",
    "teams.manage",
    "inventory.manage",
    "booking.cancel",
  ]);

  const body = strict(await readJsonObject(request), {
    currentPassword: v.string(1, 100),
    newPassword: v.string(6, 100),
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
