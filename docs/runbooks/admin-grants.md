# Runbook: grant, revoke or disable administrator access

**Who:** an authorised infrastructure administrator ([INFRA]), acting on a written request from the event organisers ([ORG]) that names the person and each permission (decision D-21).
**Where:** the Supabase SQL editor of the target project (staging first, then production).
**Why not in the app:** the runtime role can only *read* `app_auth.admin_users` / `app_auth.admin_grants` (spec §2.6, §3.6). A compromised app or session therefore cannot create or escalate an administrator.

## Permissions

| Permission | Allows |
|---|---|
| `reports.view` | Read bookings, teams and audit lists |
| `booking.cancel` | Cancel confirmed bookings (step-up sign-in required) |
| `inventory.manage` | Enable or disable stalls (step-up sign-in required) |
| `teams.manage` | Approve or reject teams (step-up sign-in required) |

Grant the minimum set. Cancelling and inventory management are deliberately separate permissions.

## Grant

```sql
begin;
-- 1. Create the administrator (once per person). The email must be lower-case.
insert into app_auth.admin_users (email, display_name, created_by)
values ('<person@organiser-domain>', '<Full Name>', '<your name> per <request reference>')
on conflict (email) do nothing;

-- 2. Grant each approved permission.
insert into app_auth.admin_grants (admin_user_id, permission, granted_by)
select id, '<permission>', '<your name> per <request reference>'
  from app_auth.admin_users where email = '<person@organiser-domain>';

-- 3. Check before committing.
select a.email, a.status, g.permission, g.granted_at, g.granted_by
  from app_auth.admin_users a join app_auth.admin_grants g on g.admin_user_id = a.id
 where a.email = '<person@organiser-domain>' and g.revoked_at is null;
commit;
```

The person then signs in at `/admin/login`. Record the change (who, what, request reference) in the organisers' change log. Once `booking.audit_events` exists (migration for P3), also insert an `admin_grant_changed` event with `actor_type = 'operator'`.

## Revoke one permission

```sql
update app_auth.admin_grants
   set revoked_at = now(), revoked_by = '<your name> per <request reference>'
 where revoked_at is null and permission = '<permission>'
   and admin_user_id = (select id from app_auth.admin_users where email = '<person@organiser-domain>');
```

Revocation takes effect on the person's next request. No sign-out is needed.

## Disable a person entirely (and end their sessions)

```sql
begin;
update app_auth.admin_users set status = 'disabled', disabled_at = now() where email = '<person@organiser-domain>';
update app_auth.sessions set revoked_at = now(), revoke_reason = 'admin_disabled'
 where revoked_at is null
   and admin_user_id = (select id from app_auth.admin_users where email = '<person@organiser-domain>');
commit;
```

Administrator rows are never deleted (other tables reference them for audit).
