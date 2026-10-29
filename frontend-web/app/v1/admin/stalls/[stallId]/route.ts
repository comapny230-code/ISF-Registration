import { requireAdmin } from "@/lib/auth/guards";
import { EDITION_ID } from "@/lib/auth/leader";
import { assertSameOriginJson, handler, HttpError, json, readJsonObject, v } from "@/lib/http";

export const dynamic = "force-dynamic";

export const PATCH = handler<{ stallId: string }>(async (request, { requestId, params }) => {
  assertSameOriginJson(request);
  const { sql } = await requireAdmin(request, "inventory.manage");
  const stallId = v.uuid(params.stallId, "stallId");

  const raw = await readJsonObject(request);
  const code = typeof raw.code === "string" ? raw.code.trim().toUpperCase() : null;
  const width = typeof raw.width === "number" ? raw.width : null;
  const depth = typeof raw.depth === "number" ? raw.depth : null;
  const x = typeof raw.x === "number" ? raw.x : null;
  const y = typeof raw.y === "number" ? raw.y : null;
  const rotation = typeof raw.rotation === "number" ? raw.rotation : null;

  const [existing] = await sql`
    select id, code from booking.stalls where id = ${stallId} and edition_id = ${EDITION_ID}`;
  if (!existing) throw new HttpError(404, "STALL_NOT_FOUND", "Stall not found.");

  if (code && code !== existing.code) {
    const [conflict] = await sql`
      select id from booking.stalls where code = ${code} and edition_id = ${EDITION_ID} and id <> ${stallId}`;
    if (conflict) throw new HttpError(409, "STALL_CODE_TAKEN", `Stall code ${code} is already in use.`);
  }

  const [updated] = await sql`
    update booking.stalls
       set code = coalesce(${code}, code),
           width_ft = coalesce(${width}, width_ft),
           depth_ft = coalesce(${depth}, depth_ft),
           x_ft = coalesce(${x}, x_ft),
           y_ft = coalesce(${y}, y_ft),
           rotation_deg = coalesce(${rotation}, rotation_deg),
           updated_at = now()
     where id = ${stallId} and edition_id = ${EDITION_ID}
    returning id, code, width_ft, depth_ft, x_ft, y_ft, rotation_deg`;

  return json({ ok: true, stall: updated }, 200, requestId);
});

export const DELETE = handler<{ stallId: string }>(async (request, { requestId, params }) => {
  assertSameOriginJson(request);
  const { sql } = await requireAdmin(request, "inventory.manage");
  const stallId = v.uuid(params.stallId, "stallId");

  const [hasBooking] = await sql`
    select id from booking.reservations where stall_id = ${stallId} and status = 'confirmed'`;
  if (hasBooking) {
    throw new HttpError(409, "STALL_HAS_BOOKING", "Cannot delete a stall with an active confirmed booking. Cancel the booking first.");
  }

  // Remove any stale holds
  await sql`delete from booking.reservations where stall_id = ${stallId} and status in ('held', 'released', 'expired')`;

  // Retire / delete stall
  await sql`
    update booking.stalls
       set inventory_status = 'retired', updated_at = now()
     where id = ${stallId} and edition_id = ${EDITION_ID}`;

  return json({ ok: true, message: "Stall removed from active inventory." }, 200, requestId);
});
