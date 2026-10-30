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

export interface AdminStats {
  registrations: {
    totalTeams: number;
    totalMembers: number;
    totalUsers: number;
    seniorCount: number;
    juniorCount: number;
  };
  stalls: {
    total: number;
    booked: number;
    held: number;
    available: number;
    disabled: number;
    byZone: Record<string, { total: number; booked: number; held: number; available: number; disabled: number }>;
  };
}

export interface AdminRegistrationItem {
  id: string;
  userId: string;
  teamId: string | null;
  track: "senior" | "junior";
  teamName: string;
  leaderName: string;
  email: string;
  mobile: string;
  altMobile: string;
  domain: string;
  projectDetails: string | null;
  projectReportUrl: string | null;
  city: string;
  state: string;
  country: string;
  linkedinUrl: string;
  photoUrl: string | null;
  consentGiven: boolean;
  createdAt: string;
  approvalStatus: "pending" | "approved" | "rejected";
  members: Array<{ name: string; email: string; phone: string; photoUrl: string | null }>;
  reservation: null | { kind: "hold" | "booking"; stallCode: string; bookingRef?: string | null };
}

export interface AdminUserItem {
  id: string;
  email: string;
  displayName: string;
  status: string;
  createdAt: string;
  lastLoginAt?: string | null;
  permissions?: string[];
}

export const adminApi = {
  stats: () => request<AdminStats>("/v1/admin/stats"),
  registrations: () => request<{ total: number; registrations: AdminRegistrationItem[] }>("/v1/admin/registrations"),
  updateRegistration: (id: string, data: Record<string, any>) => post(`/v1/admin/registrations/${encodeURIComponent(id)}`, data, "PATCH"),
  // Writes must be same-origin JSON (assertSameOriginJson), so DELETE sends an empty JSON body.
  deleteRegistration: (id: string) => post<{ ok: true; message: string }>(`/v1/admin/registrations/${encodeURIComponent(id)}`, {}, "DELETE"),
  createStall: (data: { zone: string; code: string; width?: number; depth?: number; x: number; y: number; rotation?: number }) =>
    post<{ ok: true; stall: any }>("/v1/admin/stalls", data),
  updateStall: (stallId: string, data: { code?: string; width?: number; depth?: number; x?: number; y?: number; rotation?: number }) =>
    post<{ ok: true; stall: any }>(`/v1/admin/stalls/${encodeURIComponent(stallId)}`, data, "PATCH"),
  deleteStall: (stallId: string) => post<{ ok: true; message: string }>(`/v1/admin/stalls/${encodeURIComponent(stallId)}`, {}, "DELETE"),
  bookings: (cursor?: string | null) => request<Page<AdminBooking>>(`/v1/admin/bookings${qs({ cursor, limit: "50" })}`),
  teams: (approval?: string | null, cursor?: string | null) =>
    request<Page<AdminTeam> & { unresolved: { ambiguousLeaders: number; nullEditionLeaders: number; leadersWithoutTeam: number } }>(
      `/v1/admin/teams${qs({ approval, cursor, limit: "50" })}`
    ),
  audit: (cursor?: string | null) => request<Page<AuditItem>>(`/v1/admin/audit${qs({ cursor, limit: "50" })}`),
  users: () => request<{ users: AdminUserItem[] }>(`/v1/admin/users`),
  createUser: (data: { email: string; displayName: string; password: string }) =>
    post<{ ok: true; admin: { id: string; email: string; displayName: string } }>(`/v1/admin/users`, data),
  cancel: (bookingId: string, reason: string, requestId: string) =>
    post(`/v1/admin/bookings/${encodeURIComponent(bookingId)}/cancel`, { reason, requestId }),
  approveBooking: (bookingId: string) =>
    post<{ ok: true; sent: boolean; message: string }>(`/v1/admin/bookings/${encodeURIComponent(bookingId)}/approve`, {}),
  availability: (stallId: string, action: "disable" | "enable", reason: string, force: boolean, requestId: string) =>
    post(`/v1/admin/stalls/${encodeURIComponent(stallId)}/availability`, { action, reason, force, requestId }),
  approval: (teamId: string, status: "approved" | "rejected" | "pending", reason: string, requestId: string) =>
    post(`/v1/admin/teams/${encodeURIComponent(teamId)}/approval`, { status, reason, requestId }),
  /** Step-up: a fresh code re-issues the admin session with a new sign-in time. */
  requestCode: (email: string) => post(`/v1/auth/otp/request`, { email, audience: "admin" }),
  verifyCode: (email: string, code: string) => post(`/v1/auth/otp/verify`, { email, audience: "admin", code }),
  logout: () => post(`/v1/auth/logout`, { audience: "admin" }),
};
