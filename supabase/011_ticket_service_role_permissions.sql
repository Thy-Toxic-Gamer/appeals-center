-- Allow the private Supabase service role used by ThyToxicBot to manage ticket records.
-- Public and authenticated user access remains controlled by RLS policies.

grant select, insert, update, delete on public.support_tickets to service_role;
grant select, insert, update, delete on public.support_ticket_messages to service_role;
grant select, insert, update, delete on public.support_ticket_events to service_role;
grant usage, select on sequence public.support_ticket_number_seq to service_role;
grant usage, select on all sequences in schema public to service_role;
