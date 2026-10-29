import { getSession } from "@/lib/auth/session";
import { consumePoll } from "@/lib/booking/poll-limit";
import { stallSnapshot, viewerTeamId } from "@/lib/booking/snapshot";
import { EDITION_ID } from "@/lib/auth/leader";
import { getDb } from "@/lib/db";
import { clientAddress, handler, HttpError, json } from "@/lib/http";

export const dynamic = "force-dynamic";

/**
 * E5: live stall status. Leaders and admins only, unless the organisers enable a
 * public map. Never cached (expiry changes status without any write), and the
 * holder's private fields (holdId, expiry) are only returned to that team.
 */
export const GET = handler(async (request, { requestId }) => {
  const sql = await getDb();
  const leader = await getSession(sql, request, "leader");
  const admin = leader ? null : await getSession(sql, request, "admin");

  if (!leader && !admin) {
    const [settings] = await sql`select public_map from booking.settings where edition_id = ${EDITION_ID}`.catch(() => [null]);
    if (settings && settings.public_map === false) {
      throw new HttpError(401, "UNAUTHENTICATED", "Please sign in to continue.");
    }
  }
  consumePoll(leader?.id ?? admin?.id ?? `ip:${clientAddress(request)}`);

  const zone = new URL(request.url).searchParams.get("zone");
  if (zone !== null && !/^[A-Z]{2}$/.test(zone)) throw new HttpError(400, "VALIDATION", "zone must be a two-letter zone code.");

  const teamId = leader ? await viewerTeamId(sql, leader.principalId) : null;
  const snapshot = await stallSnapshot(sql, teamId, zone ?? undefined);
  return json(snapshot, 200, requestId, { Vary: "Cookie" });
});
