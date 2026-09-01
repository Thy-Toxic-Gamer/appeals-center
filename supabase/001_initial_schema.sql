-- Appeals Center: initial secure database structure
-- This creates the tables, case numbering, audit logs, and six-month retention fields.
-- API access remains locked until the RLS policies are added in the next setup step.

create extension if not exists pgcrypto;

create sequence if not exists public.appeal_submission_number_seq start 1;
create sequence if not exists public.appeal_case_number_seq start 1;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 60),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.staff_members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('moderator', 'overseer', 'owner')),
  active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.appeal_submissions (
  id uuid primary key default gen_random_uuid(),
  submission_number text not null unique default (
    'APL-' || to_char(now(), 'YYYY') || '-' ||
    lpad(nextval('public.appeal_submission_number_seq')::text, 6, '0')
  ),
  applicant_id uuid not null references auth.users(id) on delete cascade,
  appeal_mode text not null check (appeal_mode in ('individual', 'universal')),
  display_name text not null check (char_length(display_name) between 1 and 60),
  incident_date date,
  existing_case_number text,
  explanation text not null check (char_length(explanation) between 50 and 3000),
  evidence_link text,
  declaration_accepted boolean not null check (declaration_accepted = true),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.appeal_cases (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.appeal_submissions(id) on delete cascade,
  case_number text unique,
  platform text not null check (
    platform in ('discord', 'twitch', 'youtube', 'kick', 'twitter', 'instagram')
  ),
  action_type text not null,
  platform_username text not null check (char_length(platform_username) between 1 and 80),
  profile_url text,
  moderation_reason text,
  status text not null default 'submitted' check (
    status in (
      'submitted',
      'under_review',
      'needs_information',
      'approved',
      'denied',
      'closed'
    )
  ),
  assigned_to uuid references auth.users(id) on delete set null,
  applicant_update text,
  decision_reason text,
  decided_by uuid references auth.users(id) on delete set null,
  decided_at timestamptz,
  closed_at timestamptz,
  purge_after timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.appeal_messages (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.appeal_cases(id) on delete cascade,
  author_id uuid references auth.users(id) on delete set null,
  author_type text not null check (author_type in ('applicant', 'staff', 'system')),
  message text not null check (char_length(message) between 1 and 3000),
  created_at timestamptz not null default now()
);

create table if not exists public.staff_notes (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.appeal_cases(id) on delete cascade,
  author_id uuid not null references auth.users(id) on delete restrict,
  note text not null check (char_length(note) between 1 and 3000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.appeal_logs (
  id bigint generated always as identity primary key,
  case_id uuid not null references public.appeal_cases(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  event_type text not null,
  old_status text,
  new_status text,
  public_message text,
  private_details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists appeal_submissions_applicant_idx
  on public.appeal_submissions(applicant_id, created_at desc);
create index if not exists appeal_cases_submission_idx
  on public.appeal_cases(submission_id);
create index if not exists appeal_cases_status_idx
  on public.appeal_cases(status, created_at desc);
create index if not exists appeal_cases_purge_idx
  on public.appeal_cases(purge_after)
  where purge_after is not null;
create index if not exists appeal_logs_case_idx
  on public.appeal_logs(case_id, created_at desc);
create index if not exists appeal_messages_case_idx
  on public.appeal_messages(case_id, created_at);
create index if not exists staff_notes_case_idx
  on public.staff_notes(case_id, created_at desc);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.assign_appeal_case_number()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  platform_prefix text;
begin
  platform_prefix := case new.platform
    when 'discord' then 'DIS'
    when 'twitch' then 'TTV'
    when 'youtube' then 'YT'
    when 'kick' then 'KCK'
    when 'twitter' then 'X'
    when 'instagram' then 'IG'
    else 'APL'
  end;

  if new.case_number is null then
    new.case_number :=
      platform_prefix || '-' || to_char(now(), 'YYYY') || '-' ||
      lpad(nextval('public.appeal_case_number_seq')::text, 6, '0');
  end if;
  return new;
end;
$$;

create or replace function public.apply_case_retention()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.status in ('approved', 'denied', 'closed')
     and old.status is distinct from new.status then
    new.closed_at := coalesce(new.closed_at, now());
    new.purge_after := new.closed_at + interval '6 months';
    new.decided_at := coalesce(new.decided_at, now());
  elsif new.status not in ('approved', 'denied', 'closed') then
    new.closed_at := null;
    new.purge_after := null;
  end if;
  return new;
end;
$$;

create or replace function public.log_case_status_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if old.status is distinct from new.status then
    insert into public.appeal_logs (
      case_id,
      actor_id,
      event_type,
      old_status,
      new_status,
      public_message
    )
    values (
      new.id,
      auth.uid(),
      'status_changed',
      old.status,
      new.status,
      new.applicant_update
    );
  end if;
  return new;
end;
$$;

create or replace function public.purge_expired_appeals()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  deleted_cases integer;
begin
  delete from public.appeal_cases
  where purge_after is not null
    and purge_after <= now();

  get diagnostics deleted_cases = row_count;

  delete from public.appeal_submissions submission
  where not exists (
    select 1
    from public.appeal_cases appeal_case
    where appeal_case.submission_id = submission.id
  )
  and submission.created_at <= now() - interval '6 months';

  return deleted_cases;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

drop trigger if exists staff_members_set_updated_at on public.staff_members;
create trigger staff_members_set_updated_at
before update on public.staff_members
for each row execute function public.set_updated_at();

drop trigger if exists submissions_set_updated_at on public.appeal_submissions;
create trigger submissions_set_updated_at
before update on public.appeal_submissions
for each row execute function public.set_updated_at();

drop trigger if exists cases_assign_number on public.appeal_cases;
create trigger cases_assign_number
before insert on public.appeal_cases
for each row execute function public.assign_appeal_case_number();

drop trigger if exists cases_apply_retention on public.appeal_cases;
create trigger cases_apply_retention
before update on public.appeal_cases
for each row execute function public.apply_case_retention();

drop trigger if exists cases_log_status_change on public.appeal_cases;
create trigger cases_log_status_change
after update on public.appeal_cases
for each row execute function public.log_case_status_change();

drop trigger if exists staff_notes_set_updated_at on public.staff_notes;
create trigger staff_notes_set_updated_at
before update on public.staff_notes
for each row execute function public.set_updated_at();

alter table public.profiles enable row level security;
alter table public.staff_members enable row level security;
alter table public.appeal_submissions enable row level security;
alter table public.appeal_cases enable row level security;
alter table public.appeal_messages enable row level security;
alter table public.staff_notes enable row level security;
alter table public.appeal_logs enable row level security;

revoke all on function public.purge_expired_appeals() from public;
revoke all on function public.purge_expired_appeals() from anon;
revoke all on function public.purge_expired_appeals() from authenticated;
