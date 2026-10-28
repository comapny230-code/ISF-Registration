import { requireLeader } from "@/lib/auth/guards";
import { consumeRateLimit, LIMITS } from "@/lib/auth/rate-limit";
import { releaseHold } from "@/lib/booking/service";
import { assertSameOriginJson, handler, json, readJsonObject, strict, v } from "@/lib/http";

export const dynamic = "force-dynamic";

/** E9: release the team's own hold (idempotent). */
export const DELETE = handler<{ holdId: string }>(async (request, { requestId, params }) => {
  assertSameOriginJson(request);
  const { sql, session } = await requireLeader(request);
  const holdId = v.uuid(params.holdId, "holdId");
  strict(await readJsonObject(request), {});
  await consumeRateLimit(sql, LIMITS.releasePerUser, session.principalId);

  return json(await releaseHold(session.principalId, holdId, requestId), 200, requestId);
});
