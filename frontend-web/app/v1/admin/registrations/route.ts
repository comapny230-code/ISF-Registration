import { requireAdmin } from "@/lib/auth/guards";
import { EDITION_ID } from "@/lib/auth/leader";
import { handler, json } from "@/lib/http";

export const dynamic = "force-dynamic";

export const GET = handler(async (request, { requestId }) => {
  const { sql } = await requireAdmin(request, ["reports.view", "teams.manage"]);

  // 1. Fetch senior startup leaders
  const seniorRows = await sql`
    select l.id,
           'senior' as track,
           l.user_id,
           l.team_name,
           l.full_name as leader_name,
           l.email,
           l.mobile,
           l.alt_mobile,
           l.domain,
           l.project_details,
           l.project_report_url,
           l.city,
           l.state,
           l.country,
           l.linkedin_url,
           l.photo_url,
           l.id_consent_given,
           l.created_at,
           t.id as team_id,
           coalesce(t.approval_status, 'pending') as approval_status,
           r.status as reservation_status,
           st.code as stall_code,
           r.booking_ref
      from public.startup_team_leaders l
      left join booking.teams t on t.startup_team_leader_id = l.id and t.edition_id = ${EDITION_ID}
      left join booking.reservations r on r.team_id = t.id and r.status in ('held', 'confirmed')
      left join booking.stalls st on st.id = r.stall_id
     where l.edition_id = ${EDITION_ID}
     order by l.created_at desc`;

  // 2. Fetch junior student innovators
  const juniorRows = await sql`
    select s.id,
           'junior' as track,
           s.user_id,
           s.team_name,
           s.full_name as leader_name,
           s.email,
           s.mobile,
           s.alt_mobile,
           s.domain,
           s.project_details,
           s.project_report_url,
           s.city,
           s.state,
           s.country,
           s.linkedin_url,
           s.photo_url,
           s.id_consent_given,
           s.created_at,
           t.id as team_id,
           coalesce(t.approval_status, 'pending') as approval_status,
           r.status as reservation_status,
           st.code as stall_code,
           r.booking_ref
      from public.student_innovators s
      left join booking.teams t on t.student_innovator_id = s.id and t.edition_id = ${EDITION_ID}
      left join booking.reservations r on r.team_id = t.id and r.status in ('held', 'confirmed')
      left join booking.stalls st on st.id = r.stall_id
     where s.edition_id = ${EDITION_ID}
     order by s.created_at desc`;

  // 3. Fetch all team members
  const memberRows = await sql`
    select m.id,
           m.leader_user_id,
           m.name,
           m.photo_url,
           m.phone,
           m.email,
           m.created_at
      from public.startup_team_members m
      join public.startup_team_leaders l on l.user_id = m.leader_user_id and l.edition_id = ${EDITION_ID}
     order by m.created_at asc`;

  const membersByLeader = new Map<string, Array<{ name: string; email: string; phone: string; photoUrl: string | null }>>();
  for (const m of memberRows) {
    const list = membersByLeader.get(m.leader_user_id) ?? [];
    list.push({
      name: m.name,
      email: m.email,
      phone: m.phone,
      photoUrl: m.photo_url ?? null,
    });
    membersByLeader.set(m.leader_user_id, list);
  }

  const allRegistrations = [
    ...seniorRows.map((r) => ({
      id: r.id,
      userId: r.user_id,
      teamId: r.team_id ?? null,
      track: "senior" as const,
      teamName: r.team_name,
      leaderName: r.leader_name,
      email: r.email,
      mobile: r.mobile,
      altMobile: r.alt_mobile,
      domain: r.domain,
      projectDetails: r.project_details,
      projectReportUrl: r.project_report_url,
      city: r.city,
      state: r.state,
      country: r.country,
      linkedinUrl: r.linkedin_url,
      photoUrl: r.photo_url,
      consentGiven: Boolean(r.id_consent_given),
      createdAt: r.created_at,
      approvalStatus: r.approval_status,
      members: membersByLeader.get(r.user_id) ?? [],
      reservation: r.reservation_status
        ? {
            kind: r.reservation_status === "confirmed" ? ("booking" as const) : ("hold" as const),
            stallCode: r.stall_code,
            bookingRef: r.booking_ref ?? null,
          }
        : null,
    })),
    ...juniorRows.map((r) => ({
      id: r.id,
      userId: r.user_id,
      teamId: r.team_id ?? null,
      track: "junior" as const,
      teamName: r.team_name,
      leaderName: r.leader_name,
      email: r.email,
      mobile: r.mobile,
      altMobile: r.alt_mobile,
      domain: r.domain,
      projectDetails: r.project_details,
      projectReportUrl: r.project_report_url,
      city: r.city,
      state: r.state,
      country: r.country,
      linkedinUrl: r.linkedin_url,
      photoUrl: r.photo_url,
      consentGiven: Boolean(r.id_consent_given),
      createdAt: r.created_at,
      approvalStatus: r.approval_status,
      members: [],
      reservation: r.reservation_status
        ? {
            kind: r.reservation_status === "confirmed" ? ("booking" as const) : ("hold" as const),
            stallCode: r.stall_code,
            bookingRef: r.booking_ref ?? null,
          }
        : null,
    })),
  ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  return json({
    total: allRegistrations.length,
    registrations: allRegistrations,
  }, 200, requestId);
});
