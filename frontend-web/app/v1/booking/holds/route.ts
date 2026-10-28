import { requireLeader } from "@/lib/auth/guards";
import { consumeRateLimit, LIMITS } from "@/lib/auth/rate-limit";
import { createHold } from "@/lib/booking/service";
import { assertSameOriginJson, handler, json, readJsonObject, strict, v } from "@/lib/http";

export const dynamic = "force-dynamic";

/** E7: place (or idempotently re-read) the team's five-minute hold on a stall. */
export const POST = handler(async (request, { requestId }) => {
  assertSameOriginJson(request);
  const { sql, session } = await requireLeader(request);
  const { stallId } = strict(await readJsonObject(request), { stallId: v.uuid });
  await consumeRateLimit(sql, LIMITS.holdPerUser, session.principalId);

  const { created, hold } = await createHold(session.principalId, stallId, requestId);
  return json(hold, created ? 201 : 200, requestId);
});
