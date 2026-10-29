import { requireAdmin } from "@/lib/auth/guards";
import { EDITION_ID } from "@/lib/auth/leader";
import { assertSameOriginJson, handler, HttpError, json, readJsonObject, v } from "@/lib/http";

export const dynamic = "force-dynamic";

export const PATCH = handler<{ id: string }>(async (request, { requestId, params }) => {
  assertSameOriginJson(request);
  await requireAdmin(request, "teams.manage");
  const id = v.uuid(params.id, "id");

  const raw = await readJsonObject(request);
  const teamName = typeof raw.teamName === "string" ? raw.teamName.trim() : "";
  const leaderName = typeof raw.leaderName === "string" ? raw.leaderName.trim() : "";
  const mobile = typeof raw.mobile === "string" ? raw.mobile.trim() : "";
  const altMobile = typeof raw.altMobile === "string" ? raw.altMobile.trim() : null;
  const domain = typeof raw.domain === "string" ? raw.domain.trim() : "";
  const city = typeof raw.city === "string" ? raw.city.trim() : "";
  const state = typeof raw.state === "string" ? raw.state.trim() : "";
  const projectDetails = typeof raw.projectDetails === "string" ? raw.projectDetails.trim() : null;

  if (teamName.length < 2) throw new HttpError(400, "VALIDATION", "Team name must be at least 2 characters.");
  if (leaderName.length < 2) throw new HttpError(400, "VALIDATION", "Leader name must be at least 2 characters.");
  if (!/^[6-9]\d{9}$/.test(mobile)) throw new HttpError(400, "VALIDATION", "Mobile must be a valid 10-digit number.");

  const { sql } = await requireAdmin(request, "teams.manage");

  // Try updating senior startup leader
  const [updatedSenior] = await sql`
    update public.startup_team_leaders
       set team_name = ${teamName},
           full_name = ${leaderName},
           mobile = ${mobile},
           alt_mobile = ${altMobile ?? mobile},
           domain = ${domain},
           city = ${city},
           state = ${state},
           project_details = ${projectDetails},
           updated_at = now()
     where id = ${id} and edition_id = ${EDITION_ID}
    returning id, team_name, full_name`;

  if (updatedSenior) {
    // Update team snapshot if exists
    await sql`
      update booking.teams
         set team_name_snapshot = ${teamName.slice(0, 200)},
             updated_at = now()
       where startup_team_leader_id = ${id} and edition_id = ${EDITION_ID}`;

    return json({ ok: true, message: `Updated team "${updatedSenior.team_name}".` }, 200, requestId);
  }

  // Try updating junior student innovator
  const [updatedJunior] = await sql`
    update public.student_innovators
       set team_name = ${teamName},
           full_name = ${leaderName},
           mobile = ${mobile},
           alt_mobile = ${altMobile ?? mobile},
           domain = ${domain},
           city = ${city},
           state = ${state},
           project_details = ${projectDetails},
           updated_at = now()
     where id = ${id} and edition_id = ${EDITION_ID}
    returning id, team_name, full_name`;

  if (updatedJunior) {
    await sql`
      update booking.teams
         set team_name_snapshot = ${teamName.slice(0, 200)},
             updated_at = now()
       where student_innovator_id = ${id} and edition_id = ${EDITION_ID}`;

    return json({ ok: true, message: `Updated team "${updatedJunior.team_name}".` }, 200, requestId);
  }

  throw new HttpError(404, "REGISTRATION_NOT_FOUND", "Registration record was not found.");
});

export const DELETE = handler<{ id: string }>(async (request, { requestId, params }) => {
  assertSameOriginJson(request);
  const { sql } = await requireAdmin(request, "teams.manage");
  const id = v.uuid(params.id, "id");

  // Check senior
  const [senior] = await sql`select user_id from public.startup_team_leaders where id = ${id} and edition_id = ${EDITION_ID}`;
  if (senior) {
    await sql`delete from public.user_accounts where id = ${senior.user_id}`;
    return json({ ok: true, message: "Startup registration deleted." }, 200, requestId);
  }

  // Check junior
  const [junior] = await sql`select user_id from public.student_innovators where id = ${id} and edition_id = ${EDITION_ID}`;
  if (junior) {
    await sql`delete from public.user_accounts where id = ${junior.user_id}`;
    return json({ ok: true, message: "Student innovator registration deleted." }, 200, requestId);
  }

  throw new HttpError(404, "REGISTRATION_NOT_FOUND", "Registration record was not found.");
});
