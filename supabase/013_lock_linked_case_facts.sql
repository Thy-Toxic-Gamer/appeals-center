-- Lock Discord moderation facts when a member appeals a ThyToxicBot case.
-- The browser treats these fields as read-only, and this function independently
-- reloads the authoritative values so a modified request cannot change them.

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
  linked_case public.moderation_cases%rowtype;
  linked_case_selected boolean := false;
  platform_value text;
  action_value text;
  username_value text;
  profile_value text;
  reason_value text;
  incident_value date := p_incident_date;
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

  if p_cases is null or jsonb_typeof(p_cases) <> 'array' then
    raise exception 'Appeal cases must be provided as a list.';
  end if;

  case_count := jsonb_array_length(p_cases);
  if (p_appeal_mode = 'individual' and case_count <> 1)
     or (p_appeal_mode = 'universal' and case_count not between 2 and 6) then
    raise exception 'Individual appeals require one case; Universal Appeals require two to six cases.';
  end if;

  if nullif(trim(p_existing_case_number), '') is not null then
    if p_appeal_mode <> 'individual' or case_count <> 1 then
      raise exception 'A linked moderation case must be submitted as one individual appeal.';
    end if;

    select moderation.*
    into linked_case
    from public.moderation_cases moderation
    where moderation.case_number = trim(p_existing_case_number)
      and moderation.applicant_id = applicant
      and moderation.appeal_submission_id is null
      and moderation.status in ('active', 'expired', 'closed')
      and moderation.action_type in ('warn', 'mute', 'kick', 'ban', 'automod')
    for update;

    if not found then
      raise exception 'This moderation case is unavailable or is not assigned to your account.';
    end if;

    linked_case_selected := true;
    incident_value := linked_case.created_at::date;
  elsif p_incident_date is not null and p_incident_date > current_date then
    raise exception 'Incident date cannot be in the future.';
  end if;

  if char_length(coalesce(p_existing_case_number, '')) > 40
     or char_length(coalesce(p_evidence_link, '')) > 1000 then
    raise exception 'One or more submission fields are too long.';
  end if;

  insert into public.appeal_submissions (
    applicant_id, appeal_mode, display_name, incident_date,
    existing_case_number, explanation, evidence_link, declaration_accepted
  ) values (
    applicant, p_appeal_mode, trim(p_display_name), incident_value,
    case when linked_case_selected then linked_case.case_number else nullif(trim(p_existing_case_number), '') end,
    trim(p_explanation), nullif(trim(p_evidence_link), ''), true
  ) returning * into new_submission;

  for case_item in select value from jsonb_array_elements(p_cases)
  loop
    if linked_case_selected then
      platform_value := 'discord';
      action_value := case linked_case.action_type
        when 'ban' then 'Ban'
        when 'mute' then 'Timeout / Mute'
        when 'kick' then 'Kick'
        when 'warn' then 'Warning'
        else 'Other moderation action'
      end;
      username_value := coalesce(nullif(trim(linked_case.discord_username), ''), nullif(trim(linked_case.discord_display_name), ''), 'Discord member');
      profile_value := null;
      reason_value := nullif(trim(linked_case.reason), '');
    else
      platform_value := lower(trim(case_item ->> 'platform'));
      action_value := trim(case_item ->> 'action_type');
      username_value := trim(case_item ->> 'platform_username');
      profile_value := nullif(trim(case_item ->> 'profile_url'), '');
      reason_value := nullif(trim(case_item ->> 'moderation_reason'), '');
    end if;

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
      join public.appeal_submissions existing_submission on existing_submission.id = existing_case.submission_id
      where existing_submission.applicant_id = applicant
        and existing_case.platform = platform_value
        and lower(existing_case.action_type) = lower(action_value)
        and existing_case.status in ('submitted', 'under_review', 'needs_information')
    ) then
      raise exception 'You already have an active appeal for %: %.', platform_value, action_value;
    end if;

    insert into public.appeal_cases (
      submission_id, platform, action_type, platform_username, profile_url, moderation_reason
    ) values (
      new_submission.id, platform_value, action_value, username_value, profile_value, reason_value
    ) returning * into new_case;

    result_cases := result_cases || jsonb_build_array(jsonb_build_object(
      'id', new_case.id,
      'case_number', new_case.case_number,
      'platform', new_case.platform,
      'status', new_case.status
    ));
  end loop;

  if linked_case_selected then
    update public.moderation_cases
    set appeal_submission_id = new_submission.id,
        updated_at = now()
    where id = linked_case.id;
  end if;

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

comment on function public.submit_appeal(text, text, date, text, text, text, boolean, jsonb) is
  'Creates appeals and reloads linked Discord case facts from moderation_cases so applicants cannot alter staff-owned records.';
