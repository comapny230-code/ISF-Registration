/**
 * Booking confirmation email to the team's registered address. Besides giving the leader
 * a record, it tells the real owner of an address about any booking made under it (a team
 * signed in straight after registration has not proved it controls the address).
 */
import type postgres from "postgres";
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
