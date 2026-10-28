/** Browser client for the admin API (E10–E15) and administrator step-up sign-in. */
import { post, request } from "./client-api";

export type AdminPermission = "booking.cancel" | "inventory.manage" | "teams.manage" | "reports.view";

export interface AdminBooking {
  bookingId: string;
  bookingRef: string;
  stallCode: string;
  zone: string;
  teamName: string;
  track: string;
  leaderName: string;
  leaderEmail: string;
  leaderMobile: string;
  confirmedAt: string;
  status: "confirmed" | "cancelled";
  cancelledAt?: string;
  cancelReason?: string;
}

export interface AdminTeam {
  teamId: string;
  track: "senior" | "junior";
  teamName: string;
  leaderName: string;
  leaderEmail: string;
  approvalStatus: "pending" | "approved" | "rejected";
  reservation: null | { kind: "hold" | "booking"; stallCode: string; bookingRef?: string };
}

export interface AuditItem {
  id: string;
  occurredAt: string;
  action: string;
  actorType: string;
  actorName: string | null;
  teamName: string | null;
  stallCode: string | null;
  reason: string | null;
}

interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

const qs = (params: Record<string, string | null | undefined>) => {
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) search.set(k, v);
  const text = search.toString();
  return text ? `?${text}` : "";
};

export const adminApi = {
  bookings: (cursor?: string | null) => request<Page<AdminBooking>>(`/v1/admin/bookings${qs({ cursor, limit: "50" })}`),
  teams: (approval?: string | null, cursor?: string | null) =>
    request<Page<AdminTeam> & { unresolved: { ambiguousLeaders: number; nullEditionLeaders: number; leadersWithoutTeam: number } }>(
      `/v1/admin/teams${qs({ approval, cursor, limit: "50" })}`
    ),
  audit: (cursor?: string | null) => request<Page<AuditItem>>(`/v1/admin/audit${qs({ cursor, limit: "50" })}`),
  cancel: (bookingId: string, reason: string, requestId: string) =>
    post(`/v1/admin/bookings/${encodeURIComponent(bookingId)}/cancel`, { reason, requestId }),
  availability: (stallId: string, action: "disable" | "enable", reason: string, force: boolean, requestId: string) =>
    post(`/v1/admin/stalls/${encodeURIComponent(stallId)}/availability`, { action, reason, force, requestId }),
  approval: (teamId: string, status: "approved" | "rejected" | "pending", reason: string, requestId: string) =>
    post(`/v1/admin/teams/${encodeURIComponent(teamId)}/approval`, { status, reason, requestId }),
  /** Step-up: a fresh code re-issues the admin session with a new sign-in time. */
  requestCode: (email: string) => post(`/v1/auth/otp/request`, { email, audience: "admin" }),
  verifyCode: (email: string, code: string) => post(`/v1/auth/otp/verify`, { email, audience: "admin", code }),
  logout: () => post(`/v1/auth/logout`, { audience: "admin" }),
};
