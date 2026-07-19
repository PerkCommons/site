begin;

create table public.publication_batches (
  id uuid primary key default gen_random_uuid(),
  status text not null default 'preparing'
    check (status in ('preparing', 'validating', 'merging', 'published', 'failed')),
  created_by uuid not null references auth.users(id),
  item_count integer not null default 0 check (item_count >= 0),
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
  published_at timestamptz
);

create table public.publication_batch_items (
  batch_id uuid not null references public.publication_batches(id) on delete cascade,
  submission_id uuid not null references public.opportunity_submissions(id),
  listing_id text check (
    listing_id is null or listing_id ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
  ),
  created_at timestamptz not null default now(),
  primary key (batch_id, submission_id)
);

create index publication_batches_reconciliation
  on public.publication_batches (status, updated_at);
create index publication_batch_items_submission
  on public.publication_batch_items (submission_id);

create trigger publication_batches_touch_updated_at
before update on public.publication_batches
for each row execute function public.touch_updated_at();

create or replace function public.begin_publication_batch(
  p_moderator_id uuid
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_batch_id uuid;
  v_item_count integer;
begin
  if not exists (
    select 1 from public.moderator_profiles
    where user_id = p_moderator_id and role = 'admin' and active = true
  ) then
    raise exception 'administrator access required';
  end if;

  perform pg_advisory_xact_lock(hashtext('perkcommons-publication-batch'));

  select id into v_batch_id
  from public.publication_batches
  where status in ('preparing', 'validating', 'merging')
  order by created_at asc
  limit 1;
  if v_batch_id is not null then return v_batch_id; end if;

  insert into public.publication_batches (created_by)
  values (p_moderator_id)
  returning id into v_batch_id;

  insert into public.publication_batch_items (batch_id, submission_id)
  select v_batch_id, submissions.id
  from public.opportunity_submissions as submissions
  inner join public.normalized_opportunities as normalized
    on normalized.submission_id = submissions.id
  where submissions.status = 'approved'
  order by submissions.reviewed_at asc nulls last, submissions.created_at asc;
  get diagnostics v_item_count = row_count;

  if v_item_count = 0 then
    delete from public.publication_batches where id = v_batch_id;
    return null;
  end if;

  update public.publication_batches
  set item_count = v_item_count
  where id = v_batch_id;

  insert into public.moderation_actions (
    submission_id, moderator_id, action, reason, previous_status, new_status,
    metadata
  )
  select
    items.submission_id,
    p_moderator_id,
    'publication_queued',
    'Queued for validated PerkCommons/data publication',
    'approved',
    'approved',
    jsonb_build_object('publication_batch_id', v_batch_id)
  from public.publication_batch_items as items
  where items.batch_id = v_batch_id;
  return v_batch_id;
end;
$$;

create or replace function public.publication_batch_payload(
  p_batch_id uuid
) returns table (
  submission_id uuid,
  title text,
  organization text,
  primary_category text,
  subcategories text[],
  tags text[],
  description text,
  eligibility text,
  benefits text,
  location text,
  deadline date,
  source_url text,
  organization_website_url text
)
language sql
security definer
set search_path = public
as $$
  select
    items.submission_id,
    normalized.title,
    normalized.organization,
    normalized.primary_category,
    normalized.subcategories,
    normalized.tags,
    normalized.description,
    normalized.eligibility,
    normalized.benefits,
    normalized.location,
    normalized.deadline,
    normalized.source_url,
    normalized.organization_website_url
  from public.publication_batch_items as items
  inner join public.normalized_opportunities as normalized
    on normalized.submission_id = items.submission_id
  where items.batch_id = p_batch_id
  order by normalized.organization, normalized.title, items.submission_id;
$$;

create or replace function public.finalize_publication_batch(
  p_batch_id uuid,
  p_merge_sha text
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_batch public.publication_batches%rowtype;
  v_count integer;
begin
  select * into v_batch
  from public.publication_batches
  where id = p_batch_id
  for update;
  if v_batch.id is null then raise exception 'publication batch not found'; end if;
  if v_batch.status = 'published' then return v_batch.item_count; end if;
  if v_batch.status not in ('validating', 'merging') then
    raise exception 'publication batch is not ready to finalize';
  end if;
  if exists (
    select 1 from public.publication_batch_items
    where batch_id = p_batch_id and listing_id is null
  ) then
    raise exception 'publication batch contains incomplete items';
  end if;

  insert into public.moderation_actions (
    submission_id, moderator_id, action, reason, previous_status, new_status,
    metadata
  )
  select
    submissions.id,
    v_batch.created_by,
    'publish',
    'Validated PerkCommons/data publication batch',
    submissions.status,
    'published',
    jsonb_build_object(
      'publication_batch_id', p_batch_id,
      'github_pr_number', v_batch.github_pr_number,
      'listing_id', items.listing_id,
      'merge_sha', p_merge_sha
    )
  from public.opportunity_submissions as submissions
  inner join public.publication_batch_items as items
    on items.submission_id = submissions.id
  where items.batch_id = p_batch_id and submissions.status = 'approved';

  update public.opportunity_submissions as submissions
  set status = 'published',
      published_at = now(),
      last_action_at = now()
  from public.publication_batch_items as items
  where items.batch_id = p_batch_id
    and items.submission_id = submissions.id
    and submissions.status = 'approved';
  get diagnostics v_count = row_count;

  update public.publication_batches
  set status = 'published',
      github_merge_sha = p_merge_sha,
      merged_at = coalesce(merged_at, now()),
      published_at = now(),
      last_error_code = null
  where id = p_batch_id;
  return v_count;
end;
$$;

alter table public.publication_batches enable row level security;
alter table public.publication_batch_items enable row level security;
revoke all on public.publication_batches, public.publication_batch_items
  from public, anon, authenticated;
revoke execute on function public.begin_publication_batch(uuid)
  from public, anon, authenticated;
revoke execute on function public.publication_batch_payload(uuid)
  from public, anon, authenticated;
revoke execute on function public.finalize_publication_batch(uuid, text)
  from public, anon, authenticated;
grant execute on function public.begin_publication_batch(uuid) to service_role;
grant execute on function public.publication_batch_payload(uuid) to service_role;
grant execute on function public.finalize_publication_batch(uuid, text)
  to service_role;

commit;
