import { requireAdmin } from "@/lib/auth/guards";
import { listAudit } from "@/lib/booking/admin";
import { handler, json, listQuery, q } from "@/lib/http";

export const dynamic = "force-dynamic";

/** E15: the append-only audit trail, newest first. */
export const GET = handler(async (request, { requestId }) => {
  const { sql } = await requireAdmin(request, "reports.view");
  const query = listQuery(
    request,
    { reservationId: q.uuidOrNull, stallId: q.uuidOrNull, teamId: q.uuidOrNull },
    200
  );
  return json(await listAudit(sql, query), 200, requestId);
});
