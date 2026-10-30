/**
 * Registration writes (docs/STALL_BOOKING_FINAL_SPEC.md §6, R-02/R-03/R-04/R-05/R-09).
 *
 * - All rows are written in ONE transaction.
 * - Registration is create-only: an email that already has a leader registration
 *   in either track is rejected, so a resubmission can never take over a team.
 * - Existing user_accounts rows are never updated (leader or member).
 * - Each new leader gets their own startups row (no matching by team name).
 * - The edition-scoped booking team is created with approval 'pending'.
 * - The leader's email must have been verified with a registration code (consumed here),
 *   and an Aadhaar number can lead only one registration.
 */
import type postgres from "postgres";
import { EDITION_ID, teamNameSnapshot, type Track } from "../auth/leader";
import { createSession, REGISTRATION_HANDOFF_LIFETIME, revokeSessionToken, type CreatedSession } from "../auth/session";
import { HttpError } from "../http";

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
  idConsentGiven?: boolean;
  idConsentIp?: string | null;
  city: string;
  state: string;
  country: string;
  linkedinUrl: string;
  passwordHash: string | null;
  members: MemberInput[];
}

export class AadhaarAlreadyRegisteredError extends Error {
  constructor() {
    super("aadhaar number already has a leader registration");
    this.name = "AadhaarAlreadyRegisteredError";
  }
}

export class PanAlreadyRegisteredError extends Error {
  constructor() {
    super("pan number already has a registration");
    this.name = "PanAlreadyRegisteredError";
  }
}

export class PhoneAlreadyRegisteredError extends Error {
  constructor() {
    super("primary phone number already has a leader registration");
    this.name = "PhoneAlreadyRegisteredError";
  }
}

export class AlreadyRegisteredError extends Error {
  constructor() {
    super("email already has a leader or member registration");
    this.name = "AlreadyRegisteredError";
  }
}

export interface PersistOptions {
  /**
   * The verified registration email challenge (lib/registration/email-verification.ts).
   * It is consumed in this transaction, so one code saves at most one registration and a
   * registration that rolls back leaves the code usable.
   */
  emailChallengeId: string;
  /**
   * Also start a short leader session for the new leader, inside this transaction, so it
   * exists only if the registration commits. The email has been proved with a code, so
   * this is safe even when the address already had an account (e.g. as a team member).
   */
  startSession?: boolean;
  /** A leader session token already on this browser; revoked if a new session is started. */
  replacedToken?: string | null;
}

export async function persistRegistration(
  sql: postgres.Sql,
  input: RegistrationInput,
  options: PersistOptions
): Promise<{ userId: string; teamId: string; session: CreatedSession | null }> {
  return sql.begin(async (tx) => {
    const consumed = await tx`
      update app_auth.registration_email_challenges set consumed_at = clock_timestamp()
       where id = ${options.emailChallengeId} and email = ${input.email}
         and verified_at is not null and consumed_at is null and superseded_at is null and expires_at > clock_timestamp()
      returning id`;
    if (consumed.length !== 1) {
      throw new HttpError(400, "EMAIL_CODE_INVALID", "The email verification code is invalid or has expired. Request a new code and try again.");
    }

    const memberSummary = input.members.map((m, i) => `${i + 1}. ${m.name} (${m.email}, ${m.phone})`).join("; ");
    const consentGiven = input.idConsentGiven === true;

    // Create the account if it is new; an existing account is used as-is and never modified (no overwrites).
    await tx`
      insert into user_accounts (
        auth_subject, email, full_name, mobile_e164, password_hash,
        status, category, team_name, team_members, team_members_json, photo_url,
        domain, project_details, project_report_url, aadhar_number, pan_number,
        alt_mobile, city, state, country, linkedin_url,
        id_consent_given, id_consent_at, id_consent_ip
      ) values (
        ${`dev|${input.email}`}, ${input.email}, ${input.fullName}, ${input.mobile}, ${input.passwordHash},
        'active', ${input.category}, ${input.teamName}, ${memberSummary}, ${JSON.stringify(input.members)}::jsonb, ${input.photoUrl},
        ${input.domain}, ${input.projectDetails || null}, ${input.projectReportUrl}, ${input.aadharNumber}, ${input.panNumber},
        ${input.altMobile}, ${input.city}, ${input.state}, ${input.country}, ${input.linkedinUrl},
        ${consentGiven}, ${consentGiven ? tx`clock_timestamp()` : null}, ${input.idConsentIp || null}
      )
      on conflict (lower(email)) where email is not null do nothing`;

    // Lock the account so concurrent submissions for the same email serialise here.
    const [account] = await tx`select id from user_accounts where lower(email) = ${input.email} for update`;
    const userId: string = account.id;

    // Check 1: Anti-overwrite guarantee for email (cannot overwrite existing leader)
    const [existing] = await tx`
      select exists (select 1 from startup_team_leaders where user_id = ${userId} or lower(email) = ${input.email})
          or exists (select 1 from student_innovators where user_id = ${userId} or lower(email) = ${input.email}) as registered`;
    if (existing.registered) throw new AlreadyRegisteredError();

    // Check 2: Anti-overwrite guarantee for Aadhaar across tracks and accounts
    await tx`select pg_advisory_xact_lock(hashtext(${`isf-aadhaar:${input.aadharNumber}`}))`;
    const [aadhaar] = await tx`
      select exists (select 1 from startup_team_leaders where aadhar_number = ${input.aadharNumber} and edition_id = ${EDITION_ID})
          or exists (select 1 from student_innovators where aadhar_number = ${input.aadharNumber} and edition_id = ${EDITION_ID})
          or exists (select 1 from user_accounts where aadhar_number = ${input.aadharNumber} and id <> ${userId}) as taken`;
    if (aadhaar.taken) throw new AadhaarAlreadyRegisteredError();

    // Check 3: Anti-overwrite guarantee for PAN across tracks and accounts (if PAN is provided)
    if (input.panNumber) {
      const panClean = input.panNumber.trim().toUpperCase();
      await tx`select pg_advisory_xact_lock(hashtext(${`isf-pan:${panClean}`}))`;
      const [pan] = await tx`
        select exists (select 1 from startup_team_leaders where upper(pan_number) = ${panClean} and edition_id = ${EDITION_ID})
            or exists (select 1 from student_innovators where upper(pan_number) = ${panClean} and edition_id = ${EDITION_ID})
            or exists (select 1 from user_accounts where upper(pan_number) = ${panClean} and id <> ${userId}) as taken`;
      if (pan.taken) throw new PanAlreadyRegisteredError();
    }

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
      ${input.linkedinUrl}, ${input.photoUrl}, ${EDITION_ID},
      ${consentGiven}, ${consentGiven ? tx`clock_timestamp()` : null}
    )`;
    const [leaderRow] =
      input.track === "senior"
        ? await tx`
            insert into startup_team_leaders (
              user_id, startup_id, team_name, full_name, email, mobile, alt_mobile, domain, project_details,
              project_report_url, aadhar_number, pan_number, city, state, country, linkedin_url, photo_url, edition_id,
              id_consent_given, id_consent_at
            ) values ${leaderValues} returning id`
        : await tx`
            insert into student_innovators (
              user_id, startup_id, team_name, full_name, email, mobile, alt_mobile, domain, project_details,
              project_report_url, aadhar_number, pan_number, city, state, country, linkedin_url, photo_url, edition_id,
              id_consent_given, id_consent_at
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

    let session: CreatedSession | null = null;
    if (options.startSession) {
      if (options.replacedToken) await revokeSessionToken(tx, options.replacedToken, "rotated");
      session = await createSession(tx, "leader", userId, REGISTRATION_HANDOFF_LIFETIME);
    }
    return { userId, teamId: team.id as string, session };
  });
}
