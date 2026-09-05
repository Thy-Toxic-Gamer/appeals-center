-- Final decisions are archived; deletion remains Owner-only.
begin;

create or replace function public.delete_archived_appeal(p_submission_id uuid)
returns jsonb language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  submission_number_to_delete text;
begin
  if public.current_staff_role() is distinct from 'owner' then
    raise exception 'Only the Owner can permanently delete archived appeals.';
  end if;
  select submission_number into submission_number_to_delete
  from public.appeal_submissions where id = p_submission_id for update;
  -- Lock case decisions before checking whether the whole submission is final.
  perform id from public.appeal_cases where submission_id = p_submission_id for update;
  if submission_number_to_delete is null
    or not exists (select 1 from public.appeal_cases where submission_id = p_submission_id)
    or exists (select 1 from public.appeal_cases where submission_id = p_submission_id
      and (status is null or status not in ('approved', 'denied', 'closed'))) then
    raise exception 'Archived appeal not found, or this submission still contains an active case.';
  end if;
  delete from public.appeal_submissions where id = p_submission_id;
  return jsonb_build_object('deleted', true, 'submission_number', submission_number_to_delete);
end;
$$;

create or replace function public.delete_archived_block_review(p_review_id uuid)
returns jsonb language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  target public.submission_block_reviews%rowtype;
begin
  if public.current_staff_role() is distinct from 'owner' then
    raise exception 'Only the Owner can permanently delete archived private reviews.';
  end if;
  select * into target from public.submission_block_reviews
  where id = p_review_id for update;
  if not found then
    raise exception 'Archived private review not found.';
  end if;
  if target.status is distinct from 'closed' then
    raise exception 'Close this private review before deleting it.';
  end if;
  -- Transcript messages cascade through their review_number foreign key.
  -- Blocks, audit events, and Discord threads are deliberately preserved.
  delete from public.submission_block_reviews where id = target.id;
  return jsonb_build_object('deleted', true, 'review_number', target.review_number);
end;
$$;

revoke all on function public.delete_archived_appeal(uuid) from public, anon;
grant execute on function public.delete_archived_appeal(uuid) to authenticated;
revoke all on function public.delete_archived_block_review(uuid) from public, anon;
grant execute on function public.delete_archived_block_review(uuid) to authenticated;
commit;
