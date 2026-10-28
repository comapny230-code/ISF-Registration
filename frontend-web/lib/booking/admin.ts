/**
 * Administrator operations (spec §4.8, §4.9, E10–E15).
 *
 * Writes follow the global lock order (team → stall → reservation) used by
 * leader operations. Operations that start from a stall first read the related
 * reservation WITHOUT a lock, then lock in order and re-validate; if the live
 * claim changed in between, the transaction restarts (at most 3 times).
 * Every change is audited with the admin, a mandatory reason and request ids.
 * Admin views never expose Aadhaar or PAN numbers (decision D-19).
 */
import type postgres from "postgres";
import { EDITION_ID } from "../auth/leader";
import { HttpError } from "../http";
import { audit, decide, evaluate, lockStalls, markExpired } from "./service";
import { fail, ok, retryLater, withBookingTx, type TxOutcome } from "./tx";

/** The live claim changed between the unlocked read and the locks; restart. */
class LockRace extends Error {}

async function withRestart<T>(run: () => Promise<T>): Promise<T> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await run();
    } catch (err) {
      if (!(err instanceof LockRace)) throw err;
    }
  }
  throw retryLater();
}

// ---------------------------------------------------------------------------
// E11 cancel a confirmed booking (§4.8)
// ---------------------------------------------------------------------------

export interface CancelResult {
  bookingId: string;
  status: "cancelled";
  cancelledAt: Date;
  idempotent: boolean;
}

export async function cancelBooking(
  adminId: string,
  bookingId: string,
  reason: string,
  cancelRequestId: string,
  httpRequestId: string
): Promise<CancelResult> {
  return withBookingTx(async (tx): Promise<TxOutcome<CancelResult>> => {
    const [found] = await tx`
      select id, team_id, stall_id from booking.reservations where booking_id = ${bookingId} and edition_id = ${EDITION_ID}`;
    if (!found) throw new HttpError(404, "BOOKING_NOT_FOUND", "That booking was not found.");

    await tx`select id from booking.teams where id = ${found.team_id} for update`; // L1
    await lockStalls(tx, [found.stall_id]); // L2
    await tx`select id from booking.reservations where id = ${found.id} for update`; // L3
    const d = await decide(tx);

    const [row] = await tx`select status, cancel_request_id, cancelled_at from booking.reservations where id = ${found.id}`;
    if (row.status === "cancelled") {
      if (row.cancel_request_id === cancelRequestId) {
        return ok({ bookingId, status: "cancelled", cancelledAt: row.cancelled_at, idempotent: true });
      }
      return fail(new HttpError(409, "ALREADY_CANCELLED", "This booking has already been cancelled."));
    }

    const [updated] = await tx`
      update booking.reservations
         set status = 'cancelled', cancelled_at = ${d.decided}::timestamptz, cancelled_by_admin_id = ${adminId},
             cancel_reason = ${reason}, cancel_request_id = ${cancelRequestId}
       where id = ${found.id}
      returning cancelled_at`;
    await audit(tx, {
      action: "booking_cancelled",
      actor: { type: "admin", adminId },
      teamId: found.team_id,
      stallId: found.stall_id,
      reservationId: found.id,
      requestId: httpRequestId,
      reason,
      details: { cancelRequestId },
    });
    return ok({ bookingId, status: "cancelled", cancelledAt: updated.cancelled_at, idempotent: false });
  });
}

// ---------------------------------------------------------------------------
// E12 enable / disable a stall (§4.9)
// ---------------------------------------------------------------------------

export interface AvailabilityResult {
  stallId: string;
  stallCode: string;
  adminStatus: "active" | "disabled";
  changed: boolean;
  releasedHoldId: string | null;
}

export async function setStallAvailability(
  adminId: string,
  stallId: string,
  action: "enable" | "disable",
  reason: string,
  force: boolean,
  httpRequestId: string
): Promise<AvailabilityResult> {
  return withRestart(() =>
    withBookingTx(async (tx): Promise<TxOutcome<AvailabilityResult>> => {
      const [exists] = await tx`select id from booking.stalls where id = ${stallId} and edition_id = ${EDITION_ID}`;
      if (!exists) throw new HttpError(404, "STALL_NOT_FOUND", "That stall does not exist.");

      // Unlocked read, then lock in the global order and re-validate.
      const [claimSeen] = await tx`
        select id, team_id from booking.reservations where stall_id = ${stallId} and status in ('held', 'confirmed')`;
      if (claimSeen) await tx`select id from booking.teams where id = ${claimSeen.team_id} for update`; // L1
      await lockStalls(tx, [stallId]); // L2
      const live = await tx`
        select id from booking.reservations where stall_id = ${stallId} and status in ('held', 'confirmed')
         order by id for update`; // L3
      if ((live[0]?.id ?? null) !== (claimSeen?.id ?? null)) throw new LockRace();

      const d = await decide(tx);
      const [stall] = await tx`select code, inventory_status, admin_status from booking.stalls where id = ${stallId}`;
      const result = (adminStatus: "active" | "disabled", changed: boolean, releasedHoldId: string | null = null) =>
        ok({ stallId, stallCode: stall.code as string, adminStatus, changed, releasedHoldId });

      if (action === "enable") {
        if (stall.inventory_status !== "approved") {
          return fail(new HttpError(409, "STALL_NOT_APPROVED", "This stall is not part of the approved inventory."));
        }
        if (stall.admin_status === "active") return result("active", false);
        await tx`
          update booking.stalls
             set admin_status = 'active', disabled_at = null, disabled_reason = null, disabled_by = null, updated_at = now()
           where id = ${stallId}`;
        await audit(tx, { action: "stall_enabled", actor: { type: "admin", adminId }, stallId, requestId: httpRequestId, reason });
        return result("active", true);
      }

      let releasedHoldId: string | null = null;
      if (live[0]) {
        const [claim] = await evaluate(tx, [live[0].id], d.decided);
        if (claim.status === "confirmed") {
          return fail(
            new HttpError(409, "STALL_HAS_BOOKING", "This stall has a confirmed booking. The booking must be cancelled first.")
          );
        }
        if (claim.unexpired) {
          if (!force) {
            return fail(
              new HttpError(409, "STALL_HAS_ACTIVE_HOLD", "A team is holding this stall. Retry later, or force to release the hold.", {
                holdExpiresAt: claim.expires_at,
              })
            );
          }
          await tx`
            update booking.reservations
               set status = 'released', released_at = ${d.decided}::timestamptz, release_reason = 'admin_disable',
                   released_by_admin_id = ${adminId}
             where id = ${claim.id}`;
          await audit(tx, {
            action: "hold_released",
            actor: { type: "admin", adminId },
            teamId: claim.team_id,
            stallId,
            reservationId: claim.id,
            requestId: httpRequestId,
            reason,
            details: { releaseReason: "admin_disable" },
          });
          releasedHoldId = claim.id;
        } else {
          await markExpired(tx, claim, d.decided, httpRequestId);
        }
      }

      if (stall.admin_status === "disabled") return result("disabled", false, releasedHoldId);
      await tx`
        update booking.stalls
           set admin_status = 'disabled', disabled_at = ${d.decided}::timestamptz, disabled_reason = ${reason},
               disabled_by = ${adminId}, updated_at = now()
         where id = ${stallId}`;
      await audit(tx, { action: "stall_disabled", actor: { type: "admin", adminId }, stallId, requestId: httpRequestId, reason });
      return result("disabled", true, releasedHoldId);
    })
  );
}

// ---------------------------------------------------------------------------
// E14 team approval
// ---------------------------------------------------------------------------

export type ApprovalStatus = "pending" | "approved" | "rejected";

export async function setTeamApproval(
  adminId: string,
  teamId: string,
  status: ApprovalStatus,
  reason: string,
  httpRequestId: string
): Promise<{ teamId: string; approvalStatus: ApprovalStatus; changed: boolean }> {
  type Result = { teamId: string; approvalStatus: ApprovalStatus; changed: boolean };
  return withBookingTx(async (tx): Promise<TxOutcome<Result>> => {
    const [team] = await tx`
      select id, approval_status from booking.teams where id = ${teamId} and edition_id = ${EDITION_ID} for update`; // L1
    if (!team) throw new HttpError(404, "TEAM_NOT_FOUND", "That team was not found.");
    if (team.approval_status === status) return ok({ teamId, approvalStatus: status, changed: false });

    await tx`
      update booking.teams
         set approval_status = ${status}, approval_changed_at = clock_timestamp(), approval_changed_by = ${adminId}, updated_at = now()
       where id = ${teamId}`;
    await audit(tx, {
      action: "team_approval_changed",
      actor: { type: "admin", adminId },
      teamId,
      requestId: httpRequestId,
      reason,
      details: { from: team.approval_status, to: status },
    });
    return ok({ teamId, approvalStatus: status, changed: true });
  });
}

// ---------------------------------------------------------------------------
// Read-only lists (E10, E13, E15) with keyset pagination
// ---------------------------------------------------------------------------

function encodeCursor(value: Record<string, string>): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function decodeCursor(cursor: string | null, keys: string[]): Record<string, string> | null {
  if (!cursor) return null;
  try {
    const value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (value && keys.every((k) => typeof value[k] === "string" && value[k].length <= 64)) return value;
  } catch {
    // fall through
  }
  throw new HttpError(400, "VALIDATION", "cursor is invalid.");
}

export async function listBookings(
  sql: postgres.ISql,
  opts: { status: "confirmed" | "cancelled" | null; zone: string | null; cursor: string | null; limit: number }
) {
  const after = decodeCursor(opts.cursor, ["t", "id"]);
  const rows = await sql`
    select r.id, r.booking_id, r.booking_ref, st.code as stall_code, z.code as zone, t.team_name_snapshot as team_name, t.track,
           coalesce(l.full_name, s.full_name) as leader_name, coalesce(l.email, s.email) as leader_email,
           coalesce(l.mobile, s.mobile) as leader_mobile,
           r.confirmed_at, r.confirmed_at::text as cursor_t, r.status, r.cancelled_at, r.cancel_reason
      from booking.reservations r
      join booking.stalls st on st.id = r.stall_id
      join booking.zones z on z.id = st.zone_id
      join booking.teams t on t.id = r.team_id
      left join public.startup_team_leaders l on l.id = t.startup_team_leader_id
      left join public.student_innovators s on s.id = t.student_innovator_id
     where r.edition_id = ${EDITION_ID}
       and r.status in ('confirmed', 'cancelled')
       and (${opts.status}::text is null or r.status = ${opts.status}::text)
       and (${opts.zone}::text is null or z.code = ${opts.zone}::text)
       and (${after?.t ?? null}::timestamptz is null or (r.confirmed_at, r.id) < (${after?.t ?? null}::timestamptz, ${after?.id ?? null}::uuid))
     order by r.confirmed_at desc, r.id desc
     limit ${opts.limit + 1}`;
  const page = rows.slice(0, opts.limit);
  const last = page[page.length - 1];
  return {
    items: page.map((r) => ({
      bookingId: r.booking_id,
      bookingRef: r.booking_ref,
      stallCode: r.stall_code,
      zone: r.zone,
      teamName: r.team_name,
      track: r.track,
      leaderName: r.leader_name,
      leaderEmail: r.leader_email,
      leaderMobile: r.leader_mobile,
      confirmedAt: r.confirmed_at,
      status: r.status,
      ...(r.status === "cancelled" ? { cancelledAt: r.cancelled_at, cancelReason: r.cancel_reason } : {}),
    })),
    nextCursor: rows.length > opts.limit && last ? encodeCursor({ t: last.cursor_t, id: last.id }) : null,
  };
}

export async function listTeams(
  sql: postgres.ISql,
  opts: { approval: ApprovalStatus | null; track: "senior" | "junior" | null; cursor: string | null; limit: number }
) {
  const after = decodeCursor(opts.cursor, ["name", "id"]);
  const rows = await sql`
    select t.id, t.track, t.team_name_snapshot as team_name, t.approval_status,
           coalesce(l.full_name, s.full_name) as leader_name, coalesce(l.email, s.email) as leader_email,
           r.status as reservation_status, st.code as stall_code, r.booking_ref
      from booking.teams t
      left join public.startup_team_leaders l on l.id = t.startup_team_leader_id
      left join public.student_innovators s on s.id = t.student_innovator_id
      left join booking.reservations r on r.team_id = t.id and r.status in ('held', 'confirmed')
      left join booking.stalls st on st.id = r.stall_id
     where t.edition_id = ${EDITION_ID}
       and (${opts.approval}::text is null or t.approval_status = ${opts.approval}::text)
       and (${opts.track}::text is null or t.track = ${opts.track}::text)
       and (${after?.name ?? null}::text is null or (t.team_name_snapshot, t.id) > (${after?.name ?? null}::text, ${after?.id ?? null}::uuid))
     order by t.team_name_snapshot, t.id
     limit ${opts.limit + 1}`;
  const [unresolved] = await sql`
    select
      (select count(*) from public.startup_team_leaders l
         join public.student_innovators s on s.user_id = l.user_id and s.edition_id = ${EDITION_ID}
        where l.edition_id = ${EDITION_ID})::int as ambiguous_leaders,
      ((select count(*) from public.startup_team_leaders where edition_id is null)
       + (select count(*) from public.student_innovators where edition_id is null))::int as null_edition_leaders,
      ((select count(*) from public.startup_team_leaders l where l.edition_id = ${EDITION_ID}
          and not exists (select 1 from booking.teams t where t.startup_team_leader_id = l.id)
          and not exists (select 1 from public.student_innovators s where s.user_id = l.user_id and s.edition_id = ${EDITION_ID}))
       + (select count(*) from public.student_innovators s where s.edition_id = ${EDITION_ID}
          and not exists (select 1 from booking.teams t where t.student_innovator_id = s.id)
          and not exists (select 1 from public.startup_team_leaders l where l.user_id = s.user_id and l.edition_id = ${EDITION_ID})))::int
        as leaders_without_team`;
  const page = rows.slice(0, opts.limit);
  const last = page[page.length - 1];
  return {
    items: page.map((t) => ({
      teamId: t.id,
      track: t.track,
      teamName: t.team_name,
      leaderName: t.leader_name,
      leaderEmail: t.leader_email,
      approvalStatus: t.approval_status,
      reservation: t.reservation_status
        ? { kind: t.reservation_status === "confirmed" ? "booking" : "hold", stallCode: t.stall_code, bookingRef: t.booking_ref ?? undefined }
        : null,
    })),
    unresolved: {
      ambiguousLeaders: unresolved.ambiguous_leaders,
      nullEditionLeaders: unresolved.null_edition_leaders,
      leadersWithoutTeam: unresolved.leaders_without_team,
    },
    nextCursor: rows.length > opts.limit && last ? encodeCursor({ name: last.team_name, id: last.id }) : null,
  };
}

export async function listAudit(
  sql: postgres.ISql,
  opts: { reservationId: string | null; stallId: string | null; teamId: string | null; cursor: string | null; limit: number }
) {
  const after = decodeCursor(opts.cursor, ["id"]);
  if (after && !/^\d{1,18}$/.test(after.id)) throw new HttpError(400, "VALIDATION", "cursor is invalid.");
  const rows = await sql`
    select a.id::text as id, a.occurred_at, a.action, a.actor_type, a.request_id, a.reason, a.details, a.reservation_id,
           coalesce(ad.display_name, u.full_name, a.actor_operator) as actor_name,
           t.team_name_snapshot as team_name, st.code as stall_code
      from booking.audit_events a
      left join app_auth.admin_users ad on ad.id = a.actor_admin_id
      left join public.user_accounts u on u.id = a.actor_user_id
      left join booking.teams t on t.id = a.team_id
      left join booking.stalls st on st.id = a.stall_id
     where a.edition_id = ${EDITION_ID}
       and (${opts.reservationId}::uuid is null or a.reservation_id = ${opts.reservationId}::uuid)
       and (${opts.stallId}::uuid is null or a.stall_id = ${opts.stallId}::uuid)
       and (${opts.teamId}::uuid is null or a.team_id = ${opts.teamId}::uuid)
       and (${after?.id ?? null}::bigint is null or a.id < ${after?.id ?? null}::bigint)
     order by a.id desc
     limit ${opts.limit + 1}`;
  const page = rows.slice(0, opts.limit);
  const last = page[page.length - 1];
  return {
    items: page.map((a) => ({
      id: a.id,
      occurredAt: a.occurred_at,
      action: a.action,
      actorType: a.actor_type,
      actorName: a.actor_name ?? (a.actor_type === "system" ? "System" : null),
      teamName: a.team_name,
      stallCode: a.stall_code,
      reservationId: a.reservation_id,
      requestId: a.request_id,
      reason: a.reason,
      details: a.details,
    })),
    nextCursor: rows.length > opts.limit && last ? encodeCursor({ id: last.id }) : null,
  };
}
