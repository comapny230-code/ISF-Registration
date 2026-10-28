# Runbook: a leader registered in both tracks

**Symptom:** the leader sees "registered as a leader in more than one track" (`409 TEAM_AMBIGUOUS`) and cannot book. Their account has both a `startup_team_leaders` row and a `student_innovators` row, so the system refuses to guess which team is real (spec §3.3).

**Who decides:** the event organisers ([ORG]) confirm with the leader which registration is valid. An authorised infrastructure administrator ([INFRA]) applies the change. New registrations can no longer create this state (registration rejects a second leader registration in either track); it can only exist in data from before that fix.

## 1. Find affected leaders (read-only)

```sql
select u.id as user_id, u.email, l.id as senior_row, l.team_name as senior_team, s.id as junior_row, s.team_name as junior_team
  from user_accounts u
  join startup_team_leaders l on l.user_id = u.id
  join student_innovators  s on s.user_id = u.id;
```

## 2. Resolve one leader

Export both rows (and their member rows) to the organisers' records first. Then remove the registration the organisers marked as invalid, in one transaction:

```sql
begin;
-- Example: the junior (student innovator) registration is the invalid one.
-- If a booking team already references that row, STOP and escalate; the delete will be refused.
delete from student_team_members where student_innovator_id = '<junior_row>';
delete from student_innovators  where id = '<junior_row>' and user_id = '<user_id>';

-- Confirm exactly one leader row remains.
select (select count(*) from startup_team_leaders where user_id = '<user_id>')
     + (select count(*) from student_innovators  where user_id = '<user_id>') as leader_rows;  -- must be 1
commit;
```

For the opposite case, delete from `startup_team_members` and `startup_team_leaders` instead. The leader signs in again; their team row is created automatically and starts as `pending` approval.

Record the decision (who approved, which row was removed, why) in the organisers' change log.
