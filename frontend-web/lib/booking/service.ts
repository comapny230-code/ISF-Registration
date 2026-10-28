/**
 * Atomic hold / confirm / release (spec §4.5–§4.7).
 *
 * Every operation:
 *   L1 lock the acting team row → L2 lock stall rows (ascending id) → L3 lock
 *   reservation rows (ascending id) → read decided_at = clock_timestamp() ONCE,
 *   after all locks → validate against locked rows and decided_at → write.
 * The database trigger independently rejects confirming at or after expiry.
 */
import { getAppEnv } from "../config";
import { fault } from "../db/faults";
import { HttpError } from "../http";
import { EDITION_ID, lockLeaderTeam, type TeamRow } from "../auth/leader";
import { issueHoldToken, newBookingRef, verifyHoldToken } from "./token";
import { fail, ok, withBookingTx, type Tx, type TxOutcome } from "./tx";

export const PRODUCTION_HOLD_SECONDS = 300;

export interface HoldView {
  holdId: string;
  stallId: string;
  stallCode: string;
  expiresAt: Date;
  serverNow: Date;
  token: string;
}

export interface BookingView {
  bookingId: string;
  bookingRef: string;
  stallId: string;
  stallCode: string;
  confirmedAt: Date;
}

interface Decision {
  decided: string; // clock_timestamp()::text, full precision, reused as ${decided}::timestamptz
  now: Date;
  bookingEnabled: boolean;
  opened: boolean;
  closed: boolean;
  holdSeconds: number;
  eligibleTracks: string[];
  requireTeamApproval: boolean;
  reholdCooldownSeconds: number;
  maxNewHoldsPerHour: number;
}

interface LockedReservation {
  id: string;
  team_id: string;
  stall_id: string;
  stall_code: string;
  status: "held" | "confirmed" | "released" | "expired" | "cancelled";
  unexpired: boolean;
  expires_at: Date;
  expires_ms: string;
  booking_id: string | null;
  booking_ref: string | null;
  confirmed_at: Date | null;
}

/** Rejects a production hold length other than the approved five minutes. */
export function assertHoldSecondsAllowed(appEnv: string, holdSeconds: number): void {
  if (appEnv === "production" && holdSeconds !== PRODUCTION_HOLD_SECONDS) {
    throw new HttpError(503, "SERVICE_MISCONFIGURED", "Stall booking is temporarily unavailable.");
  }
}

/** Reads the decision timestamp (after all locks) together with the edition's settings. */
async function decide(tx: Tx): Promise<Decision> {
  const [row] = await tx`
    with d as materialized (select clock_timestamp() as t)
    select d.t::text as decided, d.t as now,
           s.booking_enabled, s.hold_seconds, s.eligible_tracks, s.require_team_approval,
           s.rehold_cooldown_seconds, s.max_new_holds_per_hour,
           (s.opens_at is not null and s.opens_at <= d.t) as opened,
           (s.closes_at is not null and d.t >= s.closes_at) as closed
      from d left join booking.settings s on s.edition_id = ${EDITION_ID}`;
  if (row.hold_seconds === null) {
    console.error("[BOOKING] booking.settings row for the edition is missing");
    throw new HttpError(503, "SERVICE_MISCONFIGURED", "Stall booking is temporarily unavailable.");
  }
  assertHoldSecondsAllowed(getAppEnv(), row.hold_seconds);
  return {
    decided: row.decided,
    now: row.now,
    bookingEnabled: row.booking_enabled,
    opened: row.opened,
    closed: row.closed,
    holdSeconds: row.hold_seconds,
    eligibleTracks: row.eligible_tracks,
    requireTeamApproval: row.require_team_approval,
    reholdCooldownSeconds: row.rehold_cooldown_seconds,
    maxNewHoldsPerHour: row.max_new_holds_per_hour,
  };
}

/** Re-reads already-locked reservations and evaluates expiry against decided_at in SQL (no precision loss). */
async function evaluate(tx: Tx, ids: string[], decided: string): Promise<LockedReservation[]> {
  if (ids.length === 0) return [];
  return (await tx`
    select r.id, r.team_id, r.stall_id, st.code as stall_code, r.status,
           r.expires_at > ${decided}::timestamptz as unexpired, r.expires_at,
           floor(extract(epoch from r.expires_at) * 1000)::bigint::text as expires_ms,
           r.booking_id, r.booking_ref, r.confirmed_at
      from booking.reservations r join booking.stalls st on st.id = r.stall_id
     where r.id = any(${ids}::uuid[])`) as unknown as LockedReservation[];
}

interface AuditEvent {
  action: "hold_created" | "hold_released" | "hold_expired" | "booking_confirmed";
  actor: { type: "leader"; userId: string } | { type: "system" };
  teamId: string;
  stallId: string;
  reservationId: string;
  requestId: string;
  details?: Record<string, unknown>;
}

async function audit(tx: Tx, e: AuditEvent): Promise<void> {
  await tx`
    insert into booking.audit_events (edition_id, action, actor_type, actor_user_id, team_id, stall_id, reservation_id, request_id, details)
    values (${EDITION_ID}, ${e.action}, ${e.actor.type}, ${e.actor.type === "leader" ? e.actor.userId : null},
            ${e.teamId}, ${e.stallId}, ${e.reservationId}, ${e.requestId}, ${JSON.stringify(e.details ?? {})}::jsonb)`;
}

async function markExpired(tx: Tx, r: LockedReservation, decided: string, requestId: string): Promise<void> {
  await tx`update booking.reservations set status = 'expired', expired_at = ${decided}::timestamptz where id = ${r.id}`;
  await audit(tx, {
    action: "hold_expired",
    actor: { type: "system" },
    teamId: r.team_id,
    stallId: r.stall_id,
    reservationId: r.id,
    requestId,
  });
}

function holdView(r: LockedReservation, teamId: string, now: Date): HoldView {
  return {
    holdId: r.id,
    stallId: r.stall_id,
    stallCode: r.stall_code,
    expiresAt: r.expires_at,
    serverNow: now,
    token: issueHoldToken(r.id, teamId, r.expires_ms),
  };
}

function bookingView(r: LockedReservation): BookingView {
  return {
    bookingId: r.booking_id!,
    bookingRef: r.booking_ref!,
    stallId: r.stall_id,
    stallCode: r.stall_code,
    confirmedAt: r.confirmed_at!,
  };
}

const notEligible = () =>
  new HttpError(403, "TEAM_NOT_ELIGIBLE", "Your team is not currently eligible to book a stall.");

function teamEligible(d: Decision, team: TeamRow): boolean {
  if (!d.eligibleTracks.includes(team.track)) return false;
  if (team.approvalStatus === "rejected") return false;
  return !d.requireTeamApproval || team.approvalStatus === "approved";
}

/** Eligibility for a NEW hold (spec §3.3). */
function newHoldBlocker(d: Decision, team: TeamRow): HttpError | null {
  if (!d.bookingEnabled) return new HttpError(409, "BOOKING_SUSPENDED", "Stall booking is currently paused.");
  if (!d.opened) return new HttpError(409, "BOOKING_NOT_OPEN", "Stall booking has not opened yet.");
  if (d.closed) return new HttpError(409, "BOOKING_CLOSED", "Stall booking has closed.");
  if (!teamEligible(d, team)) return notEligible();
  return null;
}

async function lockStalls(tx: Tx, stallIds: string[]): Promise<void> {
  await tx`select id from booking.stalls where id = any(${[...new Set(stallIds)]}::uuid[]) order by id for update`;
}

// ---------------------------------------------------------------------------
// Hold (§4.5)
// ---------------------------------------------------------------------------

export async function createHold(userId: string, stallId: string, requestId: string): Promise<{ created: boolean; hold: HoldView }> {
  return withBookingTx(async (tx): Promise<TxOutcome<{ created: boolean; hold: HoldView }>> => {
    const team = await lockLeaderTeam(tx, userId); // L1

    const [target] = await tx`
      select id from booking.stalls where id = ${stallId} and edition_id = ${EDITION_ID} and inventory_status <> 'retired'`;
    if (!target) throw new HttpError(404, "STALL_NOT_FOUND", "That stall does not exist.");

    const own = await tx`select stall_id from booking.reservations where team_id = ${team.id} and status in ('held', 'confirmed')`;
    await lockStalls(tx, [stallId, ...own.map((r) => r.stall_id as string)]); // L2

    const locked = await tx`
      select id from booking.reservations
       where status in ('held', 'confirmed') and (team_id = ${team.id} or stall_id = ${stallId})
       order by id for update`; // L3

    const d = await decide(tx);
    const rows = await evaluate(tx, locked.map((r) => r.id as string), d.decided);
    const mine = rows.find((r) => r.team_id === team.id);
    const theirs = rows.find((r) => r.stall_id === stallId && r.team_id !== team.id);

    // 7. The team's own claim is evaluated before eligibility so retries can recover it.
    if (mine) {
      if (mine.status === "confirmed") {
        return fail(new HttpError(409, "TEAM_ALREADY_BOOKED", "Your team has already booked a stall.", { booking: bookingView(mine) }));
      }
      if (mine.unexpired) {
        if (mine.stall_id === stallId) return ok({ created: false, hold: holdView(mine, team.id, d.now) });
        return fail(
          new HttpError(409, "TEAM_HAS_ACTIVE_HOLD", "Your team is already holding another stall.", {
            hold: holdView(mine, team.id, d.now),
          })
        );
      }
      await markExpired(tx, mine, d.decided, requestId);
    }

    // 8. Eligibility for a new hold.
    const blocker = newHoldBlocker(d, team);
    if (blocker) return fail(blocker);

    // 9. Another team's claim on the stall.
    if (theirs) {
      if (theirs.status === "confirmed") {
        return fail(new HttpError(409, "STALL_UNAVAILABLE", "This stall has been booked.", { reason: "booked" }));
      }
      if (theirs.unexpired) {
        return fail(new HttpError(409, "STALL_UNAVAILABLE", "This stall is held by another team.", { reason: "held" }));
      }
      await markExpired(tx, theirs, d.decided, requestId);
    }

    // 10. Inventory.
    const [stall] = await tx`select code, bookable from booking.stalls where id = ${stallId}`;
    if (!stall.bookable) {
      return fail(new HttpError(409, "STALL_UNAVAILABLE", "This stall is not available.", { reason: "unavailable" }));
    }

    // 11. Re-hold cooldown for this team and stall.
    const [cooldown] = await tx`
      select ceil(extract(epoch from (
               max(coalesce(released_at, expires_at)) + make_interval(secs => ${d.reholdCooldownSeconds}::int)
               - ${d.decided}::timestamptz)))::int as wait
        from booking.reservations
       where team_id = ${team.id} and stall_id = ${stallId} and status in ('released', 'expired')
         and coalesce(released_at, expires_at) > ${d.decided}::timestamptz - make_interval(secs => ${d.reholdCooldownSeconds}::int)`;
    if (cooldown.wait !== null && cooldown.wait > 0) {
      return fail(
        new HttpError(
          409,
          "REHOLD_COOLDOWN",
          "Your team recently held this stall. Please choose another stall or try again later.",
          { retryAfterSeconds: cooldown.wait },
          { "Retry-After": String(cooldown.wait) }
        )
      );
    }

    // 12. Hourly cap on new holds.
    const [recent] = await tx`
      select count(*)::int as n,
             ceil(extract(epoch from (min(held_at) + interval '1 hour' - ${d.decided}::timestamptz)))::int as wait
        from booking.reservations
       where team_id = ${team.id} and held_at > ${d.decided}::timestamptz - interval '1 hour'`;
    if (recent.n >= d.maxNewHoldsPerHour) {
      const wait = Math.max(1, recent.wait ?? 60);
      return fail(
        new HttpError(
          429,
          "HOLD_LIMIT_REACHED",
          "Your team has placed too many holds recently. Please try again later.",
          { retryAfterSeconds: wait },
          { "Retry-After": String(wait) }
        )
      );
    }

    // 13. Create the hold.
    const [created] = await tx`
      insert into booking.reservations (edition_id, stall_id, team_id, created_by_user_id, status, held_at, expires_at)
      values (${EDITION_ID}, ${stallId}, ${team.id}, ${userId}, 'held',
              ${d.decided}::timestamptz, ${d.decided}::timestamptz + make_interval(secs => ${d.holdSeconds}::int))
      returning id`;
    await audit(tx, {
      action: "hold_created",
      actor: { type: "leader", userId },
      teamId: team.id,
      stallId,
      reservationId: created.id,
      requestId,
    });
    const [row] = await evaluate(tx, [created.id], d.decided);
    return ok({ created: true, hold: holdView(row, team.id, d.now) });
  });
}

// ---------------------------------------------------------------------------
// Confirm (§4.6) and release (§4.7)
// ---------------------------------------------------------------------------

/** L1 + ownership check + L2 + L3 for an existing reservation of the caller's team. */
async function lockOwnReservation(tx: Tx, userId: string, holdId: string) {
  const team = await lockLeaderTeam(tx, userId); // L1
  const [h] = await tx`select team_id, stall_id from booking.reservations where id = ${holdId} and edition_id = ${EDITION_ID}`;
  // Another team's hold is indistinguishable from a missing one.
  if (!h || h.team_id !== team.id) throw new HttpError(404, "HOLD_NOT_FOUND", "That hold was not found.");
  await lockStalls(tx, [h.stall_id]); // L2
  await tx`select id from booking.reservations where id = ${holdId} for update`; // L3
  const d = await decide(tx);
  const [r] = await evaluate(tx, [holdId], d.decided);
  return { team, d, r };
}

export async function confirmHold(
  userId: string,
  holdId: string,
  token: string,
  requestId: string
): Promise<{ created: boolean; booking: BookingView }> {
  return withBookingTx(async (tx): Promise<TxOutcome<{ created: boolean; booking: BookingView }>> => {
    const { team, d, r } = await lockOwnReservation(tx, userId, holdId);

    if (!verifyHoldToken(token, r.id, team.id, r.expires_ms)) {
      return fail(new HttpError(403, "INVALID_HOLD_TOKEN", "This hold could not be verified. Please refresh and try again."));
    }

    switch (r.status) {
      case "confirmed":
        return ok({ created: false, booking: bookingView(r) });
      case "cancelled":
        return fail(new HttpError(409, "BOOKING_CANCELLED", "This booking was cancelled by the organisers."));
      case "released":
        return fail(new HttpError(409, "HOLD_RELEASED", "This hold was released."));
      case "expired":
        return fail(new HttpError(409, "HOLD_EXPIRED", "This hold has expired. Please select the stall again."));
    }
    if (!r.unexpired) {
      await markExpired(tx, r, d.decided, requestId);
      return fail(new HttpError(409, "HOLD_EXPIRED", "This hold has expired. Please select the stall again."));
    }

    // closes_at is deliberately not re-checked: a hold taken before closing may be confirmed until it expires.
    if (!d.bookingEnabled) return fail(new HttpError(409, "BOOKING_SUSPENDED", "Stall booking is currently paused."));
    if (!teamEligible(d, team)) return fail(notEligible());
    const [stall] = await tx`select bookable from booking.stalls where id = ${r.stall_id}`;
    if (!stall.bookable) {
      return fail(new HttpError(409, "STALL_UNAVAILABLE", "This stall is not available.", { reason: "unavailable" }));
    }

    await fault("beforeConfirmUpdate");
    await tx`
      update booking.reservations
         set status = 'confirmed', confirmed_at = ${d.decided}::timestamptz, confirmed_by_user_id = ${userId},
             booking_id = gen_random_uuid(), booking_ref = ${newBookingRef()}
       where id = ${r.id}`;
    await audit(tx, {
      action: "booking_confirmed",
      actor: { type: "leader", userId },
      teamId: team.id,
      stallId: r.stall_id,
      reservationId: r.id,
      requestId,
    });
    const [confirmed] = await evaluate(tx, [r.id], d.decided);
    return ok({ created: true, booking: bookingView(confirmed) });
  });
}

export async function releaseHold(
  userId: string,
  holdId: string,
  requestId: string
): Promise<{ status: "released" | "expired" }> {
  return withBookingTx(async (tx): Promise<TxOutcome<{ status: "released" | "expired" }>> => {
    const { team, d, r } = await lockOwnReservation(tx, userId, holdId);

    if (r.status === "released" || r.status === "expired") return ok({ status: r.status });
    if (r.status === "confirmed") {
      return fail(new HttpError(409, "BOOKING_CONFIRMED", "A confirmed booking cannot be released. Please contact the organisers."));
    }
    if (r.status === "cancelled") return fail(new HttpError(409, "BOOKING_CANCELLED", "This booking was cancelled by the organisers."));

    if (!r.unexpired) {
      await markExpired(tx, r, d.decided, requestId);
      return ok({ status: "expired" as const });
    }
    await tx`
      update booking.reservations
         set status = 'released', released_at = ${d.decided}::timestamptz, release_reason = 'leader', released_by_user_id = ${userId}
       where id = ${r.id}`;
    await audit(tx, {
      action: "hold_released",
      actor: { type: "leader", userId },
      teamId: team.id,
      stallId: r.stall_id,
      reservationId: r.id,
      requestId,
    });
    return ok({ status: "released" as const });
  });
}
