import { adminPermissions } from "@/lib/auth/guards";
import { describeLeaderTeam } from "@/lib/auth/leader";
import { getSession } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { handler, json } from "@/lib/http";

export const dynamic = "force-dynamic";

/** Reports the caller's leader and admin sessions (each may be null). Read-only. */
export const GET = handler(async (request, { requestId }) => {
  const sql = await getDb();
  const [leader, admin] = [await getSession(sql, request, "leader"), await getSession(sql, request, "admin")];

  return json(
    {
      leader: leader && {
        displayName: leader.displayName,
        sessionExpiresAt: leader.absoluteExpiresAt,
        ...(await describeLeaderTeam(sql, leader.principalId)),
      },
      admin: admin && {
        displayName: admin.displayName,
        sessionExpiresAt: admin.absoluteExpiresAt,
        permissions: await adminPermissions(sql, admin.principalId),
        reauthFresh: admin.reauthFresh,
      },
    },
    200,
    requestId
  );
});
