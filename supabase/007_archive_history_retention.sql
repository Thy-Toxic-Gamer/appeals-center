-- Appeals Center: searchable history support, Owner archive deletion, and one-year retention.
-- Run after 006_owner_test_tickets.sql.

create or replace function public.apply_case_retention()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.status = 'closed'
     and old.status is distinct from new.status then
    new.closed_at := now();
    new.purge_after := new.closed_at + interval '1 year';
    new.decided_at := coalesce(new.decided_at, now());
  elsif new.status in ('approved', 'denied')
        and old.status is distinct from new.status then
    new.decided_at := coalesce(new.decided_at, now());
    new.closed_at := null;
    new.purge_after := null;
  elsif new.status not in ('approved', 'denied', 'closed') then
    new.closed_at := null;
    new.purge_after := null;
  end if;
  return new;
end;
$$;

-- Existing archived cases receive a full year from their recorded close date.
update public.appeal_cases
set
  closed_at = coalesce(closed_at, now()),
  purge_after = coalesce(closed_at, now()) + interval '1 year'
where status = 'closed';

-- Approved and denied cases remain active records until staff explicitly closes them.
update public.appeal_cases
set
  closed_at = null,
  purge_after = null
where status in ('approved', 'denied');

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
  where status = 'closed'
    and purge_after is not null
    and purge_after <= now();

  get diagnostics deleted_cases = row_count;

  delete from public.appeal_submissions submission
  where not exists (
    select 1
    from public.appeal_cases appeal_case
    where appeal_case.submission_id = submission.id
  )
  and submission.created_at <= now() - interval '1 year';

  return deleted_cases;
end;
$$;

create or replace function public.delete_archived_appeal(
  p_submission_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  staff_role text := public.current_staff_role();
  deleted_submission_number text;
begin
  if staff_role is distinct from 'owner' then
    raise exception 'Only the Owner can permanently delete archived appeals.';
  end if;

  select submission.submission_number
  into deleted_submission_number
  from public.appeal_submissions submission
  where submission.id = p_submission_id
    and exists (
      select 1
      from public.appeal_cases appeal_case
      where appeal_case.submission_id = submission.id
    )
    and not exists (
      select 1
      from public.appeal_cases appeal_case
      where appeal_case.submission_id = submission.id
        and appeal_case.status <> 'closed'
    )
  for update;

  if deleted_submission_number is null then
    raise exception 'Archived appeal not found, or this submission still contains an active case.';
  end if;

  delete from public.appeal_submissions
  where id = p_submission_id;

  return jsonb_build_object(
    'deleted', true,
    'submission_number', deleted_submission_number
  );
end;
$$;

revoke all on function public.purge_expired_appeals() from public;
revoke all on function public.purge_expired_appeals() from anon;
revoke all on function public.purge_expired_appeals() from authenticated;
grant execute on function public.purge_expired_appeals() to postgres;

revoke all on function public.delete_archived_appeal(uuid) from public;
revoke all on function public.delete_archived_appeal(uuid) from anon;
grant execute on function public.delete_archived_appeal(uuid) to authenticated;

comment on function public.delete_archived_appeal(uuid) is
  'Owner-only permanent deletion for an appeal whose cases are all archived.';

-- Run retention automatically every day at 04:17 UTC.
create extension if not exists pg_cron;

select cron.schedule(
  'appeals-retention-daily',
  '17 4 * * *',
  'select public.purge_expired_appeals();'
);
