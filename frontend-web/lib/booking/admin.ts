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
import { getDb } from "../db";
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
// Inventory management from the admin console: add, edit and retire stalls
// ---------------------------------------------------------------------------

export interface StallInput {
  zone?: string;
  code?: string;
  width?: number;
  depth?: number;
  x?: number;
  y?: number;
  rotation?: number;
}

export interface StallView {
  id: string;
  code: string;
  zone: string;
  width: number;
  depth: number;
  x: number | null;
  y: number | null;
  rotation: number | null;
  inventoryStatus: string;
  adminStatus: string;
}

const STALL_CODE = /^[A-Z]{2}-[A-Z][0-9]{2}$/;

function measure(raw: Record<string, unknown>, field: keyof StallInput, check: (n: number) => boolean, rule: string): number | undefined {
  const value = raw[field];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value) || !check(value)) {
    throw new HttpError(400, "VALIDATION", `${field} must be ${rule}.`, { field });
  }
  return value;
}

/** Validates the optional measurements; a stall code is checked separately because it is permanent. */
export function parseStallInput(raw: Record<string, unknown>): StallInput {
  const zone = typeof raw.zone === "string" ? raw.zone.trim().toUpperCase() : undefined;
  const code = typeof raw.code === "string" ? raw.code.trim().toUpperCase() : undefined;
  if (raw.code !== undefined && (code === undefined || !STALL_CODE.test(code))) {
    throw new HttpError(400, "VALIDATION", "code must look like PG-A01.", { field: "code" });
  }
  return {
    zone,
    code,
    width: measure(raw, "width", (n) => n > 0 && n <= 100, "a number of feet above 0 and at most 100"),
    depth: measure(raw, "depth", (n) => n > 0 && n <= 100, "a number of feet above 0 and at most 100"),
    x: measure(raw, "x", (n) => n >= 0 && n <= 10000, "a number of feet from 0 to 10000"),
    y: measure(raw, "y", (n) => n >= 0 && n <= 10000, "a number of feet from 0 to 10000"),
    rotation: measure(raw, "rotation", (n) => n >= 0 && n < 360, "a number of degrees from 0 to below 360"),
  };
}

async function stallView(tx: postgres.TransactionSql, stallId: string): Promise<StallView> {
  const [s] = await tx`
    select s.id, s.code, z.code as zone, s.width_ft, s.depth_ft, s.x_ft, s.y_ft, s.rotation_deg, s.inventory_status, s.admin_status
      from booking.stalls s join booking.zones z on z.id = s.zone_id where s.id = ${stallId}`;
  const num = (v: unknown) => (v === null ? null : Number(v));
  return {
    id: s.id, code: s.code, zone: s.zone, width: Number(s.width_ft), depth: Number(s.depth_ft),
    x: num(s.x_ft), y: num(s.y_ft), rotation: num(s.rotation_deg), inventoryStatus: s.inventory_status, adminStatus: s.admin_status,
  };
}

/**
 * Adds an approved stall (an organiser decision taken in the console) to an existing zone. The
 * code's prefix must name the zone, and a position is required: an approved stall needs one.
 */
export async function createStall(adminId: string, input: StallInput, httpRequestId: string): Promise<StallView> {
  if (!input.zone || !/^[A-Z]{2}$/.test(input.zone)) throw new HttpError(400, "VALIDATION", "zone must be a two-letter zone code.", { field: "zone" });
  if (!input.code) throw new HttpError(400, "VALIDATION", "code is required.", { field: "code" });
  if (!input.code.startsWith(`${input.zone}-`)) {
    throw new HttpError(400, "VALIDATION", `A stall in zone ${input.zone} must have a code starting with ${input.zone}-.`, { field: "code" });
  }
  if (input.x === undefined || input.y === undefined) throw new HttpError(400, "VALIDATION", "x and y (the stall's position) are required.", { field: "x" });
  const sql = await getDb();
  return sql.begin(async (tx) => {
    const [zone] = await tx`select id from booking.zones where code = ${input.zone!} and edition_id = ${EDITION_ID}`;
    if (!zone) throw new HttpError(404, "ZONE_NOT_FOUND", `Zone ${input.zone} was not found.`);
    const [created] = await tx`
      insert into booking.stalls (edition_id, zone_id, code, width_ft, depth_ft, x_ft, y_ft, rotation_deg, inventory_status, source_ref)
      values (${EDITION_ID}, ${zone.id}, ${input.code!}, ${input.width ?? 10}, ${input.depth ?? 10}, ${input.x!}, ${input.y!},
              ${input.rotation ?? 0}, 'approved', ${`admin console (${adminId})`})
      on conflict (edition_id, code) do nothing
      returning id`;
    if (!created) throw new HttpError(409, "STALL_EXISTS", `A stall with code ${input.code} already exists.`);
    await audit(tx, {
      action: "inventory_changed", actor: { type: "admin", adminId }, stallId: created.id, requestId: httpRequestId,
      details: { change: "stall_added", code: input.code, zone: input.zone },
    });
    return stallView(tx, created.id);
  });
}

/** Changes a stall's size or position. Its code is permanent (stalls_guard), so renaming is refused. */
export async function updateStall(adminId: string, stallId: string, input: StallInput, httpRequestId: string): Promise<StallView> {
  const sql = await getDb();
  return sql.begin(async (tx) => {
    const [stall] = await tx`select id, code from booking.stalls where id = ${stallId} and edition_id = ${EDITION_ID} for update`;
    if (!stall) throw new HttpError(404, "STALL_NOT_FOUND", "Stall not found.");
    if (input.code !== undefined && input.code !== stall.code) {
      throw new HttpError(400, "STALL_CODE_IMMUTABLE", "A stall code cannot be changed. Retire the stall and add a new one instead.", { field: "code" });
    }
    const changes = { width: input.width, depth: input.depth, x: input.x, y: input.y, rotation: input.rotation };
    await tx`
      update booking.stalls
         set width_ft = coalesce(${input.width ?? null}::numeric, width_ft),
             depth_ft = coalesce(${input.depth ?? null}::numeric, depth_ft),
             x_ft = coalesce(${input.x ?? null}::numeric, x_ft),
             y_ft = coalesce(${input.y ?? null}::numeric, y_ft),
             rotation_deg = coalesce(${input.rotation ?? null}::numeric, rotation_deg),
             updated_at = now()
       where id = ${stallId}`;
    await audit(tx, {
      action: "inventory_changed", actor: { type: "admin", adminId }, stallId, requestId: httpRequestId,
      details: { change: "stall_edited", code: stall.code, ...Object.fromEntries(Object.entries(changes).filter(([, v]) => v !== undefined)) },
    });
    return stallView(tx, stallId);
  });
}

export interface RetireResult {
  stallId: string;
  stallCode: string;
  changed: boolean;
}

/**
 * Retires a stall (removes it from the map and from booking). Refused while it is booked or held;
 * a hold that has run out is first marked expired. Reservation history is kept.
 */
export async function retireStall(adminId: string, stallId: string, httpRequestId: string): Promise<RetireResult> {
  return withRestart(() =>
    withBookingTx(async (tx): Promise<TxOutcome<RetireResult>> => {
      const [exists] = await tx`select id from booking.stalls where id = ${stallId} and edition_id = ${EDITION_ID}`;
      if (!exists) throw new HttpError(404, "STALL_NOT_FOUND", "That stall does not exist.");

      const [claimSeen] = await tx`
        select id, team_id from booking.reservations where stall_id = ${stallId} and status in ('held', 'confirmed')`;
      if (claimSeen) await tx`select id from booking.teams where id = ${claimSeen.team_id} for update`; // L1
      await lockStalls(tx, [stallId]); // L2
      const live = await tx`
        select id from booking.reservations where stall_id = ${stallId} and status in ('held', 'confirmed')
         order by id for update`; // L3
      if ((live[0]?.id ?? null) !== (claimSeen?.id ?? null)) throw new LockRace();

      const d = await decide(tx);
      const [stall] = await tx`select code, inventory_status from booking.stalls where id = ${stallId}`;
      if (live[0]) {
        const [claim] = await evaluate(tx, [live[0].id], d.decided);
        if (claim.status === "confirmed") {
          return fail(new HttpError(409, "STALL_HAS_BOOKING", "This stall has a confirmed booking. The booking must be cancelled first."));
        }
        if (claim.unexpired) {
          return fail(
            new HttpError(409, "STALL_HAS_ACTIVE_HOLD", "A team is holding this stall. Try again after the hold ends.", {
              holdExpiresAt: claim.expires_at,
            })
          );
        }
        await markExpired(tx, claim, d.decided, httpRequestId);
      }

      if (stall.inventory_status === "retired") return ok({ stallId, stallCode: stall.code as string, changed: false });
      await tx`update booking.stalls set inventory_status = 'retired', updated_at = now() where id = ${stallId}`;
      await audit(tx, {
        action: "inventory_changed", actor: { type: "admin", adminId }, stallId, requestId: httpRequestId,
        details: { change: "stall_retired", code: stall.code, from: stall.inventory_status },
      });
      return ok({ stallId, stallCode: stall.code as string, changed: true });
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
