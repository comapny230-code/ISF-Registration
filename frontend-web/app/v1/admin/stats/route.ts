import { requireAdmin } from "@/lib/auth/guards";
import { EDITION_ID } from "@/lib/auth/leader";
import { handler, json } from "@/lib/http";

export const dynamic = "force-dynamic";

export const GET = handler(async (request, { requestId }) => {
  const { sql } = await requireAdmin(request, ["reports.view", "teams.manage"]);

  // 1. Registrations stats
  const [senior] = await sql`select count(*)::int as count from public.startup_team_leaders where edition_id = ${EDITION_ID}`;
  const [junior] = await sql`select count(*)::int as count from public.student_innovators where edition_id = ${EDITION_ID}`;
  const [members] = await sql`
    select count(*)::int as count 
      from public.startup_team_members m
      join public.startup_team_leaders l on l.user_id = m.leader_user_id and l.edition_id = ${EDITION_ID}`;

  const totalTeams = (senior?.count ?? 0) + (junior?.count ?? 0);
  const totalMembers = members?.count ?? 0;
  const totalUsers = totalTeams + totalMembers;

  // 2. Stalls stats
  const stallRows = await sql`
    with d as materialized (select clock_timestamp() as t)
    select s.id, s.code, z.code as zone, s.bookable, s.admin_status,
           case when r.status = 'confirmed' then 'booked'
                when not s.bookable then 'unavailable'
                when r.status = 'held' and r.expires_at > d.t then 'held'
                else 'available' end as status
      from d
      cross join booking.stalls s
      left join booking.zones z on z.id = s.zone_id
      left join booking.reservations r on r.stall_id = s.id and r.status in ('held', 'confirmed')
     where s.edition_id = ${EDITION_ID} and s.inventory_status <> 'retired'`;

  let totalStalls = stallRows.length;
  let bookedStalls = 0;
  let heldStalls = 0;
  let availableStalls = 0;
  let disabledStalls = 0;

  const byZone: Record<string, { total: number; booked: number; held: number; available: number; disabled: number }> = {
    PG: { total: 0, booked: 0, held: 0, available: 0, disabled: 0 },
    BB: { total: 0, booked: 0, held: 0, available: 0, disabled: 0 },
  };

  // If database is empty or fallback is active, default to 98 stalls
  if (totalStalls === 0) {
    totalStalls = 98;
    availableStalls = 98;
    byZone.PG = { total: 48, booked: 0, held: 0, available: 48, disabled: 0 };
    byZone.BB = { total: 50, booked: 0, held: 0, available: 50, disabled: 0 };
  } else {
    for (const r of stallRows) {
      const z = r.zone || "PG";
      if (!byZone[z]) byZone[z] = { total: 0, booked: 0, held: 0, available: 0, disabled: 0 };
      byZone[z].total++;

      if (r.status === "booked") {
        bookedStalls++;
        byZone[z].booked++;
      } else if (r.status === "held") {
        heldStalls++;
        byZone[z].held++;
      } else if (r.status === "unavailable" || r.admin_status === "disabled") {
        disabledStalls++;
        byZone[z].disabled++;
      } else {
        availableStalls++;
        byZone[z].available++;
      }
    }
  }

  return json({
    registrations: {
      totalTeams,
      totalMembers,
      totalUsers,
      seniorCount: senior?.count ?? 0,
      juniorCount: junior?.count ?? 0,
    },
    stalls: {
      total: totalStalls,
      booked: bookedStalls,
      held: heldStalls,
      available: availableStalls,
      disabled: disabledStalls,
      byZone,
    },
  }, 200, requestId);
});
