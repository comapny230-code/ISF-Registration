/** Admin test support: seeded administrators with sessions, and API wrappers for E10–E15. */
import { randomUUID } from "node:crypto";
import * as auditRoute from "@/app/v1/admin/audit/route";
import * as bookingsRoute from "@/app/v1/admin/bookings/route";
import * as cancelRoute from "@/app/v1/admin/bookings/[bookingId]/cancel/route";
import * as availabilityRoute from "@/app/v1/admin/stalls/[stallId]/availability/route";
import * as teamsRoute from "@/app/v1/admin/teams/route";
import * as approvalRoute from "@/app/v1/admin/teams/[teamId]/approval/route";
import type { AdminPermission } from "@/lib/auth/guards";
import { createSession } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { apiRequest, call } from "./http";

let n = 0;
export interface Admin {
  id: string;
  name: string;
  cookie: string;
}

export async function createAdmin(permissions: AdminPermission[]): Promise<Admin> {
  const sql = await getDb();
  n += 1;
  const name = `Admin ${n}`;
  const [admin] = await sql`
    insert into app_auth.admin_users (email, display_name, created_by) values (${`admin${n}-${randomUUID().slice(0, 8)}@example.test`}, ${name}, 'test')
    returning id`;
  for (const permission of permissions) {
    await sql`insert into app_auth.admin_grants (admin_user_id, permission, granted_by) values (${admin.id}, ${permission}, 'test')`;
  }
  const session = await sql.begin((tx) => createSession(tx, "admin", admin.id));
  return { id: admin.id, name, cookie: `__Host-sj_admin=${session.token}` };
}

export async function expireStepUp(admin: Admin) {
  const sql = await getDb();
  await sql`update app_auth.sessions set reauth_at = clock_timestamp() - interval '11 minutes' where admin_user_id = ${admin.id}`;
}

const withParams = <P extends Record<string, string>>(fn: (req: Request, ctx: { params: Promise<P> }) => Promise<Response>, params: P) =>
  (req: Request) => fn(req, { params: Promise.resolve(params) });

export const cancelBooking = (cookie: string, bookingId: string, body: Record<string, unknown>, origin?: string) =>
  call(withParams(cancelRoute.POST, { bookingId }), apiRequest(`/v1/admin/bookings/${bookingId}/cancel`, body, { cookie, origin }));

export const setAvailability = (cookie: string, stallId: string, body: Record<string, unknown>) =>
  call(withParams(availabilityRoute.POST, { stallId }), apiRequest(`/v1/admin/stalls/${stallId}/availability`, body, { cookie }));

export const setApproval = (cookie: string, teamId: string, body: Record<string, unknown>) =>
  call(withParams(approvalRoute.POST, { teamId }), apiRequest(`/v1/admin/teams/${teamId}/approval`, body, { cookie }));

export const listBookings = (cookie?: string, query = "") =>
  call(bookingsRoute.GET, apiRequest(`/v1/admin/bookings${query}`, undefined, { cookie }));

export const listTeams = (cookie?: string, query = "") =>
  call(teamsRoute.GET, apiRequest(`/v1/admin/teams${query}`, undefined, { cookie }));

export const listAudit = (cookie?: string, query = "") =>
  call(auditRoute.GET, apiRequest(`/v1/admin/audit${query}`, undefined, { cookie }));

export const reason = "Organiser decision recorded in the event log";
