-- Appeals Center: rename the Overseer staff role to Admin.
-- Run after 003_live_appeals.sql.

alter table public.staff_members
  drop constraint if exists staff_members_role_check;

update public.staff_members
set role = 'admin',
    updated_at = now()
where role = 'overseer';

alter table public.staff_members
  add constraint staff_members_role_check
  check (role in ('moderator', 'admin', 'owner'));

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
