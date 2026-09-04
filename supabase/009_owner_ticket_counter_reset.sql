-- Appeals Center: Owner-only reset for ThyToxicBot moderation ticket numbering.
-- Existing tickets are never deleted or renumbered. Numbers already in use are skipped.

create or replace function public.next_moderation_case_number()
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  candidate text;
begin
  loop
    candidate :=
      'TTG-MOD-' ||
      lpad(nextval('public.moderation_case_number_seq')::text, 6, '0');

    exit when not exists (
      select 1
      from public.moderation_cases moderation
      where moderation.case_number = candidate
    );
  end loop;

  return candidate;
end;
$$;

alter table public.moderation_cases
  alter column case_number
  set default public.next_moderation_case_number();

create or replace function public.reset_moderation_ticket_counter()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if public.current_staff_role() is distinct from 'owner' then
    raise exception 'Only the Owner can reset the moderation ticket counter.';
  end if;

  perform setval('public.moderation_case_number_seq', 1, false);

  return jsonb_build_object(
    'reset', true,
    'starting_number', 'TTG-MOD-000001'
  );
end;
$$;

revoke all on function public.next_moderation_case_number() from public, anon, authenticated;
grant execute on function public.next_moderation_case_number() to service_role;

revoke all on function public.reset_moderation_ticket_counter() from public, anon;
grant execute on function public.reset_moderation_ticket_counter() to authenticated;

comment on function public.next_moderation_case_number() is
  'Allocates the next available ThyToxicBot moderation case number, skipping numbers already in use.';

comment on function public.reset_moderation_ticket_counter() is
  'Owner-only reset of moderation ticket numbering to 000001 without deleting or renumbering existing cases.';
