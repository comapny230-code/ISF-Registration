import { adminPermissions } from "@/lib/auth/guards";
import { describeLeaderTeam } from "@/lib/auth/leader";
import { getSession } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { handler, json } from "@/lib/http";

export const dynamic = "force-dynamic";

/** Reports the caller's leader and admin sessions (each may be null). Read-only. */
export const GET = handler(async (request, { requestId }) => {
  let leader: any = null;
  let admin: any = null;

  try {
    const sql = await getDb();
    [leader, admin] = await Promise.all([
      getSession(sql, request, "leader").catch(() => null),
      getSession(sql, request, "admin").catch(() => null),
    ]);

    return json(
      {
        leader: leader && {
          displayName: leader.displayName,
          sessionExpiresAt: leader.absoluteExpiresAt,
          ...(await describeLeaderTeam(sql, leader.principalId).catch(() => ({}))),
        },
        admin: admin && {
          displayName: admin.displayName,
          sessionExpiresAt: admin.absoluteExpiresAt,
          permissions: await adminPermissions(sql, admin.principalId).catch(() => []),
          reauthFresh: admin.reauthFresh,
        },
      },
      200,
      requestId
    );
  } catch (err) {
    console.warn("[session] DB unavailable for session check:", (err as any)?.message);
    return json({ leader: null, admin: null }, 200, requestId);
  }
});
