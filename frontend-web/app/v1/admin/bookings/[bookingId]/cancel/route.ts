import { requireAdmin } from "@/lib/auth/guards";
import { consumeRateLimit, LIMITS } from "@/lib/auth/rate-limit";
import { cancelBooking } from "@/lib/booking/admin";
import { assertSameOriginJson, handler, json, readJsonObject, strict, v } from "@/lib/http";

export const dynamic = "force-dynamic";

/** E11: cancel a confirmed booking (booking.cancel + recent sign-in code). Idempotent per requestId. */
export const POST = handler<{ bookingId: string }>(async (request, { requestId, params }) => {
  assertSameOriginJson(request);
  const { sql, session } = await requireAdmin(request, "booking.cancel", { stepUp: true });
  const bookingId = v.uuid(params.bookingId, "bookingId");
  const body = strict(await readJsonObject(request), { reason: v.reason, requestId: v.uuid });
  await consumeRateLimit(sql, LIMITS.adminWritePerAdmin, session.principalId);

  const result = await cancelBooking(session.principalId, bookingId, body.reason, body.requestId, requestId);
  return json({ bookingId: result.bookingId, status: result.status, cancelledAt: result.cancelledAt }, 200, requestId);
});
