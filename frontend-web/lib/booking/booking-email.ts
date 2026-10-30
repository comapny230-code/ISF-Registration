/**
 * Booking confirmation email to the team's registered address. Besides giving the leader
 * a record, it tells the real owner of an address about any booking made under it (a team
 * signed in straight after registration has not proved it controls the address).
 */
import type postgres from "postgres";
import { getAuthConfig } from "../config";
import { escapeHtml } from "../html";
import { sendMail } from "../mail";
import { ARRANGEMENTS_CONTACT } from "./contact";
import { loadTicket, type TicketData } from "./ticket";

const IST = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" });

export function buildBookingConfirmedEmail(t: TicketData): { subject: string; html: string } {
  const row = (label: string, value: string) =>
    `<tr><td style="padding:4px 12px 4px 0;color:#57534e;">${escapeHtml(label)}</td><td style="padding:4px 0;font-weight:700;">${escapeHtml(value)}</td></tr>`;
  return {
    subject: `Stall ${t.stallCode} booked for Startup Jathara 2026 (${t.bookingRef})`,
    html: `
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:520px;margin:20px auto;padding:28px;border:1px solid #e8dfd3;border-radius:14px;color:#1c1917;">
        <h2 style="margin:0 0 8px;font-size:20px;">Your stall is booked</h2>
        <p style="margin:0 0 16px;color:#57534e;font-size:14px;">Stall <strong>${escapeHtml(t.stallCode)}</strong> is booked for ${escapeHtml(t.teamName)}.</p>
        <table style="font-size:14px;border-collapse:collapse;margin:0 0 16px;">
          ${row("Booking reference", t.bookingRef)}
          ${row("Area", t.zoneName)}
          ${row("Stall size", t.stallSize)}
          ${row("Confirmed", `${IST.format(t.confirmedAt)} IST`)}
        </table>
        <p style="margin:0 0 6px;font-size:14px;">Please contact <strong>${escapeHtml(ARRANGEMENTS_CONTACT.name)}</strong> for arrangements. Contact number: <strong>${escapeHtml(ARRANGEMENTS_CONTACT.phone)}</strong></p>
        <p style="margin:16px 0 0;color:#57534e;font-size:13px;">You can download your ticket from the Book your stall page. If you did not make this booking, contact the organisers immediately.</p>
      </div>`,
  };
}

export async function sendBookingConfirmedEmail(sql: postgres.ISql, userId: string): Promise<void> {
  const ticket = await loadTicket(sql, userId);
  const [user] = await sql`select email from public.user_accounts where id = ${userId}`;
  if (!user?.email) return;
  await sendMail({ to: user.email, ...buildBookingConfirmedEmail(ticket) });
}

export async function sendRegistrationApprovalEmail(
  sql: postgres.ISql,
  teamId: string,
  reason?: string
): Promise<boolean> {
  const [row] = await sql`
    select t.id, t.team_name_snapshot as team_name, t.track,
           coalesce(l.full_name, s.full_name, u.full_name, 'Team Leader') as leader_name,
           coalesce(l.email, s.email, u.email) as email
      from booking.teams t
      join public.user_accounts u on u.id = t.leader_user_id
      left join public.startup_team_leaders l on l.id = t.startup_team_leader_id
      left join public.student_innovators s on s.id = t.student_innovator_id
     where t.id = ${teamId}
     limit 1`;
  if (!row?.email) return false;

  const appOrigin = getAuthConfig().allowedOrigins[0] || "http://localhost:3000";
  const loginUrl = `${appOrigin}/login?next=/book-your-stall`;
  const trackLabel = row.track === "junior" ? "Student Innovator" : "Startup Leader";

  const html = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:580px;margin:20px auto;padding:32px;background:#ffffff;border:1px solid #e2e8f0;border-radius:16px;box-shadow:0 4px 14px rgba(0,0,0,0.06);color:#1e293b;">
      <div style="margin-bottom:16px;">
        <span style="display:inline-block;background:#eff6ff;color:#1d4ed8;font-size:12px;font-weight:700;padding:4px 10px;border-radius:6px;text-transform:uppercase;letter-spacing:0.04em;">Dandakaranya Innovation Summit</span>
        <h2 style="color:#1d4ed8;margin:8px 0 4px;font-size:22px;font-weight:800;">ISF · Startup Jathara 2026</h2>
        <p style="color:#64748b;font-size:13px;margin:0;">GIET University, Gunupur, Odisha · 18–20 December 2026</p>
      </div>

      <div style="background:#f0fdf4;border:1.5px solid #86efac;border-radius:12px;padding:20px;margin:20px 0;">
        <h3 style="color:#15803d;font-size:18px;margin:0 0 8px;font-weight:800;">🎉 Team Registration Approved!</h3>
        <p style="color:#166534;font-size:14px;margin:0;line-height:1.5;">
          Dear <strong>${escapeHtml(row.leader_name)}</strong>, your team application for <strong>${escapeHtml(row.team_name)}</strong> (${trackLabel}) has been reviewed and officially <strong>APPROVED</strong> by the summit organizers.
        </p>
      </div>

      <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:20px;margin:0 0 20px;font-size:13.5px;color:#334155;line-height:1.6;">
        <h4 style="margin:0 0 10px;color:#0f172a;font-size:15px;font-weight:700;">🎪 Next Step: Book Your Exhibition Stall</h4>
        <ul style="margin:0;padding-left:20px;display:grid;gap:6px;">
          <li><strong>Allocation:</strong> Each approved team can book <strong>exactly 1 exhibition stall</strong>.</li>
          <li><strong>Stall Dimensions:</strong> 10 ft × 10 ft exhibition booth.</li>
          <li><strong>Ground Venues:</strong> Playground GIET University (PG) and Rang Manch / Basketball Ground (BB) matching the official venue layout.</li>
          <li><strong>Sign In Method:</strong> Access using your registered email (<strong>${escapeHtml(row.email)}</strong>) with a 6-digit one-time passcode (OTP).</li>
        </ul>
      </div>

      <div style="text-align:center;margin:28px 0;">
        <a href="${loginUrl}" target="_blank" style="display:inline-block;background:#2563eb;color:#ffffff;font-size:15px;font-weight:700;padding:12px 28px;border-radius:8px;text-decoration:none;box-shadow:0 2px 8px rgba(37,99,235,0.35);">
          Sign In &amp; Book Your Stall ↗
        </a>
        <div style="margin-top:10px;font-size:12px;color:#64748b;">
          Direct portal link: <a href="${loginUrl}" style="color:#2563eb;">${loginUrl}</a>
        </div>
      </div>

      ${reason ? `<p style="font-size:12px;color:#64748b;margin:16px 0 0;font-style:italic;">Committee note: ${escapeHtml(reason)}</p>` : ""}

      <p style="color:#94a3b8;font-size:11px;margin:24px 0 0;border-top:1px solid #f1f5f9;padding-top:14px;text-align:center;">
        Startup Jathara 2026 · Organised by International Startup Foundation (ISF) &amp; GIET University.
      </p>
    </div>`;

  return sendMail({
    to: row.email,
    subject: `🎉 Registration Approved! Book Your Stall - ISF Startup Jathara 2026 (${row.team_name})`,
    html,
  });
}

export async function sendBookingApprovalEmail(
  sql: postgres.ISql,
  bookingId: string
): Promise<boolean> {
  const [row] = await sql`
    select r.id, r.booking_id, r.booking_ref, r.confirmed_at,
           st.code as stall_code, st.width_ft, st.depth_ft,
           z.name as zone_name, z.code as zone_code,
           t.team_name_snapshot as team_name, t.track,
           coalesce(l.full_name, s.full_name, u.full_name, 'Team Leader') as leader_name,
           coalesce(l.email, s.email, u.email) as leader_email
      from booking.reservations r
      join booking.stalls st on st.id = r.stall_id
      join booking.zones z on z.id = st.zone_id
      join booking.teams t on t.id = r.team_id
      join public.user_accounts u on u.id = t.leader_user_id
      left join public.startup_team_leaders l on l.id = t.startup_team_leader_id
      left join public.student_innovators s on s.id = t.student_innovator_id
     where r.booking_id = ${bookingId} and r.status = 'confirmed'
     limit 1`;
  if (!row?.leader_email) return false;

  const appOrigin = getAuthConfig().allowedOrigins[0] || "http://localhost:3000";
  const ticketUrl = `${appOrigin}/book-your-stall`;

  const html = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:580px;margin:20px auto;padding:32px;background:#ffffff;border:1px solid #e2e8f0;border-radius:16px;box-shadow:0 4px 14px rgba(0,0,0,0.06);color:#1e293b;">
      <div style="margin-bottom:16px;">
        <span style="display:inline-block;background:#eff6ff;color:#1d4ed8;font-size:12px;font-weight:700;padding:4px 10px;border-radius:6px;text-transform:uppercase;letter-spacing:0.04em;">Official Stall Pass</span>
        <h2 style="color:#1d4ed8;margin:8px 0 4px;font-size:22px;font-weight:800;">ISF · Startup Jathara 2026</h2>
        <p style="color:#64748b;font-size:13px;margin:0;">GIET University, Gunupur, Odisha · 18–20 December 2026</p>
      </div>

      <div style="background:#ecfdf5;border:1.5px solid #86efac;border-radius:12px;padding:20px;margin:20px 0;">
        <h3 style="color:#065f46;font-size:18px;margin:0 0 8px;font-weight:800;">✅ Stall Booking Approved &amp; Confirmed!</h3>
        <p style="color:#047857;font-size:14px;margin:0;line-height:1.5;">
          Dear <strong>${escapeHtml(row.leader_name)}</strong>, your exhibition stall booking for team <strong>${escapeHtml(row.team_name)}</strong> has been approved and confirmed for the summit.
        </p>
      </div>

      <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:20px;margin:0 0 20px;font-size:13.5px;color:#334155;line-height:1.6;">
        <div style="font-size:15px;font-weight:700;color:#0f172a;margin-bottom:12px;border-bottom:1px solid #e2e8f0;padding-bottom:8px;">
          🎪 Stall Pass Credentials
        </div>
        <table style="width:100%;font-size:14px;border-collapse:collapse;">
          <tr><td style="padding:6px 0;color:#64748b;width:160px;">Booking Reference:</td><td style="padding:6px 0;font-weight:800;color:#1d4ed8;font-family:monospace;font-size:15px;">${escapeHtml(row.booking_ref)}</td></tr>
          <tr><td style="padding:6px 0;color:#64748b;">Assigned Stall:</td><td style="padding:6px 0;font-weight:800;font-size:16px;color:#059669;">${escapeHtml(row.stall_code)}</td></tr>
          <tr><td style="padding:6px 0;color:#64748b;">Exhibition Zone:</td><td style="padding:6px 0;font-weight:700;">${escapeHtml(row.zone_name)} (${escapeHtml(row.zone_code)})</td></tr>
          <tr><td style="padding:6px 0;color:#64748b;">Stall Dimensions:</td><td style="padding:6px 0;font-weight:600;">${row.width_ft} ft × ${row.depth_ft} ft</td></tr>
          <tr><td style="padding:6px 0;color:#64748b;">Confirmed Date:</td><td style="padding:6px 0;">${IST.format(new Date(row.confirmed_at))} IST</td></tr>
        </table>
      </div>

      <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:12px;padding:16px;margin:0 0 24px;font-size:13px;color:#92400e;line-height:1.5;">
        <strong>Logistics &amp; Stall Arrangements:</strong><br />
        Contact: <strong>${escapeHtml(ARRANGEMENTS_CONTACT.name)}</strong> · Phone: <strong>${escapeHtml(ARRANGEMENTS_CONTACT.phone)}</strong><br />
        Please retain this email or download your official PDF ticket to show at the check-in desk at GIET University.
      </div>

      <div style="text-align:center;margin:24px 0;">
        <a href="${ticketUrl}" target="_blank" style="display:inline-block;background:#059669;color:#ffffff;font-size:15px;font-weight:700;padding:12px 28px;border-radius:8px;text-decoration:none;box-shadow:0 2px 8px rgba(5,150,105,0.35);">
          View Stall Pass &amp; Download Ticket ↗
        </a>
      </div>

      <p style="color:#94a3b8;font-size:11px;margin:24px 0 0;border-top:1px solid #f1f5f9;padding-top:14px;text-align:center;">
        Startup Jathara 2026 · Organised by International Startup Foundation (ISF) &amp; GIET University.
      </p>
    </div>`;

  return sendMail({
    to: row.leader_email,
    subject: `✅ Stall Pass Approved: Stall ${row.stall_code} (${row.booking_ref}) - ISF Startup Jathara 2026`,
    html,
  });
}

