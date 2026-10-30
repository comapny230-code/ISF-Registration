import { requireAdmin } from "@/lib/auth/guards";
import { hashPassword } from "@/lib/auth/password";
import { assertSameOriginJson, handler, HttpError, json, readJsonObject, strict, v } from "@/lib/http";

export const dynamic = "force-dynamic";

export const GET = handler(async (request, { requestId }) => {
  const { sql } = await requireAdmin(request, ["reports.view", "teams.manage"]);

  const users = await sql`
    select a.id,
           a.email,
           a.display_name,
           a.status,
           a.created_at,
           coalesce(
             array_agg(g.permission) filter (where g.permission is not null and g.revoked_at is null),
             '{}'::text[]
           ) as permissions
      from app_auth.admin_users a
      left join app_auth.admin_grants g on g.admin_user_id = a.id
     group by a.id, a.email, a.display_name, a.status, a.created_at
     order by a.created_at desc`;

  return json({
    users: users.map((u) => ({
      id: u.id,
      email: u.email,
      displayName: u.display_name,
      status: u.status,
      createdAt: u.created_at,
      permissions: u.permissions ?? [],
    })),
  }, 200, requestId);
});

export const POST = handler(async (request, { requestId }) => {
  assertSameOriginJson(request);
  const { sql, session } = await requireAdmin(request, ["reports.view", "teams.manage"]);

  const body = strict(await readJsonObject(request), {
    email: v.email,
    displayName: v.string(2, 100),
    password: v.string(8, 100),
  });

  const emailNorm = body.email.toLowerCase().trim();

  const [existing] = await sql`
    select id from app_auth.admin_users where lower(email) = ${emailNorm}`;

  if (existing) {
    throw new HttpError(409, "ADMIN_EXISTS", "An administrator with this email address already exists.");
  }

  const passwordHash = hashPassword(body.password);

  const [newAdmin] = await sql`
    insert into app_auth.admin_users (email, display_name, password_hash, created_by)
    values (${emailNorm}, ${body.displayName.trim()}, ${passwordHash}, ${session.principalId})
    returning id, email, display_name, status, created_at`;

  await sql`
    insert into app_auth.admin_grants (admin_user_id, permission, granted_by)
    select ${newAdmin.id}, p.perm, ${session.principalId}
      from (values ('booking.cancel'), ('inventory.manage'), ('teams.manage'), ('reports.view')) as p(perm)
    on conflict do nothing`;

  return json({
    ok: true,
    admin: {
      id: newAdmin.id,
      email: newAdmin.email,
      displayName: newAdmin.display_name,
      status: newAdmin.status,
      createdAt: newAdmin.created_at,
    },
  }, 201, requestId);
});
