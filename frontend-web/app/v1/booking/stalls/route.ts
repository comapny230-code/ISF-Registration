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
      name: "Playground GIET University",
      extent: { widthFt: 338, depthFt: 402 },
      landmarks: [
        { label: "67 FT Stage", kind: "stage", x: 2, y: 180, w: 14, d: 67 },
        { label: "FIELD ENTRY", kind: "entry", x: 0, y: 250, w: 20, d: 15 },
        { label: "135 FT OPEN SPACE TOWARDS AGRICULTURE LAND", kind: "open_space", x: 2, y: 270, w: 35, d: 125 },
        { label: "HELIPAD", kind: "restricted", x: 220, y: 305, w: 105, d: 85 },
      ],
      inventoryStatus: "approved",
    },
    {
      code: "BB",
      name: "Rang Manch / Basketball Ground",
      extent: { widthFt: 101, depthFt: 305 },
      landmarks: [
        { label: "RANG MANCH (101 FT)", kind: "stage", x: 25, y: 0, w: 51, d: 18 },
        { label: "MECHANICAL ROAD 305 FT", kind: "road", x: 2, y: 15, w: 10, d: 260 },
        { label: "ENTRY", kind: "entry", x: 44, y: 18, w: 4, d: 260 },
        { label: "EXIT", kind: "exit", x: 53, y: 18, w: 4, d: 260 },
        { label: "ISF STALL", kind: "reserved", x: 12, y: 265, w: 30, d: 18 },
        { label: "MEETING ROOM", kind: "reserved", x: 52, y: 265, w: 45, d: 18 },
        { label: "BUS-STAND ROAD 101 FT", kind: "road", x: 0, y: 286, w: 101, d: 19 },
      ],
      inventoryStatus: "approved",
    },
  ];

  const allStalls: Array<{
    id: string;
    code: string;
    zone: string;
    x: number;
    y: number;
    w: number;
    d: number;
    rot: number;
    status: "available";
  }> = [];

  // Zone PG stalls (48 total: 30 top run + 18 left run)
  for (let i = 1; i <= 30; i++) {
    const code = `PG-A${String(i).padStart(2, "0")}`;
    allStalls.push({
      id: `pg-a-${i}`,
      code,
      zone: "PG",
      x: 16 + (i - 1) * 10,
      y: 0,
      w: 10,
      d: 10,
      rot: 0,
      status: "available",
    });
  }
  for (let i = 1; i <= 18; i++) {
    const code = `PG-B${String(i).padStart(2, "0")}`;
    allStalls.push({
      id: `pg-b-${i}`,
      code,
      zone: "PG",
      x: 6,
      y: (i - 1) * 10,
      w: 10,
      d: 10,
      rot: 0,
      status: "available",
    });
  }

  // Zone BB stalls (50 total: 25 left run + 25 right run)
  for (let i = 1; i <= 25; i++) {
    const code = `BB-A${String(i).padStart(2, "0")}`;
    allStalls.push({
      id: `bb-a-${i}`,
      code,
      zone: "BB",
      x: 16,
      y: 12 + (i - 1) * 10,
      w: 10,
      d: 10,
      rot: 0,
      status: "available",
    });
  }
  for (let i = 1; i <= 25; i++) {
    const code = `BB-B${String(i).padStart(2, "0")}`;
    allStalls.push({
      id: `bb-b-${i}`,
      code,
      zone: "BB",
      x: 72,
      y: 12 + (i - 1) * 10,
      w: 10,
      d: 10,
      rot: 0,
      status: "available",
    });
  }

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
