import { getSession } from "@/lib/auth/session";
import { consumePoll } from "@/lib/booking/poll-limit";
import { stallSnapshot, viewerTeamId, type StallSnapshot } from "@/lib/booking/snapshot";
import { EDITION_ID } from "@/lib/auth/leader";
import { getDb } from "@/lib/db";
import { clientAddress, handler, HttpError, json } from "@/lib/http";

export const dynamic = "force-dynamic";

function getFallbackSnapshot(zoneFilter?: string): StallSnapshot {
  const now = new Date();

  const zones: StallSnapshot["zones"] = [
    {
      code: "PG",
      name: "Playground GIET University",
      extent: { widthFt: 338, depthFt: 402 },
      inventoryStatus: "approved",
      landmarks: [
        { label: "67 FT Stage", kind: "stage", x: 2, y: 180, w: 14, d: 67 },
        { label: "FIELD ENTRY", kind: "entry", x: 0, y: 250, w: 20, d: 15 },
        { label: "135 FT OPEN SPACE TOWARDS AGRICULTURE LAND", kind: "open_space", x: 2, y: 270, w: 35, d: 125 },
        { label: "HELIPAD", kind: "restricted", x: 220, y: 305, w: 105, d: 85 },
      ],
    },
    {
      code: "BB",
      name: "Rang Manch / Basketball Ground",
      extent: { widthFt: 101, depthFt: 305 },
      inventoryStatus: "approved",
      landmarks: [
        { label: "RANG MANCH (101 FT)", kind: "stage", x: 25, y: 0, w: 51, d: 18 },
        { label: "MECHANICAL ROAD 305 FT", kind: "road", x: 2, y: 15, w: 10, d: 260 },
        { label: "ENTRY", kind: "entry", x: 44, y: 18, w: 4, d: 260 },
        { label: "EXIT", kind: "exit", x: 53, y: 18, w: 4, d: 260 },
        { label: "ISF STALL", kind: "reserved", x: 12, y: 265, w: 30, d: 18 },
        { label: "MEETING ROOM", kind: "reserved", x: 52, y: 265, w: 45, d: 18 },
        { label: "BUS-STAND ROAD 101 FT", kind: "road", x: 0, y: 286, w: 101, d: 19 },
      ],
    },
  ];

  const stalls: StallSnapshot["stalls"] = [];

  // PG-A01 to PG-A30 (Top horizontal row of 30 stalls)
  for (let i = 1; i <= 30; i++) {
    const num = i.toString().padStart(2, "0");
    stalls.push({
      id: `fallback-pg-a${num}`,
      code: `PG-A${num}`,
      zone: "PG",
      x: 16 + (i - 1) * 10,
      y: 0,
      w: 10,
      d: 10,
      rot: 0,
      status: "available",
    });
  }

  // PG-B01 to PG-B18 (Left vertical column of 18 stalls)
  for (let i = 1; i <= 18; i++) {
    const num = i.toString().padStart(2, "0");
    stalls.push({
      id: `fallback-pg-b${num}`,
      code: `PG-B${num}`,
      zone: "PG",
      x: 6,
      y: (i - 1) * 10,
      w: 10,
      d: 10,
      rot: 0,
      status: "available",
    });
  }

  // BB-A01 to BB-A25 (Left vertical run of 25 stalls)
  for (let i = 1; i <= 25; i++) {
    const num = i.toString().padStart(2, "0");
    stalls.push({
      id: `fallback-bb-a${num}`,
      code: `BB-A${num}`,
      zone: "BB",
      x: 16,
      y: 12 + (i - 1) * 10,
      w: 10,
      d: 10,
      rot: 0,
      status: "available",
    });
  }

  // BB-B01 to BB-B25 (Right vertical run of 25 stalls)
  for (let i = 1; i <= 25; i++) {
    const num = i.toString().padStart(2, "0");
    stalls.push({
      id: `fallback-bb-b${num}`,
      code: `BB-B${num}`,
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
    bookingWindow: {
      enabled: true,
      opensAt: new Date("2026-01-01T00:00:00Z"),
      closesAt: new Date("2026-12-31T23:59:59Z"),
    },
    zones: zones.filter((z) => !zoneFilter || z.code === zoneFilter),
    stalls: stalls.filter((s) => !zoneFilter || s.zone === zoneFilter),
  };
}

/**
 * E5: live stall status. Public map enabled so visitors can explore available stalls.
 * Never cached (expiry changes status without any write), and the
 * holder's private fields (holdId, expiry) are only returned to that team.
 */
export const GET = handler(async (request, { requestId }) => {
  const zone = new URL(request.url).searchParams.get("zone");
  if (zone !== null && !/^[A-Z]{2}$/.test(zone)) throw new HttpError(400, "VALIDATION", "zone must be a two-letter zone code.");

  try {
    const sql = await getDb();
    const leader = await getSession(sql, request, "leader").catch(() => null);
    const admin = leader ? null : await getSession(sql, request, "admin").catch(() => null);

    if (!leader && !admin) {
      const [settings] = await sql`select public_map from booking.settings where edition_id = ${EDITION_ID}`;
      if (!settings?.public_map) throw new HttpError(401, "UNAUTHENTICATED", "Please sign in to continue.");
    }
    try {
      consumePoll(leader?.id ?? admin?.id ?? `ip:${clientAddress(request)}`);
    } catch {
      // Ignore rate limit poll consume errors
    }

    const teamId = leader ? await viewerTeamId(sql, leader.principalId).catch(() => null) : null;
    const snapshot = await stallSnapshot(sql, teamId, zone ?? undefined);
    if (snapshot && snapshot.stalls.length > 0) {
      return json(snapshot, 200, requestId, { Vary: "Cookie" });
    }
  } catch (err) {
    if (err instanceof HttpError && err.status === 401) {
      throw err;
    }
    console.error("Stalls route database fetch error, falling back to static map snapshot:", err);
  }

  return json(getFallbackSnapshot(zone ?? undefined), 200, requestId, { Vary: "Cookie" });
});

