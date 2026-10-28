import { requireAdmin } from "@/lib/auth/guards";
import { listTeams } from "@/lib/booking/admin";
import { handler, json, listQuery, q } from "@/lib/http";

export const dynamic = "force-dynamic";

/** E13: teams with approval status and live reservation, plus counts of leaders needing a runbook. */
export const GET = handler(async (request, { requestId }) => {
  const { sql } = await requireAdmin(request, ["teams.manage", "reports.view"]);
  const query = listQuery(
    request,
    { approval: q.oneOfOrNull("pending", "approved", "rejected"), track: q.oneOfOrNull("senior", "junior") },
    100
  );
  return json(await listTeams(sql, query), 200, requestId);
});
