import { requireAdmin } from "@/lib/auth/guards";
import { parseStallInput, retireStall, updateStall } from "@/lib/booking/admin";
import { assertSameOriginJson, handler, json, readJsonObject, v } from "@/lib/http";

export const dynamic = "force-dynamic";

/** Change a stall's size or position (inventory.manage). Stall codes are permanent. */
export const PATCH = handler<{ stallId: string }>(async (request, { requestId, params }) => {
  assertSameOriginJson(request);
  const { session } = await requireAdmin(request, "inventory.manage");
  const stallId = v.uuid(params.stallId, "stallId");
  const input = parseStallInput(await readJsonObject(request));
  const stall = await updateStall(session.principalId, stallId, input, requestId);
  return json({ ok: true, stall }, 200, requestId);
});

/** Retire a stall (inventory.manage): refused while booked or held; reservation history is kept. */
export const DELETE = handler<{ stallId: string }>(async (request, { requestId, params }) => {
  assertSameOriginJson(request);
  const { session } = await requireAdmin(request, "inventory.manage");
  const stallId = v.uuid(params.stallId, "stallId");
  const result = await retireStall(session.principalId, stallId, requestId);
  return json({ ok: true, ...result, message: `Stall ${result.stallCode} removed from active inventory.` }, 200, requestId);
});
