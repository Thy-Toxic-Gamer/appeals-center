-- Appeals & Tickets Center: Discord ticket records, synchronized messages, events, and archives.
-- Run after the existing Appeals Center migrations.

create sequence if not exists public.support_ticket_number_seq start 1;

create or replace function public.next_support_ticket_number()
returns text
language sql
security definer
set search_path = public, pg_temp
as $$
  select 'TTG-TKT-' || lpad(nextval('public.support_ticket_number_seq')::text, 6, '0');
$$;

create table if not exists public.support_tickets (
  id uuid primary key default gen_random_uuid(),
  ticket_number text not null unique default public.next_support_ticket_number(),
  ticket_type text not null check (ticket_type in ('support', 'report', 'staff_inquiry', 'suggestion')),
  subject text not null check (char_length(subject) between 1 and 200),
  opening_message text not null check (char_length(opening_message) between 1 and 3000),
  status text not null default 'open' check (status in ('open', 'claimed', 'closed')),
  guild_id text not null,
  discord_channel_id text unique,
  discord_creator_id text not null,
  discord_creator_username text,
  discord_creator_display_name text,
  claimed_by_discord_id text,
  claimed_by_username text,
  claimed_at timestamptz,
  closed_by_discord_id text,
  closed_by_username text,
  close_summary text,
  closed_at timestamptz,
  transcript_text text,
  transcript_discord_message_id text,
  transcript_saved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.support_ticket_messages (
  id bigint generated always as identity primary key,
  ticket_id uuid not null references public.support_tickets(id) on delete cascade,
  discord_message_id text unique,
  author_discord_id text not null,
  author_username text,
  author_display_name text,
  author_type text not null check (author_type in ('member', 'staff', 'bot')),
  content text not null default '',
  attachments jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.support_ticket_events (
  id bigint generated always as identity primary key,
  ticket_id uuid not null references public.support_tickets(id) on delete cascade,
  event_type text not null check (event_type in ('opened', 'claimed', 'message_saved', 'closed', 'transcript_saved', 'discord_channel_deleted', 'error')),
  actor_discord_id text,
  actor_username text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists support_tickets_status_type_idx
  on public.support_tickets(status, ticket_type, created_at desc);
create index if not exists support_tickets_creator_idx
  on public.support_tickets(discord_creator_id, created_at desc);
create index if not exists support_ticket_messages_ticket_idx
  on public.support_ticket_messages(ticket_id, created_at);
create index if not exists support_ticket_events_ticket_idx
  on public.support_ticket_events(ticket_id, created_at);

create or replace function public.touch_support_ticket()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists touch_support_ticket on public.support_tickets;
create trigger touch_support_ticket
before update on public.support_tickets
for each row execute function public.touch_support_ticket();

create or replace function public.current_discord_user_id()
returns text
language sql
stable
security definer
set search_path = public, auth, pg_temp
as $$
  select coalesce(
    (
      select nullif(identity.identity_data ->> 'sub', '')
      from auth.identities identity
      where identity.user_id = auth.uid()
        and identity.provider = 'discord'
      order by identity.created_at desc
      limit 1
    ),
    (
      select nullif(identity.provider_id, '')
      from auth.identities identity
      where identity.user_id = auth.uid()
        and identity.provider = 'discord'
      order by identity.created_at desc
      limit 1
    )
  );
$$;

alter table public.support_tickets enable row level security;
alter table public.support_ticket_messages enable row level security;
alter table public.support_ticket_events enable row level security;

drop policy if exists support_tickets_staff_read on public.support_tickets;
create policy support_tickets_staff_read
on public.support_tickets for select to authenticated
using (
  public.current_staff_role() in ('moderator', 'admin', 'owner')
  or discord_creator_id = public.current_discord_user_id()
);

drop policy if exists support_ticket_messages_staff_read on public.support_ticket_messages;
create policy support_ticket_messages_staff_read
on public.support_ticket_messages for select to authenticated
using (
  exists (
    select 1 from public.support_tickets ticket
    where ticket.id = support_ticket_messages.ticket_id
      and (
        public.current_staff_role() in ('moderator', 'admin', 'owner')
        or ticket.discord_creator_id = public.current_discord_user_id()
      )
  )
);

drop policy if exists support_ticket_events_staff_read on public.support_ticket_events;
create policy support_ticket_events_staff_read
on public.support_ticket_events for select to authenticated
using (
  exists (
    select 1 from public.support_tickets ticket
    where ticket.id = support_ticket_events.ticket_id
      and (
        public.current_staff_role() in ('moderator', 'admin', 'owner')
        or ticket.discord_creator_id = public.current_discord_user_id()
      )
  )
);

create or replace function public.staff_claim_support_ticket(
  p_ticket_id uuid,
  p_discord_staff_id text,
  p_discord_staff_username text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  role_value text := public.current_staff_role();
  updated_ticket public.support_tickets%rowtype;
begin
  if role_value not in ('moderator', 'admin', 'owner') then
    raise exception 'Active staff access is required.';
  end if;

  update public.support_tickets
  set status = 'claimed',
      claimed_by_discord_id = nullif(trim(p_discord_staff_id), ''),
      claimed_by_username = nullif(trim(p_discord_staff_username), ''),
      claimed_at = coalesce(claimed_at, now())
  where id = p_ticket_id and status in ('open', 'claimed')
  returning * into updated_ticket;

  if not found then
    raise exception 'Open ticket not found.';
  end if;

  insert into public.support_ticket_events (
    ticket_id, event_type, actor_discord_id, actor_username
  ) values (
    updated_ticket.id, 'claimed', updated_ticket.claimed_by_discord_id, updated_ticket.claimed_by_username
  );

  return jsonb_build_object(
    'id', updated_ticket.id,
    'ticket_number', updated_ticket.ticket_number,
    'status', updated_ticket.status
  );
end;
$$;

create or replace function public.owner_delete_archived_ticket(p_ticket_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  role_value text := public.current_staff_role();
  deleted_number text;
begin
  if role_value is distinct from 'owner' then
    raise exception 'Only the Owner can permanently delete archived tickets.';
  end if;

  delete from public.support_tickets
  where id = p_ticket_id and status = 'closed'
  returning ticket_number into deleted_number;

  if deleted_number is null then
    raise exception 'Archived ticket not found.';
  end if;

  return jsonb_build_object('deleted', true, 'ticket_number', deleted_number);
end;
$$;

revoke all on table public.support_tickets from anon;
revoke all on table public.support_ticket_messages from anon;
revoke all on table public.support_ticket_events from anon;
grant select on public.support_tickets to authenticated;
grant select on public.support_ticket_messages to authenticated;
grant select on public.support_ticket_events to authenticated;

revoke all on function public.current_discord_user_id() from public;
grant execute on function public.current_discord_user_id() to authenticated;
revoke all on function public.staff_claim_support_ticket(uuid, text, text) from public;
grant execute on function public.staff_claim_support_ticket(uuid, text, text) to authenticated;
revoke all on function public.owner_delete_archived_ticket(uuid) from public;
grant execute on function public.owner_delete_archived_ticket(uuid) to authenticated;
