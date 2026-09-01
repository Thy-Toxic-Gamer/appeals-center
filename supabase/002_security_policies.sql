-- Appeals Center: authentication helpers, permissions, and Row Level Security policies
-- Run after 001_initial_schema.sql.

create or replace function public.current_staff_role()
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select staff.role
  from public.staff_members staff
  where staff.user_id = auth.uid()
    and staff.active = true
  limit 1;
$$;

create or replace function public.is_active_staff()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.staff_members staff
    where staff.user_id = auth.uid()
      and staff.active = true
  );
$$;

create or replace function public.handle_new_appeals_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  new_display_name text;
begin
  new_display_name := coalesce(
    nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''),
    nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
    'Applicant'
  );

  insert into public.profiles (id, display_name)
  values (new.id, left(new_display_name, 60))
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists create_appeals_profile on auth.users;
create trigger create_appeals_profile
after insert on auth.users
for each row execute function public.handle_new_appeals_user();

create or replace function public.log_new_appeal_case()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.appeal_logs (
    case_id,
    actor_id,
    event_type,
    new_status,
    public_message
  )
  values (
    new.id,
    auth.uid(),
    'case_created',
    new.status,
    'Appeal submitted'
  );
  return new;
end;
$$;

drop trigger if exists cases_log_creation on public.appeal_cases;
create trigger cases_log_creation
after insert on public.appeal_cases
for each row execute function public.log_new_appeal_case();

revoke all on function public.current_staff_role() from public;
revoke all on function public.is_active_staff() from public;
grant execute on function public.current_staff_role() to authenticated;
grant execute on function public.is_active_staff() to authenticated;

revoke all on table public.profiles from anon, authenticated;
revoke all on table public.staff_members from anon, authenticated;
revoke all on table public.appeal_submissions from anon, authenticated;
revoke all on table public.appeal_cases from anon, authenticated;
revoke all on table public.appeal_messages from anon, authenticated;
revoke all on table public.staff_notes from anon, authenticated;
revoke all on table public.appeal_logs from anon, authenticated;

grant select on table public.profiles to authenticated;
grant update (display_name) on table public.profiles to authenticated;

grant select, insert, update, delete on table public.staff_members to authenticated;

grant select, insert, update on table public.appeal_submissions to authenticated;
grant select, insert, update on table public.appeal_cases to authenticated;
grant select, insert on table public.appeal_messages to authenticated;
grant select, insert, update, delete on table public.staff_notes to authenticated;
grant select on table public.appeal_logs to authenticated;

grant usage, select on sequence public.appeal_submission_number_seq to authenticated;
grant usage, select on sequence public.appeal_case_number_seq to authenticated;

drop policy if exists profiles_select_own_or_staff on public.profiles;
create policy profiles_select_own_or_staff
on public.profiles
for select
to authenticated
using (
  id = auth.uid()
  or public.is_active_staff()
);

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own
on public.profiles
for update
to authenticated
using (id = auth.uid())
with check (id = auth.uid());

drop policy if exists staff_members_select_staff on public.staff_members;
create policy staff_members_select_staff
on public.staff_members
for select
to authenticated
using (
  user_id = auth.uid()
  or public.is_active_staff()
);

drop policy if exists staff_members_owner_insert on public.staff_members;
create policy staff_members_owner_insert
on public.staff_members
for insert
to authenticated
with check (public.current_staff_role() = 'owner');

drop policy if exists staff_members_owner_update on public.staff_members;
create policy staff_members_owner_update
on public.staff_members
for update
to authenticated
using (public.current_staff_role() = 'owner')
with check (public.current_staff_role() = 'owner');

drop policy if exists staff_members_owner_delete on public.staff_members;
create policy staff_members_owner_delete
on public.staff_members
for delete
to authenticated
using (
  public.current_staff_role() = 'owner'
  and user_id <> auth.uid()
);

drop policy if exists submissions_select_own_or_staff on public.appeal_submissions;
create policy submissions_select_own_or_staff
on public.appeal_submissions
for select
to authenticated
using (
  applicant_id = auth.uid()
  or public.is_active_staff()
);

drop policy if exists submissions_insert_own on public.appeal_submissions;
create policy submissions_insert_own
on public.appeal_submissions
for insert
to authenticated
with check (
  applicant_id = auth.uid()
  and declaration_accepted = true
);

drop policy if exists submissions_staff_update on public.appeal_submissions;
create policy submissions_staff_update
on public.appeal_submissions
for update
to authenticated
using (public.is_active_staff())
with check (public.is_active_staff());

drop policy if exists cases_select_own_or_staff on public.appeal_cases;
create policy cases_select_own_or_staff
on public.appeal_cases
for select
to authenticated
using (
  public.is_active_staff()
  or exists (
    select 1
    from public.appeal_submissions submission
    where submission.id = appeal_cases.submission_id
      and submission.applicant_id = auth.uid()
  )
);

drop policy if exists cases_insert_own_submission on public.appeal_cases;
create policy cases_insert_own_submission
on public.appeal_cases
for insert
to authenticated
with check (
  exists (
    select 1
    from public.appeal_submissions submission
    where submission.id = appeal_cases.submission_id
      and submission.applicant_id = auth.uid()
  )
);

drop policy if exists cases_staff_update on public.appeal_cases;
create policy cases_staff_update
on public.appeal_cases
for update
to authenticated
using (public.is_active_staff())
with check (public.is_active_staff());

drop policy if exists messages_select_case_participants on public.appeal_messages;
create policy messages_select_case_participants
on public.appeal_messages
for select
to authenticated
using (
  public.is_active_staff()
  or exists (
    select 1
    from public.appeal_cases appeal_case
    join public.appeal_submissions submission
      on submission.id = appeal_case.submission_id
    where appeal_case.id = appeal_messages.case_id
      and submission.applicant_id = auth.uid()
  )
);

drop policy if exists messages_insert_case_participants on public.appeal_messages;
create policy messages_insert_case_participants
on public.appeal_messages
for insert
to authenticated
with check (
  author_id = auth.uid()
  and (
    (
      author_type = 'applicant'
      and exists (
        select 1
        from public.appeal_cases appeal_case
        join public.appeal_submissions submission
          on submission.id = appeal_case.submission_id
        where appeal_case.id = appeal_messages.case_id
          and submission.applicant_id = auth.uid()
      )
    )
    or (
      author_type = 'staff'
      and public.is_active_staff()
    )
  )
);

drop policy if exists staff_notes_select_staff on public.staff_notes;
create policy staff_notes_select_staff
on public.staff_notes
for select
to authenticated
using (public.is_active_staff());

drop policy if exists staff_notes_insert_staff on public.staff_notes;
create policy staff_notes_insert_staff
on public.staff_notes
for insert
to authenticated
with check (
  public.is_active_staff()
  and author_id = auth.uid()
);

drop policy if exists staff_notes_update_author_or_lead on public.staff_notes;
create policy staff_notes_update_author_or_lead
on public.staff_notes
for update
to authenticated
using (
  author_id = auth.uid()
  or public.current_staff_role() in ('admin', 'owner')
)
with check (public.is_active_staff());

drop policy if exists staff_notes_delete_lead on public.staff_notes;
create policy staff_notes_delete_lead
on public.staff_notes
for delete
to authenticated
using (public.current_staff_role() in ('admin', 'owner'));

drop policy if exists appeal_logs_select_public_or_staff on public.appeal_logs;
create policy appeal_logs_select_public_or_staff
on public.appeal_logs
for select
to authenticated
using (
  public.is_active_staff()
  or (
    public_message is not null
    and exists (
      select 1
      from public.appeal_cases appeal_case
      join public.appeal_submissions submission
        on submission.id = appeal_case.submission_id
      where appeal_case.id = appeal_logs.case_id
        and submission.applicant_id = auth.uid()
    )
  )
);
