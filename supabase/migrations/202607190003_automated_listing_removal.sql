begin;

create table public.listing_removal_batches (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null unique references public.listing_reports(id),
  listing_id text not null unique
    check (listing_id ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  status text not null default 'preparing'
    check (status in ('preparing', 'validating', 'merging', 'removed', 'failed')),
  created_by uuid not null references auth.users(id),
  github_branch text,
  github_pr_number integer,
  github_pr_url text,
  github_head_sha text,
  github_merge_sha text,
  last_error_code text,
  deployment_requested_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  merged_at timestamptz,
  removed_at timestamptz
);

create index listing_removal_batches_reconciliation
  on public.listing_removal_batches (status, updated_at);

create trigger listing_removal_batches_touch_updated_at
before update on public.listing_removal_batches
for each row execute function public.touch_updated_at();

create or replace function public.resolve_listing_report(
  p_report_id uuid,
  p_moderator_id uuid,
  p_decision text,
  p_notes text default null
) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_listing_id text;
  v_removal_batch_id uuid;
  v_removal_queued boolean := false;
begin
  if not exists (
    select 1 from public.moderator_profiles
    where user_id = p_moderator_id and active = true
  ) then
    raise exception 'moderator access required';
  end if;
  if p_decision not in ('upheld', 'dismissed') then
    raise exception 'invalid report decision';
  end if;

  select listing_id into v_listing_id
  from public.listing_reports
  where id = p_report_id and status in ('open', 'reviewing')
  for update;
  if v_listing_id is null then raise exception 'open report not found'; end if;

  update public.listing_reports
  set status = p_decision,
      assigned_to = p_moderator_id,
      resolution_notes = nullif(trim(p_notes), ''),
      resolved_at = now()
  where id = p_report_id;

  if p_decision = 'upheld' then
    insert into public.listing_moderation_state (
      listing_id, removed, removal_report_id, updated_by
    ) values (
      v_listing_id, true, p_report_id, p_moderator_id
    ) on conflict (listing_id) do update set
      removed = true,
      removal_report_id = excluded.removal_report_id,
      updated_by = excluded.updated_by,
      updated_at = now();

    insert into public.listing_removal_batches (
      report_id, listing_id, created_by
    ) values (
      p_report_id, v_listing_id, p_moderator_id
    ) on conflict (listing_id) do nothing
    returning id into v_removal_batch_id;
    v_removal_queued := v_removal_batch_id is not null;

    if v_removal_batch_id is null then
      select id into v_removal_batch_id
      from public.listing_removal_batches
      where listing_id = v_listing_id;
    end if;
  end if;

  insert into public.moderation_actions (
    moderator_id, action, reason, notes, metadata
  ) values (
    p_moderator_id,
    case when p_decision = 'upheld' then 'report_upheld' else 'report_dismissed' end,
    p_decision,
    nullif(trim(p_notes), ''),
    jsonb_strip_nulls(jsonb_build_object(
      'report_id', p_report_id,
      'listing_id', v_listing_id,
      'removal_batch_id', v_removal_batch_id
    ))
  );

  if v_removal_queued then
    insert into public.moderation_actions (
      moderator_id, action, reason, metadata
    ) values (
      p_moderator_id,
      'listing_removal_queued',
      'Queued for validated PerkCommons/data removal',
      jsonb_build_object(
        'report_id', p_report_id,
        'listing_id', v_listing_id,
        'removal_batch_id', v_removal_batch_id
      )
    );
  end if;

  return v_listing_id;
end;
$$;

create or replace function public.finalize_listing_removal_batch(
  p_batch_id uuid,
  p_merge_sha text
) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_batch public.listing_removal_batches%rowtype;
begin
  select * into v_batch
  from public.listing_removal_batches
  where id = p_batch_id
  for update;
  if v_batch.id is null then raise exception 'listing removal batch not found'; end if;
  if v_batch.status = 'removed' then return v_batch.listing_id; end if;
  if v_batch.status not in ('preparing', 'validating', 'merging') then
    raise exception 'listing removal batch is not ready to finalize';
  end if;

  update public.listing_moderation_state
  set removed = true,
      featured = false,
      updated_by = v_batch.created_by,
      updated_at = now()
  where listing_id = v_batch.listing_id;

  insert into public.moderation_actions (
    moderator_id, action, reason, metadata
  ) values (
    v_batch.created_by,
    'listing_removed_from_data',
    'Validated PerkCommons/data removal',
    jsonb_strip_nulls(jsonb_build_object(
      'report_id', v_batch.report_id,
      'listing_id', v_batch.listing_id,
      'removal_batch_id', v_batch.id,
      'github_pr_number', v_batch.github_pr_number,
      'merge_sha', p_merge_sha
    ))
  );

  update public.listing_removal_batches
  set status = 'removed',
      github_merge_sha = p_merge_sha,
      merged_at = coalesce(merged_at, now()),
      removed_at = now(),
      last_error_code = null
  where id = p_batch_id;
  return v_batch.listing_id;
end;
$$;

-- Queue reports upheld before this migration so existing suppressed listings
-- are also removed from the Git-owned public dataset.
insert into public.listing_removal_batches (
  report_id, listing_id, created_by
)
select reports.id, reports.listing_id, reports.assigned_to
from public.listing_reports as reports
inner join public.listing_moderation_state as state
  on state.listing_id = reports.listing_id and state.removed = true
where reports.status = 'upheld'
  and reports.assigned_to is not null
on conflict (listing_id) do nothing;

alter table public.listing_removal_batches enable row level security;
revoke all on public.listing_removal_batches from public, anon, authenticated;
revoke execute on function public.finalize_listing_removal_batch(uuid, text)
  from public, anon, authenticated;
grant execute on function public.finalize_listing_removal_batch(uuid, text)
  to service_role;

commit;
