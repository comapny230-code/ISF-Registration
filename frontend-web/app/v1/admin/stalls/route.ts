import { requireAdmin } from "@/lib/auth/guards";
import { EDITION_ID } from "@/lib/auth/leader";
import { assertSameOriginJson, handler, HttpError, json, readJsonObject } from "@/lib/http";

export const dynamic = "force-dynamic";

export const POST = handler(async (request, { requestId }) => {
  assertSameOriginJson(request);
  const { sql } = await requireAdmin(request, "inventory.manage");

  const raw = await readJsonObject(request);
  const zone = typeof raw.zone === "string" ? raw.zone.trim().toUpperCase() : "";
  if (zone !== "PG" && zone !== "BB") {
    throw new HttpError(400, "VALIDATION", "zone must be PG or BB.");
  }

  const code = typeof raw.code === "string" ? raw.code.trim().toUpperCase() : "";
  if (!/^[A-Z]{2}-[A-Z][0-9]{2}$/.test(code)) {
    throw new HttpError(400, "VALIDATION", "code must match format PG-A01 or BB-B02.");
  }

  const width = typeof raw.width === "number" ? raw.width : 10;
  const depth = typeof raw.depth === "number" ? raw.depth : 10;
  const x = typeof raw.x === "number" ? raw.x : 0;
  const y = typeof raw.y === "number" ? raw.y : 0;
  const rotation = typeof raw.rotation === "number" ? raw.rotation : 0;

  const [zoneRow] = await sql`
    select id from booking.zones where code = ${zone} and edition_id = ${EDITION_ID}`;
  if (!zoneRow) throw new HttpError(404, "ZONE_NOT_FOUND", `Zone ${zone} was not found.`);

  const [existing] = await sql`
    select id from booking.stalls where code = ${code} and edition_id = ${EDITION_ID}`;
  if (existing) throw new HttpError(409, "STALL_EXISTS", `A stall with code ${code} already exists.`);

  const [newStall] = await sql`
    insert into booking.stalls (edition_id, zone_id, code, width_ft, depth_ft, x_ft, y_ft, rotation_deg, inventory_status, source_ref)
    values (${EDITION_ID}, ${zoneRow.id}, ${code}, ${width}, ${depth}, ${x}, ${y}, ${rotation}, 'approved', 'admin')
    returning id, code, width_ft, depth_ft, x_ft, y_ft, rotation_deg, inventory_status, admin_status`;

  return json({
    ok: true,
    stall: {
      id: newStall.id,
      code: newStall.code,
      zone,
      width: Number(newStall.width_ft),
      depth: Number(newStall.depth_ft),
      x: Number(newStall.x_ft),
      y: Number(newStall.y_ft),
      rotation: Number(newStall.rotation_deg),
      status: "available",
    },
  }, 201, requestId);
});
