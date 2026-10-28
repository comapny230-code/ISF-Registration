-- 0005_booking_settings_and_team_backfill.sql
-- Booking starts CLOSED: disabled, no eligible tracks, team approval required.
-- Opening it is an organiser decision applied by an operator (spec §10, D-01..D-07).
insert into booking.settings (edition_id, updated_by)
values (2026, 'migration-0005')
on conflict (edition_id) do nothing;

-- Teams for leaders registered before registration created them. Only leaders
-- with exactly ONE leader registration for 2026 get a team; leaders registered
-- in both tracks are left for the team-ambiguity runbook.
insert into booking.teams (edition_id, leader_user_id, track, startup_team_leader_id, team_name_snapshot)
select 2026, l.user_id, 'senior', l.id, coalesce(nullif(left(btrim(l.team_name), 200), ''), 'Unnamed team')
  from public.startup_team_leaders l
 where l.edition_id = 2026
   and not exists (select 1 from public.student_innovators s where s.user_id = l.user_id and s.edition_id = 2026)
on conflict do nothing;

insert into booking.teams (edition_id, leader_user_id, track, student_innovator_id, team_name_snapshot)
select 2026, s.user_id, 'junior', s.id, coalesce(nullif(left(btrim(s.team_name), 200), ''), 'Unnamed team')
  from public.student_innovators s
 where s.edition_id = 2026
   and not exists (select 1 from public.startup_team_leaders l where l.user_id = s.user_id and l.edition_id = 2026)
on conflict do nothing;
