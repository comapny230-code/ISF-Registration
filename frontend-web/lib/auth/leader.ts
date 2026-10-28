/**
 * Server-side team identity (docs/STALL_BOOKING_FINAL_SPEC.md §3.3).
 * A team for the edition IS exactly one leader registration row whose user_id is
 * the authenticated principal. Names, startups, categories, role_grants and any
 * client-supplied identifiers are never used.
 */
import type postgres from "postgres";
import { HttpError } from "../http";

export const EDITION_ID = 2026;

/**
 * booking.teams keeps a display snapshot of at most 200 characters; registration
 * itself never limited team-name length, so long names are truncated here only.
 */
export function teamNameSnapshot(name: string): string {
  return name.trim().slice(0, 200) || "Unnamed team";
}

export type Track = "senior" | "junior";

export type LeaderResolution =
  | { kind: "not_leader" }
  | { kind: "ambiguous" }
  | { kind: "leader"; track: Track; sourceId: string; teamName: string };

export async function resolveLeader(sql: postgres.ISql, userId: string): Promise<LeaderResolution> {
  const rows = await sql`
    select 'senior'::text as track, l.id, l.team_name
      from public.startup_team_leaders l
      join public.user_accounts u on u.id = l.user_id and u.status = 'active'
     where l.user_id = ${userId} and l.edition_id = ${EDITION_ID}
    union all
    select 'junior'::text as track, s.id, s.team_name
      from public.student_innovators s
      join public.user_accounts u on u.id = s.user_id and u.status = 'active'
     where s.user_id = ${userId} and s.edition_id = ${EDITION_ID}`;
  if (rows.length === 0) return { kind: "not_leader" };
  if (rows.length > 1) return { kind: "ambiguous" };
  return { kind: "leader", track: rows[0].track as Track, sourceId: rows[0].id, teamName: rows[0].team_name };
}

export interface TeamRow {
  id: string;
  track: Track;
  teamName: string;
  approvalStatus: "pending" | "approved" | "rejected";
}

function rejectUnresolved(resolution: LeaderResolution): asserts resolution is Extract<LeaderResolution, { kind: "leader" }> {
  if (resolution.kind === "not_leader") {
    throw new HttpError(403, "NOT_TEAM_LEADER", "Only the registered team leader can do this.");
  }
  if (resolution.kind === "ambiguous") {
    throw new HttpError(
      409,
      "TEAM_AMBIGUOUS",
      "This account is registered as a leader in more than one track. Please contact the organisers."
    );
  }
}

/**
 * Inside a transaction: ensures the team row exists and locks it (lock L1, §4.3).
 * Concurrent first calls for the same leader serialise on the unique key.
 */
export async function lockLeaderTeam(tx: postgres.TransactionSql, userId: string): Promise<TeamRow> {
  const resolution = await resolveLeader(tx, userId);
  rejectUnresolved(resolution);

  const senior = resolution.track === "senior";
  await tx`
    insert into booking.teams (edition_id, leader_user_id, track, startup_team_leader_id, student_innovator_id, team_name_snapshot)
    values (${EDITION_ID}, ${userId}, ${resolution.track},
            ${senior ? resolution.sourceId : null}, ${senior ? null : resolution.sourceId}, ${teamNameSnapshot(resolution.teamName)})
    on conflict (edition_id, leader_user_id) do nothing`;

  const [team] = await tx`
    select id, track, team_name_snapshot, approval_status, startup_team_leader_id, student_innovator_id
      from booking.teams
     where edition_id = ${EDITION_ID} and leader_user_id = ${userId}
       for update`;
  const source = senior ? team.startup_team_leader_id : team.student_innovator_id;
  if (team.track !== resolution.track || source !== resolution.sourceId) {
    throw new HttpError(409, "TEAM_RECORD_MISMATCH", "Your team record needs review. Please contact the organisers.");
  }
  return { id: team.id, track: team.track, teamName: team.team_name_snapshot, approvalStatus: team.approval_status };
}

export type TeamDescription =
  | { resolution: "not_leader" | "ambiguous" }
  | { resolution: "leader"; team: { name: string; track: Track; approvalStatus: TeamRow["approvalStatus"] } };

/** Read-only variant for status endpoints: no insert and no locks. */
export async function describeLeaderTeam(sql: postgres.ISql, userId: string): Promise<TeamDescription> {
  const resolution = await resolveLeader(sql, userId);
  if (resolution.kind !== "leader") return { resolution: resolution.kind };
  const [team] = await sql`
    select approval_status from booking.teams where edition_id = ${EDITION_ID} and leader_user_id = ${userId}`;
  return {
    resolution: "leader",
    team: { name: resolution.teamName, track: resolution.track, approvalStatus: team?.approval_status ?? "pending" },
  };
}
