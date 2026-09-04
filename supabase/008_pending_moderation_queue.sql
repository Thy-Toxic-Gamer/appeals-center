-- Appeals Center: staff visibility and Owner deletion for bot cases awaiting an appeal.
-- Run after the ThyToxicBot moderation_cases and claimable-case migrations.

create or replace function public.staff_pending_moderation_cases()
returns table (
  id uuid,
  case_number text,
  discord_user_id text,
  discord_username text,
  discord_display_name text,
  moderator_username text,
  action_type text,
  reason text,
  duration_seconds bigint,
  status text,
  dm_delivered boolean,
  account_connected boolean,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
stable
as $$
begin
  if public.current_staff_role() not in ('moderator', 'admin', 'owner') then
    raise exception 'Active staff access is required.';
  end if;

  return query
  select
    moderation.id,
    moderation.case_number,
    moderation.discord_user_id,
    moderation.discord_username,
    moderation.discord_display_name,
    moderation.moderator_username,
    moderation.action_type,
    moderation.reason,
    moderation.duration_seconds,
    moderation.status,
    moderation.dm_delivered,
    moderation.applicant_id is not null as account_connected,
    moderation.created_at
  from public.moderation_cases moderation
  where moderation.appeal_submission_id is null
    and moderation.status in ('active', 'expired', 'closed')
    and moderation.action_type in ('warn', 'mute', 'kick', 'ban', 'automod')
  order by moderation.created_at desc
  limit 1000;
end;
$$;

create or replace function public.delete_pending_moderation_case(
  p_case_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  deleted_case_number text;
  deleted_discord_username text;
begin
  if public.current_staff_role() is distinct from 'owner' then
    raise exception 'Only the Owner can permanently delete an awaiting-appeal case.';
  end if;

  delete from public.moderation_cases
  where id = p_case_id
    and appeal_submission_id is null
  returning case_number, discord_username
  into deleted_case_number, deleted_discord_username;

  if deleted_case_number is null then
    raise exception 'Awaiting-appeal case not found. It may already have been appealed or removed.';
  end if;

  return jsonb_build_object(
    'deleted', true,
    'case_number', deleted_case_number,
    'discord_username', deleted_discord_username
  );
end;
$$;

revoke all on function public.staff_pending_moderation_cases() from public;
revoke all on function public.staff_pending_moderation_cases() from anon;
grant execute on function public.staff_pending_moderation_cases() to authenticated;

revoke all on function public.delete_pending_moderation_case(uuid) from public;
revoke all on function public.delete_pending_moderation_case(uuid) from anon;
grant execute on function public.delete_pending_moderation_case(uuid) to authenticated;

comment on function public.staff_pending_moderation_cases() is
  'Lists appealable ThyToxicBot moderation cases that have not become appeal submissions yet.';

comment on function public.delete_pending_moderation_case(uuid) is
  'Owner-only permanent deletion of an unsubmitted moderation case, immediately clearing it from the member appeal queue.';
