-- Appeals, Tickets & TTS Records Center: production repair for Owner Clear All.
-- Supabase requires an explicit WHERE clause for destructive queries.

begin;

create or replace function public.owner_clear_tts_records()
returns jsonb language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  deleted_count integer;
begin
  if public.current_staff_role() is distinct from 'owner' then
    raise exception 'Only the Owner can permanently clear TTS records.';
  end if;

  delete from public.tts_records where id is not null;
  get diagnostics deleted_count = row_count;
  return jsonb_build_object('deleted', true, 'count', deleted_count);
end;
$$;

revoke all on function public.owner_clear_tts_records() from public, anon;
grant execute on function public.owner_clear_tts_records() to authenticated;

commit;
