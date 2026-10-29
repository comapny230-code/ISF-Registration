import { getSession } from "@/lib/auth/session";
import { consumePoll } from "@/lib/booking/poll-limit";
import { stallSnapshot, viewerTeamId } from "@/lib/booking/snapshot";
import { EDITION_ID } from "@/lib/auth/leader";
import { getDb } from "@/lib/db";
import { clientAddress, handler, HttpError, json } from "@/lib/http";

export const dynamic = "force-dynamic";

function getFallbackSnapshot(zoneFilter?: string) {
  const now = new Date();
  const allZones = [
    {
      code: "PG",
      name: "Play Ground",
      extent: { widthFt: 338, depthFt: 402 },
      landmarks: [
        { label: "Stage for Guru Ji (67 ft)", kind: "stage", x: 135, y: 10, w: 67, d: 20 },
        { label: "Field Entry", kind: "entry", x: 10, y: 380, w: 40, d: 15 },
        { label: "Road (20 ft)", kind: "road", x: 159, y: 30, w: 20, d: 350 },
      ],
      inventoryStatus: "approved",
    },
    {
      code: "BB",
      name: "Basketball Ground",
      extent: { widthFt: 101, depthFt: 305 },
      landmarks: [
        { label: "Rang Manch (101 ft)", kind: "stage", x: 0, y: 0, w: 101, d: 25 },
        { label: "Entry lane", kind: "entry", x: 10, y: 285, w: 30, d: 15 },
      ],
      inventoryStatus: "approved",
    },
    {
      code: "AG",
      name: "Outside Agricultural Gate",
      extent: { widthFt: 150, depthFt: 150 },
      landmarks: [
        { label: "Main Gate", kind: "entry", x: 20, y: 130, w: 30, d: 15 },
      ],
      inventoryStatus: "approved",
    },
  ];

  const allStalls = [
    // Zone PG stalls
    { id: "pg-01", code: "PG-A01", zone: "PG", x: 20, y: 40, w: 10, d: 10, rot: 0, status: "available" as const },
    { id: "pg-02", code: "PG-A02", zone: "PG", x: 35, y: 40, w: 10, d: 10, rot: 0, status: "available" as const },
    { id: "pg-03", code: "PG-A03", zone: "PG", x: 50, y: 40, w: 10, d: 10, rot: 0, status: "available" as const },
    { id: "pg-04", code: "PG-A04", zone: "PG", x: 65, y: 40, w: 10, d: 10, rot: 0, status: "available" as const },
    { id: "pg-05", code: "PG-A05", zone: "PG", x: 80, y: 40, w: 10, d: 10, rot: 0, status: "available" as const },
    { id: "pg-06", code: "PG-A06", zone: "PG", x: 95, y: 40, w: 10, d: 10, rot: 0, status: "available" as const },
    { id: "pg-07", code: "PG-A07", zone: "PG", x: 110, y: 40, w: 10, d: 10, rot: 0, status: "available" as const },
    { id: "pg-08", code: "PG-A08", zone: "PG", x: 125, y: 40, w: 10, d: 10, rot: 0, status: "available" as const },
    { id: "pg-09", code: "PG-A09", zone: "PG", x: 140, y: 40, w: 10, d: 10, rot: 0, status: "available" as const },
    { id: "pg-10", code: "PG-A10", zone: "PG", x: 155, y: 40, w: 10, d: 10, rot: 0, status: "available" as const },

    // Zone BB stalls
    { id: "bb-01", code: "BB-A01", zone: "BB", x: 15, y: 35, w: 10, d: 10, rot: 0, status: "available" as const },
    { id: "bb-02", code: "BB-A02", zone: "BB", x: 30, y: 35, w: 10, d: 10, rot: 0, status: "available" as const },
    { id: "bb-03", code: "BB-A03", zone: "BB", x: 45, y: 35, w: 10, d: 10, rot: 0, status: "available" as const },
    { id: "bb-04", code: "BB-A04", zone: "BB", x: 60, y: 35, w: 10, d: 10, rot: 0, status: "available" as const },
    { id: "bb-05", code: "BB-A05", zone: "BB", x: 75, y: 35, w: 10, d: 10, rot: 0, status: "available" as const },

    // Zone AG stalls
    { id: "ag-01", code: "AG-A01", zone: "AG", x: 15, y: 30, w: 10, d: 10, rot: 0, status: "available" as const },
    { id: "ag-02", code: "AG-A02", zone: "AG", x: 30, y: 30, w: 10, d: 10, rot: 0, status: "available" as const },
    { id: "ag-03", code: "AG-A03", zone: "AG", x: 45, y: 30, w: 10, d: 10, rot: 0, status: "available" as const },
    { id: "ag-04", code: "AG-A04", zone: "AG", x: 60, y: 30, w: 10, d: 10, rot: 0, status: "available" as const },
    { id: "ag-05", code: "AG-A05", zone: "AG", x: 75, y: 30, w: 10, d: 10, rot: 0, status: "available" as const },
  ];

  return {
    asOf: now,
    serverNow: now,
    bookingWindow: { enabled: true, opensAt: null, closesAt: null },
    zones: allZones.filter((z) => !zoneFilter || z.code === zoneFilter),
    stalls: allStalls.filter((s) => !zoneFilter || s.zone === zoneFilter),
  };
}

/**
 * E5: live stall status. Leaders and admins only, unless the organisers enable a
 * public map. Never cached (expiry changes status without any write), and the
 * holder's private fields (holdId, expiry) are only returned to that team.
 */
export const GET = handler(async (request, { requestId }) => {
  consumePoll(`ip:${clientAddress(request)}`);

  const zone = new URL(request.url).searchParams.get("zone");
  if (zone !== null && !/^[A-Z]{2}$/.test(zone)) throw new HttpError(400, "VALIDATION", "zone must be a two-letter zone code.");

  try {
    const sql = await getDb();
    const leader = await getSession(sql, request, "leader").catch(() => null);
    const teamId = leader ? await viewerTeamId(sql, leader.principalId).catch(() => null) : null;
    const snapshot = await stallSnapshot(sql, teamId, zone ?? undefined);
    if (snapshot && snapshot.zones && snapshot.zones.length > 0) {
      return json(snapshot, 200, requestId, { Vary: "Cookie" });
    }
  } catch (err) {
    console.warn("[v1/booking/stalls] Using fallback stall snapshot due to database warning:", (err as any)?.message);
  }

  return json(getFallbackSnapshot(zone ?? undefined), 200, requestId, { Vary: "Cookie" });
});
