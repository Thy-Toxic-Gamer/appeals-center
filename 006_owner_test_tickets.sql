-- Appeals Center: Owner-only test ticket creation and deletion.
-- Run after 005_staff_case_controls.sql.

alter table public.appeal_submissions
  add column if not exists is_test boolean not null default false;

create index if not exists appeal_submissions_test_idx
  on public.appeal_submissions(is_test, created_at desc)
  where is_test = true;

create or replace function public.create_test_appeal()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  staff_role text := public.current_staff_role();
  new_submission public.appeal_submissions%rowtype;
  new_case public.appeal_cases%rowtype;
  test_username text;
begin
  if staff_role is distinct from 'owner' then
    raise exception 'Only the Owner can create test tickets.';
  end if;

  select coalesce(nullif(trim(profile.username), ''), 'test-account')
  into test_username
  from public.profiles profile
  where profile.id = auth.uid();

  test_username := coalesce(test_username, 'test-account');

  insert into public.appeal_submissions (
    applicant_id,
    appeal_mode,
    display_name,
    explanation,
    declaration_accepted,
    is_test
  )
  values (
    auth.uid(),
    'individual',
    'Test Applicant',
    'This is an Owner-created test ticket used to verify the Appeals Center workflow and staff controls.',
    true,
    true
  )
  returning * into new_submission;

  insert into public.appeal_cases (
    submission_id,
    platform,
    action_type,
    platform_username,
    moderation_reason
  )
  values (
    new_submission.id,
    'twitch',
    'Other moderation action',
    test_username,
    'Owner-created test ticket'
  )
  returning * into new_case;

  return jsonb_build_object(
    'submission_id', new_submission.id,
    'submission_number', new_submission.submission_number,
    'case_id', new_case.id,
    'case_number', new_case.case_number
  );
end;
$$;

create or replace function public.delete_test_appeal(
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
    raise exception 'Only the Owner can delete test tickets.';
  end if;

  delete from public.appeal_submissions
  where id = p_submission_id
    and is_test = true
  returning submission_number into deleted_submission_number;

  if deleted_submission_number is null then
    raise exception 'Test ticket not found. Real appeals cannot be deleted with this control.';
  end if;

  return jsonb_build_object(
    'deleted', true,
    'submission_number', deleted_submission_number
  );
end;
$$;

revoke all on function public.create_test_appeal() from public;
revoke all on function public.create_test_appeal() from anon;
grant execute on function public.create_test_appeal() to authenticated;

revoke all on function public.delete_test_appeal(uuid) from public;
revoke all on function public.delete_test_appeal(uuid) from anon;
grant execute on function public.delete_test_appeal(uuid) to authenticated;

-- One-time cleanup authorized by the Owner after the completed end-to-end test.
delete from public.appeal_submissions
where submission_number = 'APL-2026-000001'
  and applicant_id = '2192e6e7-0ed0-4669-a1c8-4dab9d0d0aa5'::uuid;
