-- Appeals & Tickets Center: six-month ticket retention and Owner-only archive deletion.
-- Closed tickets remain protected for six months before automatic removal.

alter table public.support_tickets
  add column if not exists purge_after timestamptz;

create or replace function public.apply_support_ticket_retention()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.status = 'closed' and old.status is distinct from new.status then
    new.closed_at := coalesce(new.closed_at, now());
    new.purge_after := new.closed_at + interval '6 months';
  elsif new.status <> 'closed' then
    new.purge_after := null;
  end if;
  return new;
end;
$$;

drop trigger if exists apply_support_ticket_retention on public.support_tickets;
create trigger apply_support_ticket_retention
before update of status on public.support_tickets
for each row execute function public.apply_support_ticket_retention();

update public.support_tickets
set purge_after = coalesce(closed_at, updated_at, now()) + interval '6 months'
where status = 'closed' and purge_after is null;

create or replace function public.purge_expired_support_tickets()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  deleted_count integer;
begin
  delete from public.support_tickets
  where status = 'closed'
    and purge_after is not null
    and purge_after <= now();
  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

revoke all on function public.purge_expired_support_tickets() from public;
revoke all on function public.purge_expired_support_tickets() from anon;
revoke all on function public.purge_expired_support_tickets() from authenticated;
grant execute on function public.purge_expired_support_tickets() to postgres;

create extension if not exists pg_cron;
select cron.schedule(
  'support-ticket-six-month-retention',
  '23 4 * * *',
  'select public.purge_expired_support_tickets();'
);
