-- ============================================================================
-- 0001_registration_init.sql
-- Registration Schema for Startup Leaders & Student Innovators
-- ============================================================================

create table if not exists event_editions (
  id                      smallint primary key check (id between 2026 and 2100),
  name                    text not null,
  pre_event_on            date default '2026-12-17',
  event_starts_on         date default '2026-12-18',
  event_ends_on           date default '2026-12-20',
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

insert into event_editions (id, name)
values (2026, 'ISF Startup Jathara 2026 @ Dandakaranya')
on conflict (id) do nothing;

create table if not exists user_accounts (
  id                  uuid primary key default gen_random_uuid(),
  auth_subject        text unique,
  email               text,
  mobile_e164         text,
  full_name           text not null check (length(trim(full_name)) between 1 and 200),
  password_hash       text,
  status              text not null default 'active' check (status in ('pending_activation', 'active', 'deactivated')),
  category            text check (category in ('startup_founder', 'student_innovator', 'startup_team_member')),
  team_name           text,
  team_members        text,
  team_members_json   jsonb,
  photo_url           text,
  domain              text,
  alt_mobile          text,
  city                text,
  state               text,
  country             text default 'India',
  linkedin_url        text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create unique index if not exists user_accounts_email_unique on user_accounts (lower(email)) where email is not null;
create index if not exists idx_user_accounts_mobile on user_accounts (mobile_e164);
create index if not exists idx_user_accounts_category on user_accounts (category);

create table if not exists role_grants (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references user_accounts(id) on delete cascade,
  role        text not null check (role in ('startup_team_leader', 'startup_team_member')),
  edition_id  smallint references event_editions(id),
  granted_at  timestamptz not null default now()
);

create unique index if not exists role_grants_active_unique on role_grants (user_id, role, coalesce(edition_id, 0));

create table if not exists edition_access (
  user_id     uuid not null references user_accounts(id) on delete cascade,
  edition_id  smallint not null references event_editions(id),
  source      text not null default 'predefined',
  granted_at  timestamptz not null default now(),
  primary key (user_id, edition_id)
);

create table if not exists startups (
  id               uuid primary key default gen_random_uuid(),
  name             text not null check (length(trim(name)) between 2 and 200),
  name_normalized  text generated always as (lower(regexp_replace(trim(name), '\s+', ' ', 'g'))) stored,
  city             text,
  state            text,
  origin           text not null default 'applicant',
  created_by       uuid references user_accounts(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists idx_startups_name_normalized on startups (name_normalized);

create table if not exists startup_memberships (
  startup_id       uuid not null references startups(id) on delete cascade,
  user_id          uuid not null references user_accounts(id) on delete cascade,
  position         text not null check (position in ('leader', 'member')),
  created_at       timestamptz not null default now(),
  primary key (startup_id, user_id)
);

create table if not exists startup_team_leaders (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references user_accounts(id) on delete cascade,
  startup_id    uuid references startups(id) on delete set null,
  team_name     text not null,
  full_name     text not null,
  email         text not null,
  mobile        text not null,
  alt_mobile    text not null,
  domain        text not null,
  city          text not null,
  state         text not null,
  country       text not null default 'India',
  linkedin_url  text not null,
  photo_url     text,
  edition_id    smallint default 2026 references event_editions(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint uq_startup_team_leaders_user unique (user_id)
);

create index if not exists idx_startup_team_leaders_email on startup_team_leaders (lower(email));
create index if not exists idx_startup_team_leaders_startup on startup_team_leaders (startup_id);

create table if not exists startup_team_members (
  id              uuid primary key default gen_random_uuid(),
  startup_id      uuid references startups(id) on delete cascade,
  leader_user_id  uuid not null references user_accounts(id) on delete cascade,
  user_id         uuid references user_accounts(id) on delete cascade,
  name            text not null,
  photo_url       text,
  phone           text not null,
  email           text not null,
  created_at      timestamptz not null default now()
);

create index if not exists idx_startup_team_members_leader on startup_team_members (leader_user_id);
create index if not exists idx_startup_team_members_user on startup_team_members (user_id);
create index if not exists idx_startup_team_members_email on startup_team_members (lower(email));

create table if not exists student_innovators (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references user_accounts(id) on delete cascade,
  startup_id    uuid references startups(id) on delete set null,
  team_name     text not null,
  full_name     text not null,
  email         text not null,
  mobile        text not null,
  alt_mobile    text not null,
  domain        text not null,
  city          text not null,
  state         text not null,
  country       text not null default 'India',
  linkedin_url  text not null,
  photo_url     text,
  edition_id    smallint default 2026 references event_editions(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint uq_student_innovators_user unique (user_id)
);

create index if not exists idx_student_innovators_email on student_innovators (lower(email));
create index if not exists idx_student_innovators_startup on student_innovators (startup_id);

create table if not exists student_team_members (
  id                    uuid primary key default gen_random_uuid(),
  student_innovator_id  uuid references student_innovators(id) on delete cascade,
  leader_user_id        uuid not null references user_accounts(id) on delete cascade,
  user_id               uuid references user_accounts(id) on delete cascade,
  team_name             text,
  name                  text not null,
  photo_url             text,
  phone                 text not null,
  email                 text not null,
  created_at            timestamptz not null default now()
);

create index if not exists idx_student_team_members_leader on student_team_members (leader_user_id);
create index if not exists idx_student_team_members_innovator on student_team_members (student_innovator_id);
create index if not exists idx_student_team_members_user on student_team_members (user_id);
create index if not exists idx_student_team_members_email on student_team_members (lower(email));
