-- 0010: columns the registration and admin code now uses, which until now were only created at
-- runtime by ensureTables() in app/v1/[...route]/route.ts.
--
-- 1. Aadhaar/PAN consent (DPDP Act 2023): the registration form now requires an explicit consent
--    checkbox. The flag, its time and (on the account) the client address are stored with the
--    registration as evidence of consent.
-- 2. Administrator passwords: admins can sign in with a password (scrypt "salt:hash", see
--    lib/auth/password.ts) as well as with an emailed code. No password is ever seeded; a new
--    administrator sets one with the emailed reset code.

alter table public.user_accounts add column if not exists id_consent_given boolean not null default false;
alter table public.user_accounts add column if not exists id_consent_at timestamptz;
alter table public.user_accounts add column if not exists id_consent_ip text;

alter table public.startup_team_leaders add column if not exists id_consent_given boolean not null default false;
alter table public.startup_team_leaders add column if not exists id_consent_at timestamptz;

alter table public.student_innovators add column if not exists id_consent_given boolean not null default false;
alter table public.student_innovators add column if not exists id_consent_at timestamptz;

alter table app_auth.admin_users add column if not exists password_hash text
  check (password_hash is null or password_hash ~ '^[0-9a-f]{32}:[0-9a-f]{128}$');
