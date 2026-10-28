import { requireAdmin } from "@/lib/auth/guards";
import { listBookings } from "@/lib/booking/admin";
import { handler, json, listQuery, q } from "@/lib/http";

export const dynamic = "force-dynamic";

/** E10: confirmed and cancelled bookings with leader contact details (never Aadhaar/PAN). */
export const GET = handler(async (request, { requestId }) => {
  const { sql } = await requireAdmin(request, ["reports.view", "booking.cancel"]);
  const query = listQuery(request, { status: q.oneOfOrNull("confirmed", "cancelled"), zone: q.zoneOrNull }, 100);
  return json(await listBookings(sql, query), 200, requestId);
});
