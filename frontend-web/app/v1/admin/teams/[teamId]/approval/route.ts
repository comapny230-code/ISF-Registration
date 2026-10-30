import { requireAdmin } from "@/lib/auth/guards";
import { consumeRateLimit, LIMITS } from "@/lib/auth/rate-limit";
import { setTeamApproval } from "@/lib/booking/admin";
import { sendRegistrationApprovalEmail } from "@/lib/booking/booking-email";
import { assertSameOriginJson, handler, json, readJsonObject, strict, v } from "@/lib/http";

export const dynamic = "force-dynamic";

/** E14: approve, reject or reset a team (teams.manage + recent sign-in code). Does not touch bookings. */
export const POST = handler<{ teamId: string }>(async (request, { requestId, params }) => {
  assertSameOriginJson(request);
  const { sql, session } = await requireAdmin(request, "teams.manage", { stepUp: true });
  const teamId = v.uuid(params.teamId, "teamId");
  const body = strict(await readJsonObject(request), {
    status: v.oneOf("approved", "rejected", "pending"),
    reason: v.reason,
    requestId: v.uuid,
  });
  await consumeRateLimit(sql, LIMITS.adminWritePerAdmin, session.principalId);

  const result = await setTeamApproval(session.principalId, teamId, body.status, body.reason, requestId);
  if (body.status === "approved" && result.changed) {
    try {
      await sendRegistrationApprovalEmail(sql, teamId, body.reason);
    } catch (mailErr) {
      console.error("[APPROVAL EMAIL ERROR]", mailErr);
    }
  }
  return json(result, 200, requestId);
});
