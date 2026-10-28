/**
 * Browser client for the booking API (E5–E9). Every failure becomes an ApiError
 * with the server's stable error code; network failures use status 0.
 */

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly requestId?: string,
    readonly details?: Record<string, any>
  ) {
    super(message);
    this.name = "ApiError";
  }

  /** True when the outcome of a write is unknown and must be re-read from /me (spec §4.4). */
  get outcomeUnknown(): boolean {
    return this.status === 0 || this.code === "OUTCOME_UNKNOWN" || this.status >= 500;
  }
}

export type StallStatus = "available" | "held" | "booked" | "unavailable";

export interface SnapshotStall {
  id: string;
  code: string;
  zone: string;
  x: number | null;
  y: number | null;
  w: number;
  d: number;
  rot: number | null;
  status: StallStatus;
  heldByYou?: true;
  holdId?: string;
  expiresAt?: string;
  bookingRef?: string;
}

export interface Snapshot {
  asOf: string;
  serverNow: string;
  bookingWindow: { enabled: boolean; opensAt: string | null; closesAt: string | null };
  zones: Array<{ code: string; name: string; extent: { widthFt: number | null; depthFt: number | null }; landmarks: Array<{ label: string; kind: string }>; inventoryStatus: string }>;
  stalls: SnapshotStall[];
}

export type EligibilityReason =
  | "BOOKING_SUSPENDED"
  | "BOOKING_NOT_OPEN"
  | "BOOKING_CLOSED"
  | "TRACK_NOT_ELIGIBLE"
  | "PENDING_APPROVAL"
  | "TEAM_REJECTED";

export interface HoldReservation {
  kind: "hold";
  holdId: string;
  stallId: string;
  stallCode: string;
  expiresAt: string;
  token: string;
}

export interface BookingReservation {
  kind: "booking";
  bookingId: string;
  bookingRef: string;
  stallId: string;
  stallCode: string;
  confirmedAt: string;
}

export interface MyBooking {
  serverNow: string;
  team: { name: string; track: "senior" | "junior"; approvalStatus: string };
  bookingWindow: { enabled: boolean; opensAt: string | null; closesAt: string | null };
  eligibility: { canHold: boolean; reason?: EligibilityReason };
  reservation: HoldReservation | BookingReservation | null;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      credentials: "same-origin",
      cache: "no-store",
      ...init,
      headers: { ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}), ...(init.headers ?? {}) },
    });
  } catch {
    throw new ApiError(0, "NETWORK", "We could not reach the server. Check your connection.");
  }
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const err = body?.error;
    throw new ApiError(
      res.status,
      err?.code ?? "HTTP_ERROR",
      err?.message ?? `Request failed (${res.status}).`,
      err?.requestId,
      err?.details
    );
  }
  return body as T;
}

const post = <T>(path: string, body: unknown, method = "POST") => request<T>(path, { method, body: JSON.stringify(body) });

export const bookingApi = {
  snapshot: () => request<Snapshot>("/v1/booking/stalls"),
  me: () => request<MyBooking>("/v1/booking/me"),
  hold: (stallId: string) =>
    post<{ holdId: string; stallId: string; stallCode: string; expiresAt: string; serverNow: string; token: string }>("/v1/booking/holds", { stallId }),
  confirm: (holdId: string, token: string) =>
    post<{ bookingId: string; bookingRef: string; stallId: string; stallCode: string; confirmedAt: string }>(
      `/v1/booking/holds/${encodeURIComponent(holdId)}/confirm`,
      { token }
    ),
  release: (holdId: string) => post<{ status: "released" | "expired" }>(`/v1/booking/holds/${encodeURIComponent(holdId)}`, {}, "DELETE"),
  logout: () => post<null>("/v1/auth/logout", { audience: "leader" }),
};
