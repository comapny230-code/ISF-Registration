import { requireAdmin } from "@/lib/auth/guards";
import { assertSameOriginJson, handler, json, readJsonObject, v } from "@/lib/http";
import { deleteRegistration, editRegistration, parseRegistrationEdit } from "@/lib/registration/admin";

export const dynamic = "force-dynamic";

/** Edit a registration's leader details (teams.manage). The account and booking team follow. */
export const PATCH = handler<{ id: string }>(async (request, { requestId, params }) => {
  assertSameOriginJson(request);
  const { sql } = await requireAdmin(request, "teams.manage");
  const id = v.uuid(params.id, "id");
  const edit = parseRegistrationEdit(await readJsonObject(request));
  const updated = await editRegistration(sql, id, edit);
  return json({ ok: true, message: `Updated team "${updated.teamName}".` }, 200, requestId);
});

/** Delete a registration without booking history (teams.manage). */
export const DELETE = handler<{ id: string }>(async (request, { requestId, params }) => {
  assertSameOriginJson(request);
  const { sql } = await requireAdmin(request, "teams.manage");
  const id = v.uuid(params.id, "id");
  const result = await deleteRegistration(sql, id);
  const label = result.track === "senior" ? "Startup registration" : "Student innovator registration";
  return json({ ok: true, message: `${label} deleted.` }, 200, requestId);
});
