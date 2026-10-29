/** The booking ticket PDF: well-formed file structure, the right content, safe text. */
import { describe, expect, it } from "vitest";
import { HttpError } from "@/lib/http";
import { buildTicketPdf, loadTicket, pdfSafeText, type TicketData } from "@/lib/booking/ticket";

const ticket: TicketData = {
  bookingRef: "SJ26-ABCD2345",
  stallCode: "PG-A07",
  zoneName: "Playground – GIET University",
  stallSize: "10 x 10 ft",
  teamName: "Team (Alpha) \\ Beta",
  track: "senior",
  leaderName: "Asha Demo",
  confirmedAt: new Date("2026-11-20T05:30:00Z"),
};

const latin1 = (bytes: Uint8Array) => Buffer.from(bytes).toString("latin1");

describe("ticket PDF", () => {
  it("is a complete PDF whose cross-reference offsets point at each object", () => {
    const pdf = latin1(buildTicketPdf(ticket));
    expect(pdf.startsWith("%PDF-1.4\n")).toBe(true);
    expect(pdf.trimEnd().endsWith("%%EOF")).toBe(true);

    const startxref = Number(/startxref\n(\d+)\n%%EOF/.exec(pdf)![1]);
    expect(pdf.slice(startxref, startxref + 4)).toBe("xref");
    const entries = [...pdf.slice(startxref).matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]));
    expect(entries).toHaveLength(7);
    entries.forEach((offset, i) => expect(pdf.slice(offset, offset + `${i + 1} 0 obj`.length)).toBe(`${i + 1} 0 obj`));

    const length = Number(/\/Length (\d+) >>\nstream\n/.exec(pdf)![1]);
    const start = pdf.indexOf("stream\n") + "stream\n".length;
    expect(pdf.slice(start + length, start + length + "\nendstream".length)).toBe("\nendstream");
  });

  it("prints the stall number, reference, team and the arrangements contact", () => {
    const pdf = latin1(buildTicketPdf(ticket));
    expect(pdf).toContain("(PG-A07) Tj");
    expect(pdf).toContain("(SJ26-ABCD2345) Tj");
    expect(pdf).toContain("(Playground - GIET University) Tj");
    expect(pdf).toContain("(Please contact Mr Ravi for arrangements.) Tj");
    expect(pdf).toContain("(Contact number: 9437432282) Tj");
    // Parentheses and backslashes in submitted names are escaped, not interpreted.
    expect(pdf).toContain("(Team \\(Alpha\\) \\\\ Beta) Tj");
  });

  it("folds typographic punctuation and replaces characters the standard fonts cannot draw", () => {
    expect(pdfSafeText("A – B — “C” ‘d’ …")).toBe("A - B - \"C\" 'd' ...");
    expect(pdfSafeText("Café ✓ 日本\n")).toBe("Café ? ?? ");
  });
});

/** A stand-in for the query function that answers each query with the next canned result. */
function fakeSql(results: unknown[][]) {
  const queue = [...results];
  return (async () => queue.shift() ?? []) as any;
}

describe("ticket lookup", () => {
  const leader = [{ track: "senior", id: "leader-row", team_name: "Team" }];
  const booking = (stallCode: unknown) => [
    {
      booking_ref: "SJ26-ABCD2345", confirmed_at: new Date(), stall_code: stallCode, width_ft: "10.00", depth_ft: "10.00",
      zone_name: "Playground", team_name_snapshot: "Team", track: "senior", full_name: "Leader",
    },
  ];

  it.each([[""], [null], ["A1"], ["pg-a01"]])("reports a missing or malformed stall number (%j) instead of printing one", async (code) => {
    const err = await loadTicket(fakeSql([leader, booking(code)]), "user").catch((e) => e);
    expect(err).toBeInstanceOf(HttpError);
    expect(err).toMatchObject({ status: 409, code: "STALL_CODE_MISSING" });
  });

  it("returns the stall number exactly as stored", async () => {
    const t = await loadTicket(fakeSql([leader, booking("BB-B07")]), "user");
    expect(t).toMatchObject({ stallCode: "BB-B07", stallSize: "10 x 10 ft", bookingRef: "SJ26-ABCD2345" });
  });

  it("refuses non-leaders and leaders without a confirmed booking", async () => {
    await expect(loadTicket(fakeSql([[]]), "user")).rejects.toMatchObject({ status: 403, code: "NOT_TEAM_LEADER" });
    await expect(loadTicket(fakeSql([leader, []]), "user")).rejects.toMatchObject({ status: 404, code: "NO_BOOKING" });
  });
});
