-- 0010: ensure DPDP Act voluntary consent fields are present on user and leader accounts.
alter table public.user_accounts add column if not exists id_consent_given boolean not null default false;
alter table public.user_accounts add column if not exists id_consent_at timestamptz;
alter table public.user_accounts add column if not exists id_consent_ip text;

alter table public.startup_team_leaders add column if not exists id_consent_given boolean not null default false;
alter table public.startup_team_leaders add column if not exists id_consent_at timestamptz;

alter table public.student_innovators add column if not exists id_consent_given boolean not null default false;
alter table public.student_innovators add column if not exists id_consent_at timestamptz;
