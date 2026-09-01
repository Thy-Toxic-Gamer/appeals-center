-- Appeals Center: protected staff case actions, private notes, and audit entries.
-- Run after 004_rename_overseer_to_admin.sql.

drop policy if exists cases_staff_update on public.appeal_cases;
create policy cases_staff_update
on public.appeal_cases
for update
to authenticated
using (public.current_staff_role() in ('admin', 'owner'))
with check (public.current_staff_role() in ('admin', 'owner'));

create or replace function public.staff_manage_case(
  p_case_id uuid,
  p_status text,
  p_public_update text,
  p_decision_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  staff_role text := public.current_staff_role();
  existing_case public.appeal_cases%rowtype;
  updated_case public.appeal_cases%rowtype;
  clean_public_update text := nullif(trim(p_public_update), '');
  clean_decision_reason text := nullif(trim(p_decision_reason), '');
begin
  if staff_role not in ('admin', 'owner') then
    raise exception 'Only an Owner or Admin can change case decisions.';
  end if;

  if p_status not in (
    'submitted',
    'under_review',
    'needs_information',
    'approved',
    'denied',
    'closed'
  ) then
    raise exception 'Invalid case status.';
  end if;

  if char_length(coalesce(clean_public_update, '')) > 3000
     or char_length(coalesce(clean_decision_reason, '')) > 3000 then
    raise exception 'Case updates must be 3000 characters or fewer.';
  end if;

  if p_status in ('needs_information', 'approved', 'denied', 'closed')
     and char_length(coalesce(clean_public_update, '')) < 5 then
    raise exception 'Add an applicant-visible update before using this status.';
  end if;

  if p_status in ('approved', 'denied')
     and char_length(coalesce(clean_decision_reason, '')) < 5 then
    raise exception 'Add a decision reason before approving or denying a case.';
  end if;

  select *
  into existing_case
  from public.appeal_cases
  where id = p_case_id
  for update;

  if not found then
    raise exception 'Appeal case not found.';
  end if;

  update public.appeal_cases
  set
    status = p_status,
    applicant_update = case
      when clean_public_update is not null then clean_public_update
      else applicant_update
    end,
    decision_reason = case
      when p_status in ('approved', 'denied', 'closed') then clean_decision_reason
      else null
    end,
    decided_by = case
      when p_status in ('approved', 'denied', 'closed') then auth.uid()
      else null
    end,
    assigned_to = case
      when p_status in ('under_review', 'needs_information') then coalesce(assigned_to, auth.uid())
      else assigned_to
    end
  where id = p_case_id
  returning * into updated_case;

  if existing_case.status = updated_case.status
     and clean_public_update is not null
     and clean_public_update is distinct from existing_case.applicant_update then
    insert into public.appeal_logs (
      case_id,
      actor_id,
      event_type,
      old_status,
      new_status,
      public_message
    )
    values (
      updated_case.id,
      auth.uid(),
      'applicant_update',
      existing_case.status,
      updated_case.status,
      clean_public_update
    );
  end if;

  return jsonb_build_object(
    'id', updated_case.id,
    'case_number', updated_case.case_number,
    'status', updated_case.status,
    'closed_at', updated_case.closed_at,
    'purge_after', updated_case.purge_after
  );
end;
$$;

create or replace function public.add_staff_note(
  p_case_id uuid,
  p_note text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  staff_role text := public.current_staff_role();
  clean_note text := nullif(trim(p_note), '');
  new_note public.staff_notes%rowtype;
begin
  if staff_role not in ('moderator', 'admin', 'owner') then
    raise exception 'Active staff access is required.';
  end if;

  if clean_note is null or char_length(clean_note) not between 1 and 3000 then
    raise exception 'Private notes must be between 1 and 3000 characters.';
  end if;

  if not exists (select 1 from public.appeal_cases where id = p_case_id) then
    raise exception 'Appeal case not found.';
  end if;

  insert into public.staff_notes (case_id, author_id, note)
  values (p_case_id, auth.uid(), clean_note)
  returning * into new_note;

  insert into public.appeal_logs (
    case_id,
    actor_id,
    event_type,
    private_details
  )
  values (
    p_case_id,
    auth.uid(),
    'staff_note_added',
    jsonb_build_object('note_id', new_note.id)
  );

  return jsonb_build_object(
    'id', new_note.id,
    'case_id', new_note.case_id,
    'created_at', new_note.created_at
  );
end;
$$;

revoke all on function public.staff_manage_case(uuid, text, text, text) from public;
revoke all on function public.staff_manage_case(uuid, text, text, text) from anon;
grant execute on function public.staff_manage_case(uuid, text, text, text) to authenticated;

revoke all on function public.add_staff_note(uuid, text) from public;
revoke all on function public.add_staff_note(uuid, text) from anon;
grant execute on function public.add_staff_note(uuid, text) to authenticated;
