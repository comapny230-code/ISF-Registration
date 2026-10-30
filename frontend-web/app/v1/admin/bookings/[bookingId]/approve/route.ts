import { requireAdmin } from "@/lib/auth/guards";
import { consumeRateLimit, LIMITS } from "@/lib/auth/rate-limit";
import { sendBookingApprovalEmail } from "@/lib/booking/booking-email";
import { assertSameOriginJson, handler, json, v } from "@/lib/http";

export const dynamic = "force-dynamic";

/** Admin approves or re-sends official stall booking confirmation pass to the team leader */
export const POST = handler<{ bookingId: string }>(async (request, { requestId, params }) => {
  assertSameOriginJson(request);
  const { sql, session } = await requireAdmin(request, ["reports.view", "booking.cancel"]);
  const bookingId = v.uuid(params.bookingId, "bookingId");
  await consumeRateLimit(sql, LIMITS.adminWritePerAdmin, session.principalId);

  const sent = await sendBookingApprovalEmail(sql, bookingId);
  return json(
    {
      ok: true,
      sent,
      message: sent
        ? "Stall booking pass and confirmation email successfully sent to the team leader."
        : "Booking record was not found or has no valid leader email.",
    },
    200,
    requestId
  );
});
