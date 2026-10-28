import { requireAdmin } from "@/lib/auth/guards";
import { consumeRateLimit, LIMITS } from "@/lib/auth/rate-limit";
import { setStallAvailability } from "@/lib/booking/admin";
import { assertSameOriginJson, handler, json, readJsonObject, strict, v } from "@/lib/http";

export const dynamic = "force-dynamic";

/** E12: enable or disable a stall (inventory.manage + recent sign-in code). Idempotent per target state. */
export const POST = handler<{ stallId: string }>(async (request, { requestId, params }) => {
  assertSameOriginJson(request);
  const { sql, session } = await requireAdmin(request, "inventory.manage", { stepUp: true });
  const stallId = v.uuid(params.stallId, "stallId");
  const body = strict(await readJsonObject(request), {
    action: v.oneOf("disable", "enable"),
    reason: v.reason,
    force: v.optionalBoolean,
    requestId: v.uuid,
  });
  await consumeRateLimit(sql, LIMITS.adminWritePerAdmin, session.principalId);

  const result = await setStallAvailability(session.principalId, stallId, body.action, body.reason, body.force, requestId);
  return json(result, 200, requestId);
});
