/**
 * Read-only booking views (spec §4.1, §4.10, E5, E6). No locks, no writes.
 *
 * Effective status is computed in ONE statement with a single clock reading, so
 * a hold that expired without any write is reported as available immediately;
 * clients order responses by asOf.
 */
import type postgres from "postgres";
import { EDITION_ID, resolveLeader, type Track } from "../auth/leader";
import { HttpError } from "../http";
import { issueHoldToken } from "./token";

export type StallStatus = "available" | "held" | "booked" | "unavailable";

const num = (value: unknown): number | null => (value === null || value === undefined ? null : Number(value));

export interface StallSnapshot {
  asOf: Date;
  serverNow: Date;
  bookingWindow: { enabled: boolean; opensAt: Date | null; closesAt: Date | null };
  zones: Array<{ code: string; name: string; extent: { widthFt: number | null; depthFt: number | null }; landmarks: unknown[]; inventoryStatus: string }>;
  stalls: Array<{
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
    expiresAt?: Date;
    bookingRef?: string;
  }>;
}

/** The viewer's team id, if the leader resolves to exactly one team that already exists. */
export async function viewerTeamId(sql: postgres.ISql, userId: string): Promise<string | null> {
  const resolution = await resolveLeader(sql, userId);
  if (resolution.kind !== "leader") return null;
  const [team] = await sql`select id from booking.teams where edition_id = ${EDITION_ID} and leader_user_id = ${userId}`;
  return team?.id ?? null;
}

export async function stallSnapshot(sql: postgres.ISql, teamId: string | null, zone?: string): Promise<StallSnapshot> {
  const rows = await sql`
    with d as materialized (select clock_timestamp() as t)
    select d.t as as_of, st.booking_enabled, st.opens_at, st.closes_at, coalesce(st.show_hold_expiry_publicly, false) as show_expiry,
           s.id, s.code, z.code as zone, s.x_ft, s.y_ft, s.width_ft, s.depth_ft, s.rotation_deg,
           case when r.status = 'confirmed' then 'booked'
                when not s.bookable then 'unavailable'
                when r.status = 'held' and r.expires_at > d.t then 'held'
                else 'available' end as status,
           (r.team_id is not null and r.team_id = ${teamId}::uuid) as own,
           r.id as reservation_id, r.expires_at, r.booking_ref
      from d
      left join booking.settings st on st.edition_id = ${EDITION_ID}
      left join booking.stalls s on s.edition_id = ${EDITION_ID} and s.inventory_status <> 'retired'
      left join booking.zones z on z.id = s.zone_id
      left join booking.reservations r on r.stall_id = s.id and r.status in ('held', 'confirmed')
     order by z.code, s.code`;

  const zones = (
    await sql`
      select code, name, extent_width_ft, extent_depth_ft, landmarks, inventory_status
        from booking.zones where edition_id = ${EDITION_ID} and inventory_status <> 'retired' order by code`
  ).filter((z) => !zone || z.code === zone);

  const first = rows[0];
  return {
    asOf: first.as_of,
    serverNow: first.as_of,
    bookingWindow: { enabled: Boolean(first.booking_enabled), opensAt: first.opens_at ?? null, closesAt: first.closes_at ?? null },
    zones: zones.map((z) => ({
      code: z.code,
      name: z.name,
      extent: { widthFt: num(z.extent_width_ft), depthFt: num(z.extent_depth_ft) },
      landmarks: z.landmarks,
      inventoryStatus: z.inventory_status,
    })),
    stalls: rows
      .filter((r) => r.id !== null && (!zone || r.zone === zone))
      .map((r) => {
        const stall: StallSnapshot["stalls"][number] = {
          id: r.id,
          code: r.code,
          zone: r.zone,
          x: num(r.x_ft),
          y: num(r.y_ft),
          w: Number(r.width_ft),
          d: Number(r.depth_ft),
          rot: num(r.rotation_deg),
          status: r.status,
        };
        if (r.own && r.status === "held") {
          stall.heldByYou = true;
          stall.holdId = r.reservation_id;
          stall.expiresAt = r.expires_at;
        } else if (r.own && r.status === "booked") {
          stall.bookingRef = r.booking_ref;
        } else if (r.status === "held" && r.show_expiry) {
          stall.expiresAt = r.expires_at;
        }
        return stall;
      }),
  };
}

export type EligibilityReason =
  | "BOOKING_SUSPENDED"
  | "BOOKING_NOT_OPEN"
  | "BOOKING_CLOSED"
  | "TRACK_NOT_ELIGIBLE"
  | "PENDING_APPROVAL"
  | "TEAM_REJECTED";

export interface MyBooking {
  serverNow: Date;
  team: { name: string; track: Track; approvalStatus: string };
  bookingWindow: { enabled: boolean; opensAt: Date | null; closesAt: Date | null };
  eligibility: { canHold: boolean; reason?: EligibilityReason };
  reservation:
    | null
    | { kind: "hold"; holdId: string; stallId: string; stallCode: string; expiresAt: Date; token: string }
    | { kind: "booking"; bookingId: string; bookingRef: string; stallId: string; stallCode: string; confirmedAt: Date };
}

/** GET /v1/booking/me: the recovery view after any lost response (spec §4.4). */
export async function myBooking(sql: postgres.ISql, userId: string): Promise<MyBooking> {
  const resolution = await resolveLeader(sql, userId);
  if (resolution.kind === "not_leader") throw new HttpError(403, "NOT_TEAM_LEADER", "Only the registered team leader can do this.");
  if (resolution.kind === "ambiguous") {
    throw new HttpError(409, "TEAM_AMBIGUOUS", "This account is registered as a leader in more than one track. Please contact the organisers.");
  }

  const [row] = await sql`
    with d as materialized (select clock_timestamp() as t)
    select d.t as server_now, s.booking_enabled, s.opens_at, s.closes_at, s.eligible_tracks, s.require_team_approval,
           (s.opens_at is not null and s.opens_at <= d.t) as opened,
           (s.closes_at is not null and d.t >= s.closes_at) as closed,
           t.id as team_id, t.approval_status,
           r.id as reservation_id, r.status, r.expires_at, r.expires_at > d.t as unexpired,
           floor(extract(epoch from r.expires_at) * 1000)::bigint::text as expires_ms,
           r.booking_id, r.booking_ref, r.confirmed_at, r.stall_id, st.code as stall_code
      from d
      left join booking.settings s on s.edition_id = ${EDITION_ID}
      left join booking.teams t on t.edition_id = ${EDITION_ID} and t.leader_user_id = ${userId}
      left join booking.reservations r on r.team_id = t.id and r.status in ('held', 'confirmed')
      left join booking.stalls st on st.id = r.stall_id`;

  const approvalStatus: string = row.approval_status ?? "pending";
  let reason: EligibilityReason | undefined;
  if (!row.booking_enabled) reason = "BOOKING_SUSPENDED";
  else if (!row.opened) reason = "BOOKING_NOT_OPEN";
  else if (row.closed) reason = "BOOKING_CLOSED";
  else if (!(row.eligible_tracks ?? []).includes(resolution.track)) reason = "TRACK_NOT_ELIGIBLE";
  else if (approvalStatus === "rejected") reason = "TEAM_REJECTED";
  else if (row.require_team_approval && approvalStatus !== "approved") reason = "PENDING_APPROVAL";

  let reservation: MyBooking["reservation"] = null;
  if (row.status === "confirmed") {
    reservation = {
      kind: "booking",
      bookingId: row.booking_id,
      bookingRef: row.booking_ref,
      stallId: row.stall_id,
      stallCode: row.stall_code,
      confirmedAt: row.confirmed_at,
    };
  } else if (row.status === "held" && row.unexpired) {
    reservation = {
      kind: "hold",
      holdId: row.reservation_id,
      stallId: row.stall_id,
      stallCode: row.stall_code,
      expiresAt: row.expires_at,
      token: issueHoldToken(row.reservation_id, row.team_id, row.expires_ms),
    };
  }

  return {
    serverNow: row.server_now,
    team: { name: resolution.teamName, track: resolution.track, approvalStatus },
    bookingWindow: { enabled: Boolean(row.booking_enabled), opensAt: row.opens_at ?? null, closesAt: row.closes_at ?? null },
    eligibility: reason ? { canHold: false, reason } : { canHold: true },
    reservation,
  };
}
