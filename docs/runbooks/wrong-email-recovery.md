# Runbook: a team leader cannot receive sign-in codes (wrong or lost email)

Sign-in codes go only to the email address on the leader's registration, and registration emails were never verified. A typo therefore locks the leader out. Re-registering is refused on purpose, because it would allow team takeover.

**Who:** the event organisers ([ORG]) verify identity; an authorised infrastructure administrator ([INFRA]) applies the change.

## 1. Verify identity (outside the system)

Confirm the requester is the registered leader using at least two details from the registration that were not shown publicly. Examples: the registered mobile number (call it back) plus the last four digits of the Aadhaar number they quote. Never read Aadhaar or other sensitive values out to the requester. Record who verified, how, and when.

## 2. Check the new address is free (read-only)

```sql
select id, email, category from user_accounts where lower(email) = lower('<new@address>');
```

If a row exists, stop and escalate: two accounts would need merging, which is a separate, reviewed change.

## 3. Change the address and end existing sessions

```sql
begin;
update user_accounts set email = lower('<new@address>'), updated_at = now()
 where id = '<user_id>' and lower(email) = lower('<old@address>');
update startup_team_leaders set email = lower('<new@address>'), updated_at = now() where user_id = '<user_id>';
update student_innovators  set email = lower('<new@address>'), updated_at = now() where user_id = '<user_id>';
update app_auth.sessions set revoked_at = now(), revoke_reason = 'email_changed'
 where user_id = '<user_id>' and revoked_at is null;
update app_auth.login_challenges set superseded_at = now()
 where email = lower('<old@address>') and consumed_at is null and superseded_at is null;
commit;
```

The leader can now request a code at `/login` with the new address. Record the change in the organisers' change log.
