/**
 * Registration writes (docs/STALL_BOOKING_FINAL_SPEC.md §6, R-02/R-03/R-04/R-05/R-09).
 *
 * - All rows are written in ONE transaction.
 * - Registration is create-only: an email that already has a leader registration
 *   in either track is rejected, so a resubmission can never take over a team.
 * - Existing user_accounts rows are never updated (leader or member).
 * - Each new leader gets their own startups row (no matching by team name).
 * - The edition-scoped booking team is created with approval 'pending'.
 */
import type postgres from "postgres";
import { EDITION_ID, teamNameSnapshot, type Track } from "../auth/leader";

export interface MemberInput {
  name: string;
  photoUrl: string | null;
  phone: string;
  email: string;
}

export interface RegistrationInput {
  track: Track;
  category: "startup_founder" | "student_innovator";
  email: string;
  fullName: string;
  teamName: string;
  photoUrl: string | null;
  mobile: string;
  altMobile: string;
  domain: string;
  projectDetails: string;
  projectReportUrl: string | null;
  aadharNumber: string;
  panNumber: string | null;
  city: string;
  state: string;
  country: string;
  linkedinUrl: string;
  passwordHash: string | null;
  members: MemberInput[];
}

export class AlreadyRegisteredError extends Error {
  constructor() {
    super("email already has a leader registration");
    this.name = "AlreadyRegisteredError";
  }
}

export async function persistRegistration(sql: postgres.Sql, input: RegistrationInput): Promise<{ userId: string; teamId: string }> {
  return sql.begin(async (tx) => {
    const memberSummary = input.members.map((m, i) => `${i + 1}. ${m.name} (${m.email}, ${m.phone})`).join("; ");

    // Create the account if it is new; an existing account is used as-is and never modified.
    await tx`
      insert into user_accounts (
        auth_subject, email, full_name, mobile_e164, password_hash,
        status, category, team_name, team_members, team_members_json, photo_url,
        domain, project_details, project_report_url, aadhar_number, pan_number,
        alt_mobile, city, state, country, linkedin_url
      ) values (
        ${`dev|${input.email}`}, ${input.email}, ${input.fullName}, ${input.mobile}, ${input.passwordHash},
        'active', ${input.category}, ${input.teamName}, ${memberSummary}, ${JSON.stringify(input.members)}::jsonb, ${input.photoUrl},
        ${input.domain}, ${input.projectDetails || null}, ${input.projectReportUrl}, ${input.aadharNumber}, ${input.panNumber},
        ${input.altMobile}, ${input.city}, ${input.state}, ${input.country}, ${input.linkedinUrl}
      )
      on conflict (lower(email)) where email is not null do nothing`;

    // Lock the account so concurrent submissions for the same email serialise here.
    const [account] = await tx`select id from user_accounts where lower(email) = ${input.email} for update`;
    const userId: string = account.id;

    const [existing] = await tx`
      select exists (select 1 from startup_team_leaders where user_id = ${userId})
          or exists (select 1 from student_innovators where user_id = ${userId}) as registered`;
    if (existing.registered) throw new AlreadyRegisteredError();

    await tx`insert into role_grants (user_id, role, edition_id) values (${userId}, 'startup_team_leader', ${EDITION_ID}) on conflict do nothing`;
    await tx`insert into edition_access (user_id, edition_id, source) values (${userId}, ${EDITION_ID}, 'predefined') on conflict do nothing`;

    const [startup] = await tx`
      insert into startups (name, origin, created_by, city, state, project_details, project_report_url)
      values (${input.teamName}, 'applicant', ${userId}, ${input.city}, ${input.state}, ${input.projectDetails || null}, ${input.projectReportUrl})
      returning id`;
    await tx`
      insert into startup_memberships (startup_id, user_id, position) values (${startup.id}, ${userId}, 'leader')
      on conflict (startup_id, user_id) do nothing`;

    const leaderValues = tx`(
      ${userId}, ${startup.id}, ${input.teamName}, ${input.fullName}, ${input.email},
      ${input.mobile}, ${input.altMobile}, ${input.domain}, ${input.projectDetails || null}, ${input.projectReportUrl},
      ${input.aadharNumber}, ${input.panNumber}, ${input.city}, ${input.state}, ${input.country},
      ${input.linkedinUrl}, ${input.photoUrl}, ${EDITION_ID}
    )`;
    const [leaderRow] =
      input.track === "senior"
        ? await tx`
            insert into startup_team_leaders (
              user_id, startup_id, team_name, full_name, email, mobile, alt_mobile, domain, project_details,
              project_report_url, aadhar_number, pan_number, city, state, country, linkedin_url, photo_url, edition_id
            ) values ${leaderValues} returning id`
        : await tx`
            insert into student_innovators (
              user_id, startup_id, team_name, full_name, email, mobile, alt_mobile, domain, project_details,
              project_report_url, aadhar_number, pan_number, city, state, country, linkedin_url, photo_url, edition_id
            ) values ${leaderValues} returning id`;

    const senior = input.track === "senior";
    const [team] = await tx`
      insert into booking.teams (edition_id, leader_user_id, track, startup_team_leader_id, student_innovator_id, team_name_snapshot)
      values (${EDITION_ID}, ${userId}, ${input.track}, ${senior ? leaderRow.id : null}, ${senior ? null : leaderRow.id}, ${teamNameSnapshot(input.teamName)})
      returning id`;

    const memberCategory = senior ? "startup_team_member" : "student_innovator";
    for (const m of input.members) {
      await tx`
        insert into user_accounts (auth_subject, email, full_name, mobile_e164, status, category, team_name, domain, city, state, country, photo_url)
        values (${`dev|${m.email}`}, ${m.email}, ${m.name}, ${m.phone || null}, 'active', ${memberCategory}, ${input.teamName},
                ${input.domain}, ${input.city}, ${input.state}, ${input.country}, ${m.photoUrl})
        on conflict (lower(email)) where email is not null do nothing`;
      const [member] = await tx`select id from user_accounts where lower(email) = ${m.email}`;

      await tx`insert into role_grants (user_id, role, edition_id) values (${member.id}, 'startup_team_member', ${EDITION_ID}) on conflict do nothing`;
      await tx`insert into edition_access (user_id, edition_id, source) values (${member.id}, ${EDITION_ID}, 'predefined') on conflict do nothing`;
      await tx`
        insert into startup_memberships (startup_id, user_id, position) values (${startup.id}, ${member.id}, 'member')
        on conflict (startup_id, user_id) do nothing`;

      if (senior) {
        await tx`
          insert into startup_team_members (startup_id, leader_user_id, user_id, name, photo_url, phone, email)
          values (${startup.id}, ${userId}, ${member.id}, ${m.name}, ${m.photoUrl}, ${m.phone}, ${m.email})`;
      } else {
        await tx`
          insert into student_team_members (student_innovator_id, leader_user_id, user_id, team_name, name, photo_url, phone, email)
          values (${leaderRow.id}, ${userId}, ${member.id}, ${input.teamName}, ${m.name}, ${m.photoUrl}, ${m.phone}, ${m.email})`;
      }
    }

    return { userId, teamId: team.id as string };
  });
}
