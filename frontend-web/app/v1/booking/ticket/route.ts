import { requireLeader } from "@/lib/auth/guards";
import { consumeRateLimit, LIMITS } from "@/lib/auth/rate-limit";
import { buildTicketPdf, loadTicket } from "@/lib/booking/ticket";
import { handler } from "@/lib/http";

export const dynamic = "force-dynamic";

/**
 * The signed-in leader's own booking ticket as a PDF download. The team comes from
 * the session (§3.3); nothing in the request selects a booking.
 */
export const GET = handler(async (request, { requestId }) => {
  const { sql, session } = await requireLeader(request);
  await consumeRateLimit(sql, LIMITS.ticketPerUser, session.principalId);
  const ticket = await loadTicket(sql, session.principalId);

  return new Response(Buffer.from(buildTicketPdf(ticket)), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="startup-jathara-stall-${ticket.stallCode}-${ticket.bookingRef}.pdf"`,
      "Cache-Control": "private, no-store",
      Vary: "Cookie",
      "X-Request-Id": requestId,
    },
  });
});
