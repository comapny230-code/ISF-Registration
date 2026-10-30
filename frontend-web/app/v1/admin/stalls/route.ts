import { requireAdmin } from "@/lib/auth/guards";
import { createStall, parseStallInput } from "@/lib/booking/admin";
import { assertSameOriginJson, handler, json, readJsonObject } from "@/lib/http";

export const dynamic = "force-dynamic";

/** Add a stall to an existing zone (inventory.manage). Audited as inventory_changed. */
export const POST = handler(async (request, { requestId }) => {
  assertSameOriginJson(request);
  const { session } = await requireAdmin(request, "inventory.manage");
  const input = parseStallInput(await readJsonObject(request));
  const stall = await createStall(session.principalId, input, requestId);
  return json({ ok: true, stall: { ...stall, status: stall.adminStatus === "active" ? "available" : "unavailable" } }, 201, requestId);
});
