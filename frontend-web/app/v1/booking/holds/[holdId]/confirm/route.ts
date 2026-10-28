import { requireLeader } from "@/lib/auth/guards";
import { consumeRateLimit, LIMITS } from "@/lib/auth/rate-limit";
import { confirmHold } from "@/lib/booking/service";
import { HOLD_TOKEN_PATTERN } from "@/lib/booking/token";
import { assertSameOriginJson, handler, json, readJsonObject, strict, v } from "@/lib/http";

export const dynamic = "force-dynamic";

/** E8: confirm the team's hold before it expires (idempotent per hold). */
export const POST = handler<{ holdId: string }>(async (request, { requestId, params }) => {
  assertSameOriginJson(request);
  const { sql, session } = await requireLeader(request);
  const holdId = v.uuid(params.holdId, "holdId");
  const { token } = strict(await readJsonObject(request), { token: v.pattern(HOLD_TOKEN_PATTERN) });
  await consumeRateLimit(sql, LIMITS.confirmPerUser, session.principalId);

  const { created, booking } = await confirmHold(session.principalId, holdId, token, requestId);
  return json(booking, created ? 201 : 200, requestId);
});
