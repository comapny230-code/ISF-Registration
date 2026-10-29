-- 0008: verify the leader's email during registration; booking no longer needs manual approval.
--
-- 1. Registration email codes. A code is emailed while the form is being filled in and must be
--    entered before the registration is accepted, so every team leader has proved control of the
--    registered address. Like sign-in codes (0007), a code is bound to the browser that asked for
--    it (only the SHA-256 of a random HttpOnly cookie is stored) and allows 5 attempts in 10 minutes.
--    verified_at marks a correct code; consumed_at is set in the same transaction that saves the
--    registration, so a registration that fails or rolls back leaves the code usable until expiry.
--
-- 2. Owner decision (2026-10-29, replaces D-02): teams no longer need organiser approval to book.
--    Organisers review registrations and bookings daily and can still reject a team (which blocks
--    booking) or cancel a booking from the admin page.

create table app_auth.registration_email_challenges (
  id            uuid primary key,
  email         text not null check (email = lower(btrim(email))),
  code_mac      bytea not null,
  binding_hash  bytea not null check (octet_length(binding_hash) = 32),
  created_at    timestamptz not null default clock_timestamp(),
  expires_at    timestamptz not null,
  attempts      smallint not null default 0 check (attempts between 0 and 5),
  verified_at   timestamptz,
  consumed_at   timestamptz,
  superseded_at timestamptz,
  check (expires_at > created_at and expires_at <= created_at + interval '15 minutes'),
  check (consumed_at is null or verified_at is not null)
);
create index registration_email_challenges_active_ix
  on app_auth.registration_email_challenges (email, binding_hash, created_at desc)
  where consumed_at is null and superseded_at is null;

update booking.settings
   set require_team_approval = false, updated_at = now(), updated_by = 'migration-0008'
 where edition_id = 2026;
alter table booking.settings alter column require_team_approval set default false;
