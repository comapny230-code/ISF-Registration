import { requireLeader } from "@/lib/auth/guards";
import { myBooking } from "@/lib/booking/snapshot";
import { handler, json } from "@/lib/http";

export const dynamic = "force-dynamic";

/** E6: the leader's team, eligibility and current hold (with its token) or booking. */
export const GET = handler(async (request, { requestId }) => {
  const { sql, session } = await requireLeader(request);
  return json(await myBooking(sql, session.principalId), 200, requestId, { Vary: "Cookie" });
});
