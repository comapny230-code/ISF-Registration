/**
 * Organiser changes to a registration from the admin console: edit the leader's details, or delete
 * a registration that has no booking history. A registration id is the leader row's id in either
 * track (startup_team_leaders or student_innovators).
 */
import type postgres from "postgres";
import { EDITION_ID } from "../auth/leader";
import { HttpError } from "../http";
import { normalizeMobileNumber } from "./phone";

type Tx = postgres.TransactionSql;
type Track = "senior" | "junior";

interface Located {
  track: Track;
  id: string;
  userId: string;
  startupId: string | null;
}

async function locate(tx: Tx, id: string): Promise<Located> {
  const [senior] = await tx`
    select id, user_id, startup_id from public.startup_team_leaders where id = ${id} and edition_id = ${EDITION_ID} for update`;
  if (senior) return { track: "senior", id: senior.id, userId: senior.user_id, startupId: senior.startup_id };
  const [junior] = await tx`
    select id, user_id, startup_id from public.student_innovators where id = ${id} and edition_id = ${EDITION_ID} for update`;
  if (junior) return { track: "junior", id: junior.id, userId: junior.user_id, startupId: junior.startup_id };
  throw new HttpError(404, "REGISTRATION_NOT_FOUND", "Registration record was not found.");
}

const leaderTable = (tx: Tx, track: Track) => (track === "senior" ? tx`public.startup_team_leaders` : tx`public.student_innovators`);
const teamColumn = (tx: Tx, track: Track) => (track === "senior" ? tx`startup_team_leader_id` : tx`student_innovator_id`);

// ---------------------------------------------------------------------------
// Edit
// ---------------------------------------------------------------------------

export interface RegistrationEdit {
  teamName: string;
  leaderName: string;
  mobile: string;
  altMobile: string;
  domain: string;
  city: string;
  state: string;
  projectDetails: string | null;
}

function text(raw: Record<string, unknown>, field: string, label: string, max = 200): string {
  const value = typeof raw[field] === "string" ? (raw[field] as string).trim() : "";
  if (value.length < 1 || value.length > max) {
    throw new HttpError(400, "VALIDATION", `${label} must be between 1 and ${max} characters.`, { field });
  }
  return value;
}

/** Same rules as the registration form for the fields an organiser may change. */
export function parseRegistrationEdit(raw: Record<string, unknown>): RegistrationEdit {
  const teamName = text(raw, "teamName", "Team name");
  if (teamName.length < 2) throw new HttpError(400, "VALIDATION", "Team name must be at least 2 characters.", { field: "teamName" });
  const leaderName = text(raw, "leaderName", "Leader name");
  if (leaderName.length < 2) throw new HttpError(400, "VALIDATION", "Leader name must be at least 2 characters.", { field: "leaderName" });
  // Stored the way the registration form stores them (E.164), so duplicates are detected.
  const mobile = normalizeMobileNumber(typeof raw.mobile === "string" ? raw.mobile : "");
  if (!mobile) throw new HttpError(400, "VALIDATION", "Mobile must be a valid phone number.", { field: "mobile" });
  const altRaw = typeof raw.altMobile === "string" ? raw.altMobile.trim() : "";
  const altMobile = altRaw ? normalizeMobileNumber(altRaw) : mobile;
  if (!altMobile) throw new HttpError(400, "VALIDATION", "Alternate mobile must be a valid phone number.", { field: "altMobile" });
  const projectDetails = typeof raw.projectDetails === "string" ? raw.projectDetails.trim().slice(0, 5000) || null : null;
  return {
    teamName,
    leaderName,
    mobile,
    altMobile,
    domain: text(raw, "domain", "Domain"),
    city: text(raw, "city", "City", 100),
    state: text(raw, "state", "State", 100),
    projectDetails,
  };
}

/** Updates the leader row, the leader's account and the booking team name together. */
export async function editRegistration(sql: postgres.Sql, id: string, edit: RegistrationEdit): Promise<{ teamName: string }> {
  return sql.begin(async (tx) => {
    const reg = await locate(tx, id);
    // A primary phone may be shared between registrations (rule changed on main, 2026-10-30).
    await tx`
      update ${leaderTable(tx, reg.track)}
         set team_name = ${edit.teamName}, full_name = ${edit.leaderName}, mobile = ${edit.mobile}, alt_mobile = ${edit.altMobile},
             domain = ${edit.domain}, city = ${edit.city}, state = ${edit.state}, project_details = ${edit.projectDetails},
             updated_at = now()
       where id = ${reg.id}`;
    await tx`
      update public.user_accounts
         set full_name = ${edit.leaderName}, team_name = ${edit.teamName}, mobile_e164 = ${edit.mobile}, alt_mobile = ${edit.altMobile},
             domain = ${edit.domain}, city = ${edit.city}, state = ${edit.state}, project_details = ${edit.projectDetails},
             updated_at = now()
       where id = ${reg.userId}`;
    if (reg.track === "junior") {
      await tx`update public.student_team_members set team_name = ${edit.teamName} where student_innovator_id = ${reg.id}`;
    }
    await tx`
      update booking.teams set team_name_snapshot = ${edit.teamName}, updated_at = now()
       where ${teamColumn(tx, reg.track)} = ${reg.id} and edition_id = ${EDITION_ID}`;
    return { teamName: edit.teamName };
  });
}

// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------

/**
 * Deletes a registration that has no booking history: its booking team, member rows, leader row,
 * startup and memberships, and every account (leader and members) that nothing else refers to.
 * An account still used elsewhere (for example a member who leads another team) is kept.
 * A team with any reservation or audit entry is refused: that history is append-only, so the
 * organisers reject the team instead.
 */
export async function deleteRegistration(sql: postgres.Sql, id: string): Promise<{ track: Track; deletedAccounts: number }> {
  return sql.begin(async (tx) => {
    const reg = await locate(tx, id);
    const [team] = await tx`
      select id from booking.teams where ${teamColumn(tx, reg.track)} = ${reg.id} for update`;
    if (team) {
      const [history] = await tx`
        select exists (select 1 from booking.reservations where team_id = ${team.id})
            or exists (select 1 from booking.audit_events where team_id = ${team.id}) as yes`;
      if (history.yes) {
        throw new HttpError(
          409,
          "REGISTRATION_HAS_BOOKING_HISTORY",
          "This team has booking history, which must be kept. Reject the team instead of deleting it."
        );
      }
      await tx`delete from booking.teams where id = ${team.id}`;
    }

    const members =
      reg.track === "senior"
        ? await tx`delete from public.startup_team_members where leader_user_id = ${reg.userId} returning user_id`
        : await tx`delete from public.student_team_members where student_innovator_id = ${reg.id} returning user_id`;
    await tx`delete from ${leaderTable(tx, reg.track)} where id = ${reg.id}`;
    // The leader can no longer book: end any leader session now rather than at expiry.
    await tx`
      update app_auth.sessions set revoked_at = now(), revoke_reason = 'registration-deleted'
       where user_id = ${reg.userId} and principal_type = 'leader' and revoked_at is null`;

    const candidates = [reg.userId, ...members.map((m) => m.user_id).filter(Boolean)];
    if (reg.startupId) {
      await tx`delete from public.startup_memberships where startup_id = ${reg.startupId} and user_id = any(${candidates}::uuid[])`;
      const [inUse] = await tx`
        select exists (select 1 from public.startup_team_leaders where startup_id = ${reg.startupId})
            or exists (select 1 from public.student_innovators where startup_id = ${reg.startupId})
            or exists (select 1 from public.startup_team_members where startup_id = ${reg.startupId}) as yes`;
      if (!inUse.yes) {
        await tx`delete from public.startup_memberships where startup_id = ${reg.startupId}`;
        await tx`delete from public.startups where id = ${reg.startupId}`;
      }
    }

    const deleted = await tx`
      delete from public.user_accounts u
       where u.id = any(${candidates}::uuid[])
         and not exists (select 1 from public.startup_team_leaders where user_id = u.id)
         and not exists (select 1 from public.student_innovators where user_id = u.id)
         and not exists (select 1 from public.startup_team_members where user_id = u.id or leader_user_id = u.id)
         and not exists (select 1 from public.student_team_members where user_id = u.id or leader_user_id = u.id)
         and not exists (select 1 from public.startup_memberships where user_id = u.id)
         and not exists (select 1 from booking.teams where leader_user_id = u.id)
         and not exists (select 1 from booking.reservations
                          where u.id in (created_by_user_id, confirmed_by_user_id, released_by_user_id))
         and not exists (select 1 from booking.audit_events where actor_user_id = u.id)
      returning u.id`;
    return { track: reg.track, deletedAccounts: deleted.length };
  });
}
