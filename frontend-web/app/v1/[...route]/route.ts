import { scryptSync, randomBytes } from "node:crypto";
import nodemailer from "nodemailer";
import postgres from "postgres";

export const dynamic = "force-dynamic";

const DB_URL =
  process.env.DATABASE_URL ||
  "postgresql://postgres.ddrremsyzozutyxbxigf:n0fE3G5tjwyXTt5C@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres?sslmode=require";

// Auto-converts IPv6-only direct Supabase host to IPv4 connection pooler
function resolveDatabaseUrl(rawUrl: string): string {
  if (!rawUrl) return rawUrl;
  let urlStr = rawUrl.trim();

  // Pattern: db.<project-ref>.supabase.co (IPv6 direct) -> aws-0-<region>.pooler.supabase.com:6543 (IPv4 pooler)
  const directMatch = urlStr.match(
    /^(postgres(?:ql)?:\/\/)([^:@/]+)(?::([^@/]*))?@db\.([a-z0-9]+)\.supabase\.co(?::\d+)?(\/[^?]*)?(.*)$/i
  );

  if (directMatch) {
    const [, protocol, username, password, projectRef, pathname = "/postgres", query = ""] = directMatch;
    // Project ddrremsyzozutyxbxigf is verified in ap-southeast-1 (Singapore)
    const region = process.env.SUPABASE_REGION || "ap-southeast-1";
    const poolerUser = username.includes(".") ? username : `${username}.${projectRef}`;
    const poolerHost = `aws-0-${region}.pooler.supabase.com:6543`;
    const pwdPart = password !== undefined ? `:${password}` : "";
    const cleanQuery = query.includes("sslmode=") ? query : (query ? `${query}&sslmode=require` : "?sslmode=require");
    return `${protocol}${poolerUser}${pwdPart}@${poolerHost}${pathname || "/postgres"}${cleanQuery}`;
  }

  // If user pasted ap-south-1 for ddrremsyzozutyxbxigf, auto-correct to ap-southeast-1
  if (urlStr.includes("ddrremsyzozutyxbxigf") && urlStr.includes("aws-0-ap-south-1")) {
    urlStr = urlStr.replace("aws-0-ap-south-1", "aws-0-ap-southeast-1");
  }

  // Ensure connection pooler has sslmode=require
  if (urlStr.includes("pooler.supabase.com") && !urlStr.includes("sslmode=")) {
    urlStr += (urlStr.includes("?") ? "&" : "?") + "sslmode=require";
  }

  return urlStr;
}

let sqlInstance: postgres.Sql | null = null;
function getSql() {
  if (!sqlInstance) {
    const resolvedUrl = resolveDatabaseUrl(DB_URL);
    sqlInstance = postgres(resolvedUrl, {
      ssl: { rejectUnauthorized: false },
      prepare: false, // Essential for Supabase Connection Pooler / PgBouncer transaction mode
      max: 5,
      idle_timeout: 10,
      connect_timeout: 15,
    });
  }
  return sqlInstance;
}

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const derivedKey = scryptSync(password, salt, 64);
  return `${salt}:${derivedKey.toString("hex")}`;
}

function getTransporter() {
  const host = process.env.SMTP_HOST || "smtp.gmail.com";
  const user = process.env.SMTP_USER || "akshatrajpati@gmail.com";
  const pass = (process.env.SMTP_PASS || "yxgsiitfsxskjfpl").replace(/\s+/g, "");
  const port = Number(process.env.SMTP_PORT) || 465;

  if (host.includes("gmail") || user.includes("gmail")) {
    return nodemailer.createTransport({
      service: "gmail",
      auth: { user, pass },
      connectionTimeout: 15000,
      greetingTimeout: 15000,
      socketTimeout: 20000,
    });
  }

  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 20000,
    tls: {
      rejectUnauthorized: false,
    },
  });
}

function getSenderAddress(displayName = "ISF · Startup Jathara 2026") {
  const user = process.env.SMTP_USER || "akshatrajpati@gmail.com";
  return process.env.NOTIFY_EMAIL_FROM || `"${displayName}" <${user}>`;
}

const IMAGEKIT_ID = process.env.IMAGEKIT_ID || "72ei8gyxi";
const IMAGEKIT_URL_ENDPOINT = process.env.IMAGEKIT_URL_ENDPOINT || "https://ik.imagekit.io/72ei8gyxi";
const IMAGEKIT_PUBLIC_KEY = process.env.IMAGEKIT_PUBLIC_KEY || "public_3oWGei3km522bT76QOi7Kvf2NMo=";
const IMAGEKIT_PRIVATE_KEY = process.env.IMAGEKIT_PRIVATE_KEY || "private_yVxTwanRWZICeuQRSLBnimhzynU=";

async function uploadToImageKit(fileData: string, fileName: string): Promise<string> {
  if (!fileData) return "";
  if (fileData.startsWith("http://") || fileData.startsWith("https://")) {
    return fileData;
  }
  try {
    const authHeader = "Basic " + Buffer.from(IMAGEKIT_PRIVATE_KEY + ":").toString("base64");
    const form = new FormData();
    form.append("file", fileData);
    form.append("fileName", fileName);
    form.append("folder", "/isf_registrations");

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

function normalizeMobileNumber(input: string): string | null {
  if (!input) return null;
  let s = String(input).trim().replace(/[\s\-().]/g, "");
  if (!s) return null;

  if (s.startsWith("00")) {
    s = "+" + s.slice(2);
  }
  if (/^[6-9]\d{9}$/.test(s)) return `+91${s}`;
  if (/^0[6-9]\d{9}$/.test(s)) return `+91${s.slice(1)}`;
  if (/^91[6-9]\d{9}$/.test(s)) return `+${s}`;
  if (/^\d{10}$/.test(s)) return `+91${s}`;
  if (/^0\d{10}$/.test(s)) return `+91${s.slice(1)}`;
  if (/^91\d{10}$/.test(s)) return `+${s}`;
  if (/^\+[1-9]\d{7,14}$/.test(s)) return s;
  if (/^[1-9]\d{7,14}$/.test(s)) return `+${s}`;

  return null;
}

async function ensureTables(sql: postgres.Sql) {
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

      alter table startups add column if not exists project_details text;
      alter table startups add column if not exists project_report_url text;

      alter table startup_team_leaders add column if not exists project_details text;
      alter table startup_team_leaders add column if not exists project_report_url text;
      alter table startup_team_leaders add column if not exists aadhar_number text;
      alter table startup_team_leaders add column if not exists pan_number text;

      alter table student_innovators add column if not exists project_details text;
      alter table student_innovators add column if not exists project_report_url text;
      alter table student_innovators add column if not exists aadhar_number text;
      alter table student_innovators add column if not exists pan_number text;
    `);
  } catch (err) {
    console.warn("[DB SCHEMA ENSURE]", err);
  }
}

async function handleRequest(request: Request) {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;

  if (method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
      },
    });
  }

  // POST /v1/auth/register or /v1/public/signup
  if ((path.includes("/auth/register") || path.includes("/public/signup")) && method === "POST") {
    try {
      const sql = getSql();
      await ensureTables(sql);

      const body = await request.json();
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
      const rawPan = String(body.panNumber || body.pan || "").trim().toUpperCase();
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
      if (!email || !email.includes("@")) {
        return Response.json({ message: "A valid email address is required." }, { status: 400 });
      }
      if (!fullName) {
        return Response.json({ message: "Full name is required." }, { status: 400 });
      }
      if (!teamName) {
        return Response.json({ message: "Startup / Project Team name is required." }, { status: 400 });
      }
      if (!photoUrl) {
        return Response.json({ message: "Team lead photograph is required." }, { status: 400 });
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
      if (members.length === 0) {
        return Response.json({ message: "At least one team member detail is required (max 5 members)." }, { status: 400 });
      }

      for (let i = 0; i < members.length; i++) {
        const m = members[i];
        if (!m.name) return Response.json({ message: `Member #${i + 1} name is required.` }, { status: 400 });
        if (!m.photoUrl) return Response.json({ message: `Member #${i + 1} (${m.name}) photo is required.` }, { status: 400 });
        if (!m.phone) return Response.json({ message: `Member #${i + 1} (${m.name}) phone number is required.` }, { status: 400 });
        if (!m.email || !m.email.includes("@")) return Response.json({ message: `Member #${i + 1} (${m.name}) valid email is required.` }, { status: 400 });
      }

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

      const role = "startup_team_leader";
      const passwordHash = password ? hashPassword(password) : null;
      const authSub = `dev|${email}`;

      const teamMembersSummary = members.map((m, i) => `${i + 1}. ${m.name} (${m.email}, ${m.phone})`).join("; ");

      // Insert or update leader in user_accounts
      const [user] = await sql`
        insert into user_accounts (
          auth_subject, email, full_name, mobile_e164, password_hash,
          status, category, team_name, team_members, team_members_json, photo_url,
          domain, project_details, project_report_url, aadhar_number, pan_number,
          alt_mobile, city, state, country, linkedin_url
        )
        values (
          ${authSub}, ${email}, ${fullName}, ${mobile}, ${passwordHash},
          'active', ${category}, ${teamName}, ${teamMembersSummary}, ${JSON.stringify(members)}::jsonb, ${storedLeaderPhoto},
          ${domain}, ${projectDetails || null}, ${storedProjectReport || null}, ${aadharNumber || null}, ${panNumber || null},
          ${altMobile}, ${city}, ${state}, ${country}, ${linkedinUrl}
        )
        on conflict (lower(email)) where email is not null do update
        set auth_subject = ${authSub},
            full_name = ${fullName},
            mobile_e164 = coalesce(${mobile}, user_accounts.mobile_e164),
            password_hash = coalesce(${passwordHash}, user_accounts.password_hash),
            status = 'active',
            category = ${category},
            team_name = ${teamName},
            team_members = ${teamMembersSummary},
            team_members_json = ${JSON.stringify(members)}::jsonb,
            photo_url = coalesce(${storedLeaderPhoto}, user_accounts.photo_url),
            domain = ${domain},
            project_details = coalesce(${projectDetails || null}, user_accounts.project_details),
            project_report_url = coalesce(${storedProjectReport || null}, user_accounts.project_report_url),
            aadhar_number = coalesce(${aadharNumber || null}, user_accounts.aadhar_number),
            pan_number = coalesce(${panNumber || null}, user_accounts.pan_number),
            alt_mobile = ${altMobile},
            city = ${city},
            state = ${state},
            country = ${country},
            linkedin_url = ${linkedinUrl},
            updated_at = now()
        returning id, email, full_name
      `;

      const userId = user.id;

      // Grant role & edition access
      await sql`
        insert into role_grants (user_id, role, edition_id)
        values (${userId}, ${role}, 2026)
        on conflict do nothing
      `;
      await sql`
        insert into edition_access (user_id, edition_id, source)
        values (${userId}, 2026, 'predefined')
        on conflict do nothing
      `;

      // Startup link
      let startupId: string | null = null;
      const [existingStartup] = await sql`
        select id from startups where name_normalized = lower(regexp_replace(trim(${teamName}), '\\s+', ' ', 'g')) limit 1
      `;
      if (existingStartup) {
        startupId = existingStartup.id;
        await sql`
          update startups
          set project_details = coalesce(${projectDetails || null}, startups.project_details),
              project_report_url = coalesce(${storedProjectReport || null}, startups.project_report_url),
              updated_at = now()
          where id = ${startupId}
        `;
      } else {
        const [newStartup] = await sql`
          insert into startups (name, origin, created_by, city, state, project_details, project_report_url)
          values (${teamName}, 'applicant', ${userId}, ${city}, ${state}, ${projectDetails || null}, ${storedProjectReport || null})
          returning id
        `;
        startupId = newStartup?.id || null;
      }

      if (startupId) {
        await sql`
          insert into startup_memberships (startup_id, user_id, position)
          values (${startupId}, ${userId}, 'leader')
          on conflict (startup_id, user_id) do update set position = 'leader'
        `;
      }

      // Track 1: Startup Team Leader
      if (isStartupLeader) {
        await sql`
          insert into startup_team_leaders (
            user_id, startup_id, team_name, full_name, email,
            mobile, alt_mobile, domain, project_details, project_report_url,
            aadhar_number, pan_number, city, state, country,
            linkedin_url, photo_url, edition_id
          )
          values (
            ${userId}, ${startupId}, ${teamName}, ${fullName}, ${email},
            ${mobile}, ${altMobile}, ${domain}, ${projectDetails || null}, ${storedProjectReport || null},
            ${aadharNumber || null}, ${panNumber || null}, ${city}, ${state}, ${country},
            ${linkedinUrl}, ${storedLeaderPhoto}, 2026
          )
          on conflict (user_id) do update set
            startup_id = coalesce(${startupId}, startup_team_leaders.startup_id),
            team_name = ${teamName},
            full_name = ${fullName},
            email = ${email},
            mobile = ${mobile},
            alt_mobile = ${altMobile},
            domain = ${domain},
            project_details = coalesce(${projectDetails || null}, startup_team_leaders.project_details),
            project_report_url = coalesce(${storedProjectReport || null}, startup_team_leaders.project_report_url),
            aadhar_number = coalesce(${aadharNumber || null}, startup_team_leaders.aadhar_number),
            pan_number = coalesce(${panNumber || null}, startup_team_leaders.pan_number),
            city = ${city},
            state = ${state},
            country = ${country},
            linkedin_url = ${linkedinUrl},
            photo_url = coalesce(${storedLeaderPhoto}, startup_team_leaders.photo_url),
            updated_at = now()
        `;

        await sql`delete from startup_team_members where leader_user_id = ${userId}`;
        for (const m of members) {
          if (m?.name && m?.email) {
            const memberEmail = m.email.toLowerCase().trim();
            const memberAuthSub = `dev|${memberEmail}`;
            const [memberUser] = await sql`
              insert into user_accounts (
                auth_subject, email, full_name, mobile_e164, status,
                category, team_name, domain, city, state, country, photo_url
              )
              values (
                ${memberAuthSub}, ${memberEmail}, ${m.name}, ${m.phone || null}, 'active',
                'startup_team_member', ${teamName}, ${domain}, ${city}, ${state}, ${country}, ${m.photoUrl || null}
              )
              on conflict (lower(email)) where email is not null do update
              set full_name = ${m.name},
                  mobile_e164 = coalesce(${m.phone || null}, user_accounts.mobile_e164),
                  category = 'startup_team_member',
                  team_name = ${teamName},
                  domain = ${domain},
                  photo_url = coalesce(${m.photoUrl || null}, user_accounts.photo_url),
                  updated_at = now()
              returning id
            `;
            const memberUserId = memberUser?.id || null;
            if (memberUserId) {
              await sql`
                insert into role_grants (user_id, role, edition_id)
                values (${memberUserId}, 'startup_team_member', 2026)
                on conflict do nothing
              `;
              await sql`
                insert into edition_access (user_id, edition_id, source)
                values (${memberUserId}, 2026, 'predefined')
                on conflict do nothing
              `;
              if (startupId) {
                await sql`
                  insert into startup_memberships (startup_id, user_id, position)
                  values (${startupId}, ${memberUserId}, 'member')
                  on conflict (startup_id, user_id) do update set position = 'member'
                `;
              }
            }

            await sql`
              insert into startup_team_members (startup_id, leader_user_id, user_id, name, photo_url, phone, email)
              values (
                ${startupId},
                ${userId},
                ${memberUserId},
                ${m.name},
                ${m.photoUrl || null},
                ${m.phone},
                ${memberEmail}
              )
            `;
          }
        }
      }

      // Track 2: Student Innovator
      if (isStudentInnovator) {
        const [innovator] = await sql`
          insert into student_innovators (
            user_id, startup_id, team_name, full_name, email,
            mobile, alt_mobile, domain, project_details, project_report_url,
            aadhar_number, pan_number, city, state, country,
            linkedin_url, photo_url, edition_id
          )
          values (
            ${userId}, ${startupId}, ${teamName}, ${fullName}, ${email},
            ${mobile}, ${altMobile}, ${domain}, ${projectDetails || null}, ${storedProjectReport || null},
            ${aadharNumber || null}, ${panNumber || null}, ${city}, ${state}, ${country},
            ${linkedinUrl}, ${storedLeaderPhoto}, 2026
          )
          on conflict (user_id) do update set
            startup_id = coalesce(${startupId}, student_innovators.startup_id),
            team_name = ${teamName},
            full_name = ${fullName},
            email = ${email},
            mobile = ${mobile},
            alt_mobile = ${altMobile},
            domain = ${domain},
            project_details = coalesce(${projectDetails || null}, student_innovators.project_details),
            project_report_url = coalesce(${storedProjectReport || null}, student_innovators.project_report_url),
            aadhar_number = coalesce(${aadharNumber || null}, student_innovators.aadhar_number),
            pan_number = coalesce(${panNumber || null}, student_innovators.pan_number),
            city = ${city},
            state = ${state},
            country = ${country},
            linkedin_url = ${linkedinUrl},
            photo_url = coalesce(${storedLeaderPhoto}, student_innovators.photo_url),
            updated_at = now()
          returning id
        `;
        const studentInnovatorId = innovator?.id || null;

        await sql`delete from student_team_members where leader_user_id = ${userId}`;
        for (const m of members) {
          if (m?.name && m?.email) {
            const memberEmail = m.email.toLowerCase().trim();
            const memberAuthSub = `dev|${memberEmail}`;
            const [memberUser] = await sql`
              insert into user_accounts (
                auth_subject, email, full_name, mobile_e164, status,
                category, team_name, domain, city, state, country, photo_url
              )
              values (
                ${memberAuthSub}, ${memberEmail}, ${m.name}, ${m.phone || null}, 'active',
                'student_innovator', ${teamName}, ${domain}, ${city}, ${state}, ${country}, ${m.photoUrl || null}
              )
              on conflict (lower(email)) where email is not null do update
              set full_name = ${m.name},
                  mobile_e164 = coalesce(${m.phone || null}, user_accounts.mobile_e164),
                  category = 'student_innovator',
                  team_name = ${teamName},
                  domain = ${domain},
                  photo_url = coalesce(${m.photoUrl || null}, user_accounts.photo_url),
                  updated_at = now()
              returning id
            `;
            const memberUserId = memberUser?.id || null;
            if (memberUserId) {
              await sql`
                insert into role_grants (user_id, role, edition_id)
                values (${memberUserId}, 'startup_team_member', 2026)
                on conflict do nothing
              `;
              await sql`
                insert into edition_access (user_id, edition_id, source)
                values (${memberUserId}, 2026, 'predefined')
                on conflict do nothing
              `;
              if (startupId) {
                await sql`
                  insert into startup_memberships (startup_id, user_id, position)
                  values (${startupId}, ${memberUserId}, 'member')
                  on conflict (startup_id, user_id) do update set position = 'member'
                `;
              }
            }

            await sql`
              insert into student_team_members (student_innovator_id, leader_user_id, user_id, team_name, name, photo_url, phone, email)
              values (
                ${studentInnovatorId},
                ${userId},
                ${memberUserId},
                ${teamName},
                ${m.name},
                ${m.photoUrl || null},
                ${m.phone},
                ${memberEmail}
              )
            `;
          }
        }
      }

      // Confirmation email via nodemailer
      const transporter = getTransporter();
      if (transporter && email) {
        try {
          const membersListHtml = members.length > 0
            ? `
              <div style="margin-top:20px;">
                <h4 style="margin:0 0 10px;color:#1e293b;font-size:14px;font-weight:700;">Registered Team Members (${members.length} / 5):</h4>
                <table style="width:100%;border-collapse:collapse;font-size:13px;color:#334155;background:#ffffff;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;">
                  <thead>
                    <tr style="background:#f1f5f9;text-align:left;">
                      <th style="padding:8px 12px;border-bottom:1px solid #e2e8f0;">#</th>
                      <th style="padding:8px 12px;border-bottom:1px solid #e2e8f0;">Photo</th>
                      <th style="padding:8px 12px;border-bottom:1px solid #e2e8f0;">Name</th>
                      <th style="padding:8px 12px;border-bottom:1px solid #e2e8f0;">Email</th>
                      <th style="padding:8px 12px;border-bottom:1px solid #e2e8f0;">Phone</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${members.map((m, i) => `
                      <tr style="border-bottom:1px solid #f1f5f9;">
                        <td style="padding:8px 12px;color:#64748b;">${i + 1}</td>
                        <td style="padding:8px 12px;">
                          ${m.photoUrl && (m.photoUrl.startsWith("http://") || m.photoUrl.startsWith("https://")) ? `<img src="${m.photoUrl}" alt="${m.name}" style="width:28px;height:28px;border-radius:50%;object-fit:cover;vertical-align:middle;" />` : "—"}
                        </td>
                        <td style="padding:8px 12px;"><strong>${m.name}</strong></td>
                        <td style="padding:8px 12px;color:#2563eb;">${m.email}</td>
                        <td style="padding:8px 12px;">${m.phone}</td>
                      </tr>
                    `).join("")}
                  </tbody>
                </table>
              </div>
            `
            : "";

          const emailSubject = isStudentInnovator
            ? `Welcome to ISF Startup Jathara 2026 - ${teamName || fullName} (Student Innovator) Registration Confirmed`
            : `Welcome to ISF Startup Jathara 2026 - ${teamName || fullName} Registration Confirmed`;

          const bannerTitle = isStudentInnovator
            ? "🎉 Student Innovator Registration Confirmed!"
            : "🎉 Startup Registration Confirmed!";

          const bannerDesc = isStudentInnovator
            ? `Dear <strong>${fullName}</strong>, your student innovation credentials, project profile, and team members have been successfully saved to the summit database.`
            : `Dear <strong>${fullName}</strong>, your startup credentials and team members have been successfully saved to the summit database.`;

          const profileTitle = isStudentInnovator
            ? "Student Innovator & Team Profile"
            : "Team Leader & Startup Profile";

          await transporter.sendMail({
            from: getSenderAddress("ISF 2026"),
            to: email,
            replyTo: "akshatrajpati@gmail.com",
            subject: emailSubject,
            html: `
              <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:580px;margin:20px auto;padding:32px;background:#ffffff;border:1px solid #e2e8f0;border-radius:16px;box-shadow:0 4px 14px rgba(0,0,0,0.06);">
                <div style="margin-bottom:16px;">
                  <span style="display:inline-block;background:#eff6ff;color:#1d4ed8;font-size:12px;font-weight:700;padding:4px 10px;border-radius:6px;text-transform:uppercase;letter-spacing:0.04em;">Dandakaranya Innovation Summit</span>
                  <h2 style="color:#1d4ed8;margin:8px 0 4px;font-size:22px;font-weight:800;">ISF · Startup Jathara 2026</h2>
                  <p style="color:#64748b;font-size:13px;margin:0;">GIET University, Gunupur, Odisha · 18–20 December 2026</p>
                </div>

                <div style="background:#ecfdf5;border:1px solid #a7f3d0;border-radius:12px;padding:16px;margin:16px 0 20px;">
                  <h3 style="color:#065f46;font-size:16px;margin:0 0 6px;">${bannerTitle}</h3>
                  <p style="color:#047857;font-size:13px;margin:0;line-height:1.4;">
                    ${bannerDesc}
                  </p>
                </div>

                <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:18px;margin:0 0 16px;font-size:13px;color:#334155;line-height:1.6;">
                  <div style="font-size:14px;font-weight:700;color:#0f172a;margin-bottom:10px;border-bottom:1px solid #e2e8f0;padding-bottom:6px;">
                    ${profileTitle}
                  </div>
                  ${storedLeaderPhoto && (storedLeaderPhoto.startsWith("http://") || storedLeaderPhoto.startsWith("https://")) ? `<div style="margin-bottom:10px;"><img src="${storedLeaderPhoto}" alt="Photo" style="width:60px;height:60px;border-radius:50%;object-fit:cover;border:2px solid #2563eb;" /></div>` : ""}
                  <div style="margin-bottom:6px;"><strong>Team Lead Name:</strong> ${fullName}</div>
                  <div style="margin-bottom:6px;"><strong>${isStudentInnovator ? "Project / Team:" : "Startup / Team:"}</strong> ${teamName || "N/A"}</div>
                  <div style="margin-bottom:6px;"><strong>Registered Email:</strong> ${email}</div>
                  <div style="margin-bottom:6px;"><strong>Primary Phone:</strong> ${mobile || "N/A"}</div>
                  ${altMobile ? `<div style="margin-bottom:6px;"><strong>Alternate Phone:</strong> ${altMobile}</div>` : ""}
                  ${domain ? `<div style="margin-bottom:6px;"><strong>Domain / Sector:</strong> ${domain}</div>` : ""}
                  <div style="margin-bottom:6px;"><strong>Location:</strong> ${[city, state, country].filter(Boolean).join(", ")}</div>
                  ${linkedinUrl ? `<div style="margin-bottom:6px;"><strong>LinkedIn:</strong> <a href="${linkedinUrl}" target="_blank" style="color:#2563eb;text-decoration:none;">${linkedinUrl}</a></div>` : ""}
                  ${aadharNumber ? `<div style="margin-bottom:6px;"><strong>Aadhaar Number:</strong> ${aadharNumber.replace(/(\d{4})(?=\d)/g, "$1 ")}</div>` : ""}
                  ${panNumber ? `<div style="margin-bottom:6px;"><strong>PAN Number:</strong> ${panNumber}</div>` : ""}
                  ${storedProjectReport ? `<div style="margin-bottom:6px;"><strong>Project Report Document:</strong> <a href="${storedProjectReport}" target="_blank" style="color:#2563eb;font-weight:600;text-decoration:underline;">View Uploaded Report Document ↗</a></div>` : ""}
                  ${projectDetails ? `
                    <div style="margin-top:12px;padding-top:10px;border-top:1px dashed #cbd5e1;">
                      <div style="font-weight:700;color:#0f172a;margin-bottom:4px;">Project / Venture Summary:</div>
                      <p style="margin:0;color:#475569;font-size:12.5px;line-height:1.6;white-space:pre-wrap;">${projectDetails}</p>
                    </div>
                  ` : ""}
                </div>

                ${membersListHtml}

                <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:12px;padding:16px;margin:20px 0;text-align:center;">
                  <p style="color:#166534;font-size:14px;margin:0;font-weight:600;">
                    Your registration has been successfully received. The ISF Committee will contact you with further summit schedule details.
                  </p>
                </div>

                <p style="color:#94a3b8;font-size:11px;margin:0;border-top:1px solid #f1f5f9;padding-top:14px;text-align:center;">
                  Startup Jathara 2026 · Organised by International Startup Foundation (ISF) & GIET University.
                </p>
              </div>
            `,
          });
        } catch (e) {
          console.error("[REGISTRATION EMAIL ERROR]", e);
        }
      }

      return Response.json({
        ok: true,
        user: {
          id: userId,
          email,
          fullName,
          roles: [role],
          category,
          teamName,
          photoUrl: storedLeaderPhoto,
          domain,
          projectDetails,
          projectReportUrl: storedProjectReport,
          aadharNumber,
          panNumber,
          membersCount: members.length,
        },
        message: "Registration successful! Your application has been recorded in the summit database.",
      });
    } catch (err: any) {
      console.error("[REGISTRATION ERROR]", err);
      const rawMessage = String(err?.message || err || "Registration failed due to a server error.");
      let message = rawMessage;

      if (rawMessage.includes("ENOTFOUND") && rawMessage.includes("db.")) {
        message =
          "Database connection error: Direct Supabase hostname (IPv6) cannot be reached in serverless. Please set DATABASE_URL in Vercel to: postgresql://postgres.ddrremsyzozutyxbxigf:[PASSWORD]@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres?sslmode=require";
      } else if (rawMessage.includes("password authentication failed")) {
        message =
          "Database password incorrect: Please verify your Supabase database password in Vercel's DATABASE_URL.";
      } else if (rawMessage.includes("tenant") && rawMessage.includes("not found")) {
        message =
          "Database pooler error: Tenant not found in that region. Please set DATABASE_URL to use aws-0-ap-southeast-1.pooler.supabase.com:6543.";
      }

      return Response.json(
        { message, detail: rawMessage },
        { status: 500 }
      );
    }
  }

  return Response.json({ error: "Endpoint not found" }, { status: 404 });
}

export { handleRequest as GET, handleRequest as POST, handleRequest as OPTIONS };
