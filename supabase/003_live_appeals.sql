-- Appeals Center: Twitch identity fields and atomic appeal submission
-- Run after 001_initial_schema.sql and 002_security_policies.sql.

alter table public.profiles
  add column if not exists provider text,
  add column if not exists provider_user_id text,
  add column if not exists username text,
  add column if not exists avatar_url text,
  add column if not exists email text;

create index if not exists profiles_provider_identity_idx
  on public.profiles(provider, provider_user_id)
  where provider_user_id is not null;

create or replace function public.handle_new_appeals_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  new_provider text;
  new_provider_id text;
  new_username text;
  new_display_name text;
  new_avatar_url text;
begin
  new_provider := coalesce(
    nullif(new.raw_app_meta_data ->> 'provider', ''),
    'email'
  );
  new_provider_id := coalesce(
    nullif(new.raw_user_meta_data ->> 'provider_id', ''),
    nullif(new.raw_user_meta_data ->> 'sub', '')
  );
  new_username := coalesce(
    nullif(trim(new.raw_user_meta_data ->> 'user_name'), ''),
    nullif(trim(new.raw_user_meta_data ->> 'preferred_username'), ''),
    nullif(trim(new.raw_user_meta_data ->> 'name'), ''),
    nullif(split_part(coalesce(new.email, ''), '@', 1), '')
  );
  new_display_name := coalesce(
    nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''),
    nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''),
    new_username,
    'Applicant'
  );
  new_avatar_url := coalesce(
    nullif(new.raw_user_meta_data ->> 'avatar_url', ''),
    nullif(new.raw_user_meta_data ->> 'picture', '')
  );

  insert into public.profiles (
    id,
    display_name,
    provider,
    provider_user_id,
    username,
    avatar_url,
    email
  )
  values (
    new.id,
    left(new_display_name, 60),
    left(new_provider, 40),
    left(new_provider_id, 120),
    left(new_username, 80),
    left(new_avatar_url, 1000),
    new.email
  )
  on conflict (id) do update set
    display_name = excluded.display_name,
    provider = excluded.provider,
    provider_user_id = excluded.provider_user_id,
    username = excluded.username,
    avatar_url = excluded.avatar_url,
    email = excluded.email,
    updated_at = now();

  return new;
end;
$$;

drop trigger if exists create_appeals_profile on auth.users;
create trigger create_appeals_profile
after insert or update of raw_user_meta_data, raw_app_meta_data, email on auth.users
for each row execute function public.handle_new_appeals_user();

-- Backfill profiles for accounts that signed in before this migration.
insert into public.profiles (
  id,
  display_name,
  provider,
  provider_user_id,
  username,
  avatar_url,
  email
)
select
  account.id,
  left(coalesce(
    nullif(trim(account.raw_user_meta_data ->> 'full_name'), ''),
    nullif(trim(account.raw_user_meta_data ->> 'display_name'), ''),
    nullif(trim(account.raw_user_meta_data ->> 'user_name'), ''),
    nullif(split_part(coalesce(account.email, ''), '@', 1), ''),
    'Applicant'
  ), 60),
  left(coalesce(nullif(account.raw_app_meta_data ->> 'provider', ''), 'email'), 40),
  left(coalesce(
    nullif(account.raw_user_meta_data ->> 'provider_id', ''),
    nullif(account.raw_user_meta_data ->> 'sub', '')
  ), 120),
  left(coalesce(
    nullif(trim(account.raw_user_meta_data ->> 'user_name'), ''),
    nullif(trim(account.raw_user_meta_data ->> 'preferred_username'), ''),
    nullif(trim(account.raw_user_meta_data ->> 'name'), ''),
    nullif(split_part(coalesce(account.email, ''), '@', 1), '')
  ), 80),
  left(coalesce(
    nullif(account.raw_user_meta_data ->> 'avatar_url', ''),
    nullif(account.raw_user_meta_data ->> 'picture', '')
  ), 1000),
  account.email
from auth.users account
on conflict (id) do update set
  provider = excluded.provider,
  provider_user_id = excluded.provider_user_id,
  username = excluded.username,
  avatar_url = excluded.avatar_url,
  email = excluded.email,
  updated_at = now();

create or replace function public.submit_appeal(
  p_appeal_mode text,
  p_display_name text,
  p_incident_date date,
  p_existing_case_number text,
  p_explanation text,
  p_evidence_link text,
  p_declaration_accepted boolean,
  p_cases jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  applicant uuid := auth.uid();
  new_submission public.appeal_submissions%rowtype;
  case_item jsonb;
  new_case public.appeal_cases%rowtype;
  platform_value text;
  action_value text;
  username_value text;
  profile_value text;
  reason_value text;
  case_count integer;
  result_cases jsonb := '[]'::jsonb;
begin
  if applicant is null then
    raise exception 'You must sign in before submitting an appeal.';
  end if;

  if p_appeal_mode not in ('individual', 'universal') then
    raise exception 'Invalid appeal type.';
  end if;

  if p_display_name is null or char_length(trim(p_display_name)) not between 1 and 60 then
    raise exception 'Display name must be between 1 and 60 characters.';
  end if;

  if p_explanation is null or char_length(trim(p_explanation)) not between 50 and 3000 then
    raise exception 'Explanation must be between 50 and 3000 characters.';
  end if;

  if p_declaration_accepted is distinct from true then
    raise exception 'You must accept the declaration.';
  end if;

  if p_incident_date is not null and p_incident_date > current_date then
    raise exception 'Incident date cannot be in the future.';
  end if;

  if char_length(coalesce(p_existing_case_number, '')) > 40
     or char_length(coalesce(p_evidence_link, '')) > 1000 then
    raise exception 'One or more submission fields are too long.';
  end if;

  if p_cases is null or jsonb_typeof(p_cases) <> 'array' then
    raise exception 'Appeal cases must be provided as a list.';
  end if;

  case_count := jsonb_array_length(p_cases);
  if (p_appeal_mode = 'individual' and case_count <> 1)
     or (p_appeal_mode = 'universal' and case_count not between 2 and 6) then
    raise exception 'Individual appeals require one case; Universal Appeals require two to six cases.';
  end if;

  insert into public.appeal_submissions (
    applicant_id,
    appeal_mode,
    display_name,
    incident_date,
    existing_case_number,
    explanation,
    evidence_link,
    declaration_accepted
  )
  values (
    applicant,
    p_appeal_mode,
    trim(p_display_name),
    p_incident_date,
    nullif(trim(p_existing_case_number), ''),
    trim(p_explanation),
    nullif(trim(p_evidence_link), ''),
    true
  )
  returning * into new_submission;

  for case_item in select value from jsonb_array_elements(p_cases)
  loop
    platform_value := lower(trim(case_item ->> 'platform'));
    action_value := trim(case_item ->> 'action_type');
    username_value := trim(case_item ->> 'platform_username');
    profile_value := nullif(trim(case_item ->> 'profile_url'), '');
    reason_value := nullif(trim(case_item ->> 'moderation_reason'), '');

    if platform_value not in ('discord', 'twitch', 'youtube', 'kick', 'twitter', 'instagram') then
      raise exception 'Invalid platform selected.';
    end if;

    if action_value is null or not (
      (platform_value = 'discord' and action_value in ('Ban', 'Timeout / Mute', 'Kick', 'Warning', 'Other moderation action'))
      or (platform_value = 'twitch' and action_value in ('Ban', 'Timeout', 'Warning', 'Other moderation action'))
      or (platform_value = 'youtube' and action_value in ('Hidden user', 'Live-chat restriction', 'Comment restriction', 'Block', 'Other moderation action'))
      or (platform_value = 'kick' and action_value in ('Ban', 'Timeout', 'Warning', 'Other moderation action'))
      or (platform_value = 'twitter' and action_value in ('Block', 'Reply restriction', 'Other moderation action'))
      or (platform_value = 'instagram' and action_value in ('Block', 'Restriction', 'Comment restriction', 'Other moderation action'))
    ) then
      raise exception 'Invalid moderation action.';
    end if;

    if username_value is null or char_length(username_value) not between 1 and 80 then
      raise exception 'Each case needs a valid platform username.';
    end if;

    if char_length(coalesce(profile_value, '')) > 1000
       or char_length(coalesce(reason_value, '')) > 300 then
      raise exception 'One or more case fields are too long.';
    end if;

    if exists (
      select 1
      from public.appeal_cases existing_case
      join public.appeal_submissions existing_submission
        on existing_submission.id = existing_case.submission_id
      where existing_submission.applicant_id = applicant
        and existing_case.platform = platform_value
        and lower(existing_case.action_type) = lower(action_value)
        and existing_case.status in ('submitted', 'under_review', 'needs_information')
    ) then
      raise exception 'You already have an active appeal for %: %.', platform_value, action_value;
    end if;

    insert into public.appeal_cases (
      submission_id,
      platform,
      action_type,
      platform_username,
      profile_url,
      moderation_reason
    )
    values (
      new_submission.id,
      platform_value,
      action_value,
      username_value,
      profile_value,
      reason_value
    )
    returning * into new_case;

    result_cases := result_cases || jsonb_build_array(jsonb_build_object(
      'id', new_case.id,
      'case_number', new_case.case_number,
      'platform', new_case.platform,
      'status', new_case.status
    ));
  end loop;

  update public.profiles
  set display_name = trim(p_display_name)
  where id = applicant;

  return jsonb_build_object(
    'submission_id', new_submission.id,
    'submission_number', new_submission.submission_number,
    'cases', result_cases
  );
end;
$$;

revoke all on function public.submit_appeal(text, text, date, text, text, text, boolean, jsonb) from public;
revoke all on function public.submit_appeal(text, text, date, text, text, text, boolean, jsonb) from anon;
grant execute on function public.submit_appeal(text, text, date, text, text, text, boolean, jsonb) to authenticated;

-- Run the existing retention function once daily. Re-running this script updates
-- the job with the same name instead of creating duplicates.
create extension if not exists pg_cron;

select cron.schedule(
  'appeals-six-month-retention',
  '15 4 * * *',
  'select public.purge_expired_appeals()'
);
