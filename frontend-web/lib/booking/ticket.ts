/**
 * Booking ticket (PDF) for the signed-in leader's own confirmed booking.
 *
 * The team is resolved from the session's leader registration, exactly as for the
 * booking endpoints; the request carries no booking, team or stall identifiers, so
 * there is nothing a caller can change to reach another team's ticket.
 */
import type postgres from "postgres";
import { EDITION_ID, resolveLeader } from "../auth/leader";
import { HttpError } from "../http";
import { ARRANGEMENTS_CONTACT } from "./contact";

export interface TicketData {
  bookingRef: string;
  stallCode: string;
  zoneName: string;
  stallSize: string;
  teamName: string;
  track: "senior" | "junior";
  leaderName: string;
  confirmedAt: Date;
}

const STALL_CODE = /^[A-Z]{2}-[A-Z][0-9]{2}$/;

export async function loadTicket(sql: postgres.ISql, userId: string): Promise<TicketData> {
  const resolution = await resolveLeader(sql, userId);
  if (resolution.kind === "not_leader") throw new HttpError(403, "NOT_TEAM_LEADER", "Only the registered team leader can do this.");
  if (resolution.kind === "ambiguous") {
    throw new HttpError(409, "TEAM_AMBIGUOUS", "This account is registered as a leader in more than one track. Please contact the organisers.");
  }

  const [row] = await sql`
    select r.booking_ref, r.confirmed_at, st.code as stall_code, st.width_ft, st.depth_ft, z.name as zone_name,
           t.team_name_snapshot, t.track, u.full_name
      from booking.teams t
      join booking.reservations r on r.team_id = t.id and r.status = 'confirmed'
      join booking.stalls st on st.id = r.stall_id
      join booking.zones z on z.id = st.zone_id
      join public.user_accounts u on u.id = t.leader_user_id
     where t.edition_id = ${EDITION_ID} and t.leader_user_id = ${userId}`;
  if (!row) throw new HttpError(404, "NO_BOOKING", "Your team has no confirmed stall booking.");

  // Never print a ticket with a stall number the database does not actually hold.
  if (typeof row.stall_code !== "string" || !STALL_CODE.test(row.stall_code)) {
    console.error("[TICKET] stall code missing or malformed for a confirmed booking", { bookingRef: row.booking_ref });
    throw new HttpError(409, "STALL_CODE_MISSING", "This booking's stall number could not be found. Please contact the organisers.");
  }

  return {
    bookingRef: row.booking_ref,
    stallCode: row.stall_code,
    zoneName: row.zone_name,
    stallSize: `${Number(row.width_ft)} x ${Number(row.depth_ft)} ft`,
    teamName: row.team_name_snapshot,
    track: row.track,
    leaderName: row.full_name ?? "",
    confirmedAt: row.confirmed_at,
  };
}

// ---------------------------------------------------------------------------
// Minimal PDF writer: one A4 page, the standard Helvetica fonts, WinAnsi text.
// ---------------------------------------------------------------------------

const IST = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" });

/** Text the standard fonts can draw: typographic punctuation folded to ASCII, anything else outside Latin-1 replaced. */
export function pdfSafeText(value: string): string {
  return value
    .replace(/[–—−]/g, "-")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/…/g, "...")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/[^ -ÿ]/g, "?");
}

function pdfString(value: string): string {
  return `(${pdfSafeText(value).replace(/[\\()]/g, (c) => `\\${c}`)})`;
}

/** Shortens a value so it fits a line of the ticket. */
function fit(value: string, max: number): string {
  const v = value.trim();
  return v.length > max ? `${v.slice(0, max - 3)}...` : v;
}

export function buildTicketPdf(t: TicketData): Uint8Array {
  const ops: string[] = [];
  const fill = (r: number, g: number, b: number) => ops.push(`${r} ${g} ${b} rg`);
  const rect = (x: number, y: number, w: number, h: number) => ops.push(`${x} ${y} ${w} ${h} re f`);
  const text = (font: "F1" | "F2", size: number, x: number, y: number, value: string) =>
    ops.push(`BT /${font} ${size} Tf ${x} ${y} Td ${pdfString(value)} Tj ET`);

  // Header band.
  fill(0.078, 0.243, 0.188);
  rect(0, 712, 595, 130);
  fill(1, 1, 1);
  text("F2", 26, 48, 784, "ISF Startup Jathara 2026");
  fill(0.969, 0.784, 0.624);
  text("F1", 13, 48, 760, "Dandakaranya 2026 - GIET University, Gunupur, Odisha");
  fill(1, 1, 1);
  text("F2", 15, 48, 732, "Stall booking ticket");

  // Stall number, the largest thing on the page.
  fill(0.34, 0.33, 0.31);
  text("F1", 12, 48, 668, "Stall");
  fill(0.078, 0.243, 0.188);
  text("F2", 54, 48, 616, t.stallCode);
  fill(0.34, 0.33, 0.31);
  text("F1", 12, 330, 668, "Booking reference");
  fill(0.761, 0.314, 0.133);
  text("F2", 22, 330, 640, t.bookingRef);

  // Details.
  const rows: Array<[string, string]> = [
    ["Area", fit(t.zoneName, 60)],
    ["Stall size", t.stallSize],
    ["Team", fit(t.teamName, 60)],
    ["Track", t.track === "senior" ? "Senior track" : "Junior track"],
    ["Team leader", fit(t.leaderName, 60)],
    ["Confirmed", `${IST.format(t.confirmedAt)} IST`],
  ];
  fill(0.89, 0.86, 0.81);
  rect(48, 588, 499, 1);
  let y = 560;
  for (const [label, value] of rows) {
    fill(0.34, 0.33, 0.31);
    text("F1", 11, 48, y, label);
    fill(0.11, 0.1, 0.09);
    text("F2", 13, 170, y, value);
    y -= 30;
  }

  // Contact for arrangements.
  fill(0.98, 0.933, 0.91);
  rect(48, 300, 499, 74);
  fill(0.761, 0.314, 0.133);
  rect(48, 300, 5, 74);
  fill(0.11, 0.1, 0.09);
  text("F2", 13, 68, 350, `Please contact ${ARRANGEMENTS_CONTACT.name} for arrangements.`);
  text("F1", 13, 68, 324, `Contact number: ${ARRANGEMENTS_CONTACT.phone}`);

  fill(0.34, 0.33, 0.31);
  text("F1", 10, 48, 268, "Show this ticket at the venue. Your team can book one stall; only the organisers can change or cancel it.");

  const content = ops.join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>",
    `<< /Length ${Buffer.byteLength(content, "latin1")} >>\nstream\n${content}\nendstream`,
    `<< /Title ${pdfString(`Stall ${t.stallCode} - ${t.bookingRef}`)} /Producer (ISF Startup Jathara) >>`,
  ];

  let pdf = "%PDF-1.4\n%âãÏÓ\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(pdf, "latin1"));
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf, "latin1");
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info ${objects.length} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(pdf, "latin1"));
}
