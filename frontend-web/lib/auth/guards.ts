/**
 * Per-handler authorisation (docs/STALL_BOOKING_FINAL_SPEC.md §3.5). Every
 * protected route handler calls one of these itself; nothing relies on
 * middleware or page navigation.
 */
import type postgres from "postgres";
import { getDb } from "../db";
import { HttpError } from "../http";
import { getSession, type Session } from "./session";

export type AdminPermission = "booking.cancel" | "inventory.manage" | "teams.manage" | "reports.view";

export interface Authenticated {
  sql: postgres.Sql;
  session: Session;
}

const UNAUTHENTICATED = () => new HttpError(401, "UNAUTHENTICATED", "Please sign in to continue.");

export async function requireLeader(request: Request): Promise<Authenticated> {
  const sql = await getDb();
  const session = await getSession(sql, request, "leader");
  if (!session) throw UNAUTHENTICATED();
  return { sql, session };
}

export async function requireAdmin(
  request: Request,
  permission: AdminPermission,
  options: { stepUp?: boolean } = {}
): Promise<Authenticated> {
  const sql = await getDb();
  const session = await getSession(sql, request, "admin");
  if (!session) throw UNAUTHENTICATED();

  const [grant] = await sql`
    select 1 from app_auth.admin_grants
     where admin_user_id = ${session.principalId} and permission = ${permission} and revoked_at is null`;
  if (!grant) throw new HttpError(403, "FORBIDDEN", "You do not have permission to do this.");

  if (options.stepUp && !session.reauthFresh) {
    throw new HttpError(403, "REAUTH_REQUIRED", "Please confirm it is you with a new sign-in code.");
  }
  return { sql, session };
}

export async function adminPermissions(sql: postgres.ISql, adminUserId: string): Promise<AdminPermission[]> {
  const rows = await sql`
    select permission from app_auth.admin_grants
     where admin_user_id = ${adminUserId} and revoked_at is null order by permission`;
  return rows.map((r) => r.permission as AdminPermission);
}
