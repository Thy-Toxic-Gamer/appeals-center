-- Appeals, Tickets & TTS Records Center: protected TTS history.
-- Free / Channel Points, Bits, and Donations use one identical record format.

begin;

create table if not exists public.tts_records (
  id uuid primary key default gen_random_uuid(),
  source_event_id text not null unique check (char_length(source_event_id) between 1 and 200),
  source_key text,
  queue_number bigint not null check (queue_number > 0),
  tts_type text not null check (tts_type in ('free', 'bits', 'donations')),
  status text not null check (status in ('completed', 'blocked', 'interrupted')),
  status_note text not null default '',
  sender text not null check (char_length(sender) between 1 and 200),
  platform text not null check (char_length(platform) between 1 and 100),
  contribution text not null check (char_length(contribution) between 1 and 200),
  transcript text not null check (char_length(transcript) between 1 and 10000),
  received_at timestamptz not null,
  started_at timestamptz,
  ended_at timestamptz not null,
  stream_id text,
  twitch_vod_url text,
  twitch_vod_note text,
  discord_channel_id text,
  discord_message_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  purge_after timestamptz not null default (now() + interval '1 year')
);

create index if not exists tts_records_created_idx on public.tts_records(created_at desc);
create index if not exists tts_records_type_created_idx on public.tts_records(tts_type, created_at desc);
create index if not exists tts_records_status_created_idx on public.tts_records(status, created_at desc);
create index if not exists tts_records_sender_idx on public.tts_records(lower(sender));

create or replace function public.protect_tts_record_retention()
returns trigger language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    new.created_at := coalesce(new.created_at, now());
    new.purge_after := new.created_at + interval '1 year';
  else
    new.created_at := old.created_at;
    new.purge_after := old.purge_after;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists protect_tts_record_retention on public.tts_records;
create trigger protect_tts_record_retention
before insert or update on public.tts_records
for each row execute function public.protect_tts_record_retention();

alter table public.tts_records enable row level security;

drop policy if exists tts_records_staff_read on public.tts_records;
create policy tts_records_staff_read
on public.tts_records for select to authenticated
using (public.current_staff_role() in ('moderator', 'admin', 'owner'));

revoke all on table public.tts_records from public, anon;
grant select on table public.tts_records to authenticated;
grant select, insert, update on table public.tts_records to service_role;

create or replace function public.owner_delete_tts_record(p_record_id uuid)
returns jsonb language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  deleted_number bigint;
begin
  if public.current_staff_role() is distinct from 'owner' then
    raise exception 'Only the Owner can permanently delete TTS records.';
  end if;
  delete from public.tts_records where id = p_record_id returning queue_number into deleted_number;
  if deleted_number is null then raise exception 'TTS record not found.'; end if;
  return jsonb_build_object('deleted', true, 'queue_number', deleted_number);
end;
$$;

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
  -- Keep an explicit predicate so Supabase's destructive-query guard permits
  -- the Owner-only clear operation while still selecting every record.
  delete from public.tts_records where id is not null;
  get diagnostics deleted_count = row_count;
  return jsonb_build_object('deleted', true, 'count', deleted_count);
end;
$$;

create or replace function public.purge_expired_tts_records()
returns integer language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  deleted_count integer;
begin
  delete from public.tts_records where purge_after <= now();
  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

revoke all on function public.owner_delete_tts_record(uuid) from public, anon;
grant execute on function public.owner_delete_tts_record(uuid) to authenticated;
revoke all on function public.owner_clear_tts_records() from public, anon;
grant execute on function public.owner_clear_tts_records() to authenticated;
revoke all on function public.purge_expired_tts_records() from public, anon, authenticated;
grant execute on function public.purge_expired_tts_records() to postgres;

create extension if not exists pg_cron;
do $$
declare existing_job bigint;
begin
  for existing_job in select jobid from cron.job where jobname = 'tts-records-one-year-retention'
  loop
    perform cron.unschedule(existing_job);
  end loop;
  perform cron.schedule(
    'tts-records-one-year-retention',
    '41 4 * * *',
    'select public.purge_expired_tts_records();'
  );
end;
$$;

commit;
