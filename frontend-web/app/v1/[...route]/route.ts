import { scryptSync, randomBytes, randomUUID } from "node:crypto";
import postgres from "postgres";
import { consumeRateLimit, LIMITS } from "@/lib/auth/rate-limit";
import { SESSION_COOKIE, sessionTokenFrom } from "@/lib/auth/session";
import { ConfigError, getFeatureFlags, getImageKitConfig } from "@/lib/config";
import { getDb } from "@/lib/db";
import { isSafeEmailAddress } from "@/lib/email-address";
import { assertSameOriginJson, clientAddress, HttpError, sessionCookie } from "@/lib/http";
import { sendMail } from "@/lib/mail";
import { buildConfirmationEmail } from "@/lib/registration/confirmation-email";
import { clearedOtpBindingCookie, otpBindingFrom } from "@/lib/auth/otp";
import { isValidAadhaar } from "@/lib/registration/aadhaar";
import { verifyRegistrationCode } from "@/lib/registration/email-verification";
import { checkCaptcha } from "@/lib/registration/captcha";
import { checkFormToken, checkHoneypot } from "@/lib/registration/form-guard";
import { normalizeMobileNumber } from "@/lib/registration/phone";
import {
  AadhaarAlreadyRegisteredError,
  AlreadyRegisteredError,
  PanAlreadyRegisteredError,
  PhoneAlreadyRegisteredError,
  persistRegistration,
  type RegistrationInput,
} from "@/lib/registration/persist";
import { isAcceptablePhoto, isAcceptableReport, readLimitedText } from "@/lib/registration/uploads";
import { TestDatabaseGuardError } from "@/lib/safety/test-database-guard";

export const dynamic = "force-dynamic";

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const derivedKey = scryptSync(password, salt, 64);
  return `${salt}:${derivedKey.toString("hex")}`;
}

async function uploadToImageKit(fileData: string, fileName: string): Promise<string> {
  if (!fileData) return "";
  if (fileData.startsWith("http://") || fileData.startsWith("https://")) {
    return fileData;
  }
  const imageKit = getImageKitConfig();
  if (!imageKit) {
    console.warn("[IMAGEKIT] Uploads are disabled in this environment; keeping the original data.");
    return fileData;
  }
  try {
    const authHeader = "Basic " + Buffer.from(imageKit.privateKey + ":").toString("base64");
    const form = new FormData();
    form.append("file", fileData);
    form.append("fileName", fileName);
    form.append("folder", imageKit.folder);

    const res = await fetch("https://upload.imagekit.io/api/v1/files/upload", {
      method: "POST",
      headers: { Authorization: authHeader },
      body: form,
    });

    if (res.ok) {
      const data = await res.json();
      return data.url || fileData;
    } else {
      const err = await res.text();
      console.error("[IMAGEKIT UPLOAD ERROR]", err);
    }
  } catch (err) {
    console.error("[IMAGEKIT FETCH ERROR]", err);
  }
  return fileData;
}

function normalizeLinkedInUrl(input: string): string {
  let val = (input || "").trim();
  if (!val) return "";
  if (/^https?:\/\//i.test(val)) return val;
  if (val.startsWith("//")) return `https:${val}`;
  if (/^([a-z0-9-]+\.)?linkedin\.com/i.test(val)) return `https://${val}`;
  if (/^in\/[a-zA-Z0-9_\-%\.]+/i.test(val)) return `https://www.linkedin.com/${val}`;
  if (/^[a-zA-Z0-9-]+\.[a-zA-Z]{2,}/.test(val)) return `https://${val}`;
  const cleanUsername = val.replace(/^@/, "");
  return `https://www.linkedin.com/in/${cleanUsername}`;
}


/** Set once the database is known to be managed by scripts/migrate.mts. */
let schemaManagedByMigrations = false;

async function ensureTables(sql: postgres.Sql) {
  // A database managed by the migration runner already has this schema, and the least-privilege
  // runtime role (isf_app) may not run DDL, so skip the legacy runtime creation there (R-08).
  if (schemaManagedByMigrations) return;
  const [managed] = await sql`select to_regclass('public.schema_migrations') is not null as yes`;
  if (managed?.yes) {
    schemaManagedByMigrations = true;
    return;
  }
  try {
    await sql.unsafe(`
      create table if not exists event_editions (
        id smallint primary key,
        name text not null,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      );
      insert into event_editions (id, name)
      values (2026, 'ISF Startup Jathara 2026')
      on conflict (id) do nothing;

      create table if not exists user_accounts (
        id uuid primary key default gen_random_uuid(),
        auth_subject text unique,
        email text,
        mobile_e164 text,
        full_name text not null,
        password_hash text,
        status text not null default 'active',
        category text,
        team_name text,
        team_members text,
        team_members_json jsonb,
        photo_url text,
        domain text,
        alt_mobile text,
        city text,
        state text,
        country text default 'India',
        linkedin_url text,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      );
      create unique index if not exists user_accounts_email_unique on user_accounts (lower(email)) where email is not null;

      create table if not exists startups (
        id uuid primary key default gen_random_uuid(),
        name text not null,
        name_normalized text generated always as (lower(regexp_replace(trim(name), '\\s+', ' ', 'g'))) stored,
        city text,
        state text,
        origin text not null default 'applicant',
        created_by uuid references user_accounts(id),
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      );

      create table if not exists startup_memberships (
        startup_id uuid not null references startups(id) on delete cascade,
        user_id uuid not null references user_accounts(id) on delete cascade,
        position text not null default 'leader',
        created_at timestamptz not null default now(),
        primary key (startup_id, user_id)
      );

      create table if not exists role_grants (
        id bigint generated always as identity primary key,
        user_id uuid not null references user_accounts(id) on delete cascade,
        role text not null,
        edition_id smallint references event_editions(id),
        granted_at timestamptz not null default now()
      );

      create table if not exists edition_access (
        user_id uuid not null references user_accounts(id) on delete cascade,
        edition_id smallint not null references event_editions(id),
        source text not null default 'predefined',
        granted_at timestamptz not null default now(),
        primary key (user_id, edition_id)
      );

      create table if not exists startup_team_leaders (
        id uuid primary key default gen_random_uuid(),
        user_id uuid not null references user_accounts(id) on delete cascade,
        startup_id uuid references startups(id) on delete set null,
        team_name text not null,
        full_name text not null,
        email text not null,
        mobile text,
        alt_mobile text,
        domain text,
        city text,
        state text,
        country text default 'India',
        linkedin_url text,
        photo_url text,
        edition_id smallint default 2026,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        constraint uq_startup_team_leaders_user unique (user_id)
      );
      create index if not exists idx_startup_team_leaders_email on startup_team_leaders(lower(email));

      create table if not exists startup_team_members (
        id uuid primary key default gen_random_uuid(),
        startup_id uuid references startups(id) on delete cascade,
        leader_user_id uuid references user_accounts(id) on delete cascade,
        user_id uuid references user_accounts(id) on delete cascade,
        name text not null,
        photo_url text,
        phone text not null,
        email text not null,
        created_at timestamptz not null default now()
      );
      create index if not exists idx_startup_team_members_leader on startup_team_members(leader_user_id);

      create table if not exists student_innovators (
        id uuid primary key default gen_random_uuid(),
        user_id uuid not null references user_accounts(id) on delete cascade,
        startup_id uuid references startups(id) on delete set null,
        team_name text not null,
        full_name text not null,
        email text not null,
        mobile text not null,
        alt_mobile text not null,
        domain text not null,
        city text not null,
        state text not null,
        country text not null default 'India',
        linkedin_url text,
        photo_url text,
        edition_id smallint default 2026,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        constraint uq_student_innovators_user unique (user_id)
      );
      create index if not exists idx_student_innovators_email on student_innovators(lower(email));

      create table if not exists student_team_members (
        id uuid primary key default gen_random_uuid(),
        student_innovator_id uuid references student_innovators(id) on delete cascade,
        leader_user_id uuid references user_accounts(id) on delete cascade,
        user_id uuid references user_accounts(id) on delete cascade,
        team_name text,
        name text not null,
        photo_url text,
        phone text not null,
        email text not null,
        created_at timestamptz not null default now()
      );
      create index if not exists idx_student_team_members_leader on student_team_members(leader_user_id);

      -- Ensure project details, report, aadhar, and pan columns exist
      alter table user_accounts add column if not exists project_details text;
      alter table user_accounts add column if not exists project_report_url text;
      alter table user_accounts add column if not exists aadhar_number text;
      alter table user_accounts add column if not exists pan_number text;
      alter table user_accounts add column if not exists id_consent_given boolean default false;
      alter table user_accounts add column if not exists id_consent_at timestamptz;
      alter table user_accounts add column if not exists id_consent_ip text;

      alter table startups add column if not exists project_details text;
      alter table startups add column if not exists project_report_url text;

      alter table startup_team_leaders add column if not exists project_details text;
      alter table startup_team_leaders add column if not exists project_report_url text;
      alter table startup_team_leaders add column if not exists aadhar_number text;
      alter table startup_team_leaders add column if not exists pan_number text;
      alter table startup_team_leaders add column if not exists id_consent_given boolean default false;
      alter table startup_team_leaders add column if not exists id_consent_at timestamptz;

      alter table student_innovators add column if not exists project_details text;
      alter table student_innovators add column if not exists project_report_url text;
      alter table student_innovators add column if not exists aadhar_number text;
      alter table student_innovators add column if not exists pan_number text;
      alter table student_innovators add column if not exists id_consent_given boolean default false;
      alter table student_innovators add column if not exists id_consent_at timestamptz;

      -- Anti-overwrite uniqueness indexes across all registration credentials
      create unique index if not exists uq_startup_team_leaders_email_edition on startup_team_leaders(lower(email), coalesce(edition_id, 2026));
      create unique index if not exists uq_student_innovators_email_edition on student_innovators(lower(email), coalesce(edition_id, 2026));
      create unique index if not exists uq_startup_team_leaders_aadhar on startup_team_leaders(aadhar_number, coalesce(edition_id, 2026)) where aadhar_number is not null;
      create unique index if not exists uq_student_innovators_aadhar on student_innovators(aadhar_number, coalesce(edition_id, 2026)) where aadhar_number is not null;
      create unique index if not exists uq_startup_team_leaders_pan on startup_team_leaders(upper(pan_number), coalesce(edition_id, 2026)) where pan_number is not null;
      create unique index if not exists uq_student_innovators_pan on student_innovators(upper(pan_number), coalesce(edition_id, 2026)) where pan_number is not null;
      -- Clean up any phone unique indexes that block legitimate multi-member or test registrations
      drop index if exists uq_startup_team_leaders_phone;
      drop index if exists uq_student_innovators_phone;
      drop index if exists idx_startup_team_leaders_phone_uq;
      drop index if exists idx_student_innovators_phone_uq;

      -- Ensure admin password_hash column exists
      alter table app_auth.admin_users add column if not exists password_hash text;
    `);
  } catch (err) {
    console.warn("[DB SCHEMA ENSURE]", err);
  }
}

async function handleRequest(request: Request) {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;

  // POST /v1/auth/register or /v1/public/signup
  if ((path.includes("/auth/register") || path.includes("/public/signup")) && method === "POST") {
    try {
      let body: any;
      try {
        body = JSON.parse(await readLimitedText(request));
      } catch (err) {
        if (err instanceof HttpError) throw err;
        throw new HttpError(400, "VALIDATION", "Request body must be valid JSON.");
      }
      if (!body || typeof body !== "object" || Array.isArray(body)) {
        throw new HttpError(400, "VALIDATION", "Request body must be a JSON object.");
      }
      // Bot filters first: a hidden field people never fill, and a minimum time to fill the form in.
      checkHoneypot(body);
      checkFormToken(body.formToken);
      await checkCaptcha(body.captchaToken, clientAddress(request));

      // Explicit voluntary consent for Aadhaar & PAN verification under DPDP Act / UIDAI compliance
      // Consent must be given explicitly (true); a missing value is not consent.
      if (body.consentAadhaarPan !== true) {
        return Response.json(
          {
            code: "CONSENT_REQUIRED",
            message: "Voluntary statutory consent for Aadhaar & PAN verification is required to complete registration.",
          },
          { status: 400 }
        );
      }

      const sql = await getDb();
      await consumeRateLimit(sql, LIMITS.registrationPerIp, clientAddress(request));
      await ensureTables(sql);
      const email = String(body.email || "").toLowerCase().trim();
      const fullName = String(body.fullName || "").trim();
      const password = typeof body.password === "string" ? body.password.trim() : "";
      const category = String(body.category || body.role || "startup_founder");
      const teamName = String(body.teamName || body.startupName || "").trim();
      const photoUrl = typeof body.photoUrl === "string" ? body.photoUrl.trim() : null;
      const rawMobile = String(body.mobile || body.phoneNumber || "").trim();
      const mobile = normalizeMobileNumber(rawMobile);
      const rawAltMobile = String(body.altMobile || "").trim();
      const altMobile = normalizeMobileNumber(rawAltMobile) || rawAltMobile;
      const domain = String(body.domain || "").trim();
      const projectDetails = String(body.projectDetails || body.projectDescription || "").trim();
      const rawProjectReport = String(body.projectReport || body.projectReportUrl || "").trim();
      const rawAadhar = String(body.aadharNumber || body.aadhar || "").trim().replace(/[\s-]/g, "");
      const aadharNumber = rawAadhar ? rawAadhar : null;
      const rawPan = String(body.panNumber || body.pan || "").replace(/[\s-]/g, "").toUpperCase();
      const panNumber = rawPan ? rawPan : null;
      const city = String(body.city || "").trim();
      const state = String(body.state || "").trim();
      const country = String(body.country || "India").trim();
      const linkedinUrl = normalizeLinkedInUrl(String(body.linkedinUrl || ""));

      // Only allow Startup Leader or Student Innovator
      const isStartupLeader = category === "startup_founder" || category === "startup_team_leader" || category === "startup_leader";
      const isStudentInnovator = category === "student_innovator";

      if (!isStartupLeader && !isStudentInnovator) {
        return Response.json(
          { message: "Registration is exclusively open for Startup Leaders and Student Innovators." },
          { status: 400 }
        );
      }

      // Parse structured members (1 to 5 members)
      const rawMembers: Array<any> = Array.isArray(body.members) ? body.members : [];
      const members: Array<{ name: string; photoUrl?: string; phone: string; email: string }> = rawMembers.slice(0, 5).map((m: any) => ({
        name: String(m?.name || "").trim(),
        photoUrl: typeof m?.photoUrl === "string" ? m.photoUrl.trim() : undefined,
        phone: normalizeMobileNumber(String(m?.phone || "").trim()) || String(m?.phone || "").trim(),
        email: String(m?.email || "").toLowerCase().trim(),
      }));

      // Validation
      // Plain single addresses only (also keeps crafted input away from the mail address parser).
      if (!email || !isSafeEmailAddress(email)) {
        return Response.json({ message: "A valid email address is required." }, { status: 400 });
      }
      if (!fullName) {
        return Response.json({ message: "Full name is required." }, { status: 400 });
      }
      if (!teamName) {
        return Response.json({ message: "Startup / Project Team name is required." }, { status: 400 });
      }
      // Matches the startups.name constraint in the schema of record (previously a raw 500).
      if (teamName.length > 200) {
        return Response.json({ message: "Startup / Project Team name must be at most 200 characters." }, { status: 400 });
      }
      if (!photoUrl) {
        return Response.json({ message: "Team lead photograph is required." }, { status: 400 });
      }
      if (!isAcceptablePhoto(photoUrl)) {
        return Response.json({ message: "Team lead photograph must be a JPEG, PNG or WebP image." }, { status: 400 });
      }
      if (rawProjectReport && !isAcceptableReport(rawProjectReport)) {
        return Response.json(
          { message: "Project report must be a PDF, Word, PowerPoint or image file under 20 MB, or an https:// link." },
          { status: 400 }
        );
      }
      if (!mobile) {
        return Response.json(
          { message: "A valid primary phone number is required (e.g. 10-digit mobile or +91 98765 43210)." },
          { status: 400 }
        );
      }
      if (!altMobile) {
        return Response.json({ message: "Alternate phone number is required." }, { status: 400 });
      }
      if (!domain) {
        return Response.json({ message: "Focus Sector / Innovation Domain is required." }, { status: 400 });
      }
      if (!projectDetails) {
        return Response.json({ message: "Project / Venture details (~200 words) are required." }, { status: 400 });
      }
      if (!city) {
        return Response.json({ message: "City is required." }, { status: 400 });
      }
      if (!state) {
        return Response.json({ message: "State is required." }, { status: 400 });
      }
      if (!country) {
        return Response.json({ message: "Country is required." }, { status: 400 });
      }
      if (!linkedinUrl) {
        return Response.json({ message: "LinkedIn profile URL is required." }, { status: 400 });
      }
      if (!aadharNumber || !isValidAadhaar(aadharNumber)) {
        return Response.json(
          { message: "A valid 12-digit Aadhaar Card number is required. Please check it against your Aadhaar card." },
          { status: 400 }
        );
      }
      // PAN is optional; when given it must have the PAN format (same rule as the form).
      if (panNumber && !/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(panNumber)) {
        return Response.json(
          { message: "Please enter a valid 10-character PAN Card number (e.g. ABCDE1234F) or leave it blank." },
          { status: 400 }
        );
      }
      if (members.length === 0) {
        return Response.json({ message: "At least one team member detail is required (max 5 members)." }, { status: 400 });
      }

      for (let i = 0; i < members.length; i++) {
        const m = members[i];
        if (!m.name) return Response.json({ message: `Member #${i + 1} name is required.` }, { status: 400 });
        if (!m.photoUrl) return Response.json({ message: `Member #${i + 1} (${m.name}) photo is required.` }, { status: 400 });
        if (!isAcceptablePhoto(m.photoUrl)) {
          return Response.json({ message: `Member #${i + 1} (${m.name}) photo must be a JPEG, PNG or WebP image.` }, { status: 400 });
        }
        if (!m.phone) return Response.json({ message: `Member #${i + 1} (${m.name}) phone number is required.` }, { status: 400 });
        if (!m.email || !isSafeEmailAddress(m.email)) return Response.json({ message: `Member #${i + 1} (${m.name}) valid email is required.` }, { status: 400 });
        if (m.email === email) {
          return Response.json({ message: `Member #${i + 1} (${m.name}) cannot use the team leader's email address.` }, { status: 400 });
        }
        if (members.findIndex((other) => other.email === m.email) !== i) {
          return Response.json({ message: `Member #${i + 1} (${m.name}) uses an email address already listed for another member.` }, { status: 400 });
        }
      }

      // The leader must have proved control of the email with the code we sent to it.
      const emailChallengeId = await verifyRegistrationCode(sql, email, body.emailCode, otpBindingFrom(request));

      // Upload leader photo to ImageKit if base64
      let storedLeaderPhoto = photoUrl;
      if (photoUrl && !photoUrl.startsWith("http")) {
        const cleanName = fullName.replace(/[^a-zA-Z0-9]/g, "_") || "leader";
        storedLeaderPhoto = await uploadToImageKit(photoUrl, `lead_${Date.now()}_${cleanName}.jpg`);
      }

      // Upload member photos to ImageKit if base64
      for (let i = 0; i < members.length; i++) {
        const m = members[i];
        if (m.photoUrl && !m.photoUrl.startsWith("http")) {
          const cleanMemName = m.name.replace(/[^a-zA-Z0-9]/g, "_") || `mem_${i + 1}`;
          m.photoUrl = await uploadToImageKit(m.photoUrl, `member_${i + 1}_${Date.now()}_${cleanMemName}.jpg`);
        }
      }

      // Upload project report document to ImageKit if base64
      let storedProjectReport: string | null = rawProjectReport || null;
      if (rawProjectReport && !rawProjectReport.startsWith("http")) {
        const cleanName = (teamName || fullName).replace(/[^a-zA-Z0-9]/g, "_") || "project";
        storedProjectReport = await uploadToImageKit(rawProjectReport, `report_${Date.now()}_${cleanName}.pdf`);
      }

      const registration: RegistrationInput = {
        track: isStudentInnovator ? "junior" : "senior",
        category: isStudentInnovator ? "student_innovator" : "startup_founder",
        email,
        fullName,
        teamName,
        photoUrl: storedLeaderPhoto,
        mobile,
        altMobile,
        domain,
        projectDetails,
        projectReportUrl: storedProjectReport,
        aadharNumber,
        panNumber,
        idConsentGiven: true,
        idConsentIp: clientAddress(request),
        city,
        state,
        country,
        linkedinUrl,
        passwordHash: password ? hashPassword(password) : null,
        members: members.map((m) => ({ name: m.name, photoUrl: m.photoUrl || null, phone: m.phone, email: m.email })),
      };

      // Only the site's own registration form (same-origin JSON) may receive a session;
      // anything else still registers but signs in later with an emailed code.
      let sameOrigin = false;
      try {
        assertSameOriginJson(request);
        sameOrigin = true;
      } catch {
        sameOrigin = false;
      }

      let userId: string;
      let session: Awaited<ReturnType<typeof persistRegistration>>["session"];
      try {
        ({ userId, session } = await persistRegistration(sql, registration, {
          emailChallengeId,
          startSession: sameOrigin,
          replacedToken: sameOrigin ? sessionTokenFrom(request, "leader") : null,
        }));
      } catch (err: any) {
        if (err instanceof AlreadyRegisteredError) {
          return Response.json(
            {
              code: "ALREADY_REGISTERED",
              message:
                "This email address already has a registered team or delegate. To protect applicant data, existing registrations cannot be overwritten. Please contact the organisers if you require updates.",
            },
            { status: 409 }
          );
        }
        if (err instanceof AadhaarAlreadyRegisteredError) {
          return Response.json(
            {
              code: "AADHAAR_ALREADY_REGISTERED",
              message: "This Aadhaar number is already associated with an existing registration. To prevent identity duplication, existing registrations cannot be overwritten.",
            },
            { status: 409 }
          );
        }
        if (err instanceof PanAlreadyRegisteredError) {
          return Response.json(
            {
              code: "PAN_ALREADY_REGISTERED",
              message: "This PAN number is already associated with an existing registration and cannot be overwritten.",
            },
            { status: 409 }
          );
        }
        if (err instanceof PhoneAlreadyRegisteredError) {
          return Response.json(
            {
              code: "PHONE_ALREADY_REGISTERED",
              message: "This primary phone number is already registered for another delegate leader and cannot be overwritten.",
            },
            { status: 409 }
          );
        }
        if (err?.code === "23505") {
          return Response.json(
            {
              code: "REGISTRATION_CONFLICT",
              message: "A registration with these unique credentials (email, phone, Aadhaar, or PAN) already exists. Overwriting is not permitted.",
            },
            { status: 409 }
          );
        }
        throw err;
      }

      // Confirmation email (sent after the registration has been committed)
      try {
        await sendMail({ to: email, ...buildConfirmationEmail(registration) });
      } catch (e: any) {
        console.error("[REGISTRATION EMAIL ERROR]", { name: e?.name, code: e?.code, message: e?.message });
      }

      // The session row was committed with the registration; the cookie is sent only now.
      const headers = new Headers({ "Cache-Control": "private, no-store" });
      if (session) headers.append("Set-Cookie", sessionCookie(SESSION_COOKIE.leader, session.token, session.maxAgeSeconds));
      headers.append("Set-Cookie", clearedOtpBindingCookie());
      const bookingUi = getFeatureFlags().bookingUi;

      return Response.json({
        ok: true,
        booking: {
          // Where the page should go next: straight to booking when signed in, otherwise sign in first.
          next: !bookingUi ? null : session ? "/book-your-stall" : "/login?next=/book-your-stall",
          signedIn: Boolean(session),
        },
        user: {
          id: userId,
          email,
          fullName,
          roles: ["startup_team_leader"],
          category: registration.category,
          teamName,
          photoUrl: storedLeaderPhoto,
          domain,
          projectDetails,
          projectReportUrl: storedProjectReport,
          membersCount: members.length,
        },
        message: "Registration successful! Your application has been recorded in the summit database.",
      }, { headers });
    } catch (err: any) {
      const requestId = randomUUID();
      // Log identifiers only: driver errors can carry submitted values in their detail fields.
      console.error("[REGISTRATION ERROR]", {
        requestId,
        name: err?.name,
        code: err?.code,
        constraint: err?.constraint_name,
        message: err?.message,
      });

      if (err instanceof HttpError) {
        return Response.json(
          { code: err.code, message: err.message, requestId },
          { status: err.status, headers: err.headers }
        );
      }
      if (err instanceof ConfigError || err instanceof TestDatabaseGuardError) {
        return Response.json(
          { message: "Registration is temporarily unavailable. Please try again later.", requestId },
          { status: 503 }
        );
      }
      if (err?.code === "ECONNREFUSED" || err?.name === "AggregateError" || err?.message?.includes("connection refused")) {
        return Response.json(
          {
            code: "DATABASE_UNAVAILABLE",
            message: "Database connection could not be established. Please check your PostgreSQL or Supabase DATABASE_URL.",
            requestId,
          },
          { status: 503 }
        );
      }
      return Response.json(
        {
          message: "Registration failed due to a server error. Please try again, or contact the organisers with this reference.",
          requestId,
        },
        { status: 500 }
      );
    }
  }

  return Response.json({ error: "Endpoint not found" }, { status: 404 });
}

export { handleRequest as GET, handleRequest as POST };
