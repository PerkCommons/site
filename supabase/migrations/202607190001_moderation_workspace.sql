begin;

alter table public.listing_reports
  add column if not exists resolution_notes text;
alter table public.listing_reports
  drop constraint if exists listing_reports_status_check;
update public.listing_reports
set status = 'dismissed'
where status = 'resolved';
alter table public.listing_reports
  add constraint listing_reports_status_check
  check (status in ('open', 'reviewing', 'upheld', 'dismissed'));

create table if not exists public.listing_moderation_state (
  listing_id text primary key check (listing_id ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  featured boolean not null default false,
  removed boolean not null default false,
  removal_report_id uuid references public.listing_reports(id) on delete set null,
  updated_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists listing_moderation_state_touch_updated_at
  on public.listing_moderation_state;
create trigger listing_moderation_state_touch_updated_at
before update on public.listing_moderation_state
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
  end if;

  insert into public.moderation_actions (
    moderator_id, action, reason, notes, metadata
  ) values (
    p_moderator_id,
    case when p_decision = 'upheld' then 'report_upheld' else 'report_dismissed' end,
    p_decision,
    nullif(trim(p_notes), ''),
    jsonb_build_object('report_id', p_report_id, 'listing_id', v_listing_id)
  );
  return v_listing_id;
end;
$$;

create or replace function public.set_listing_featured(
  p_listing_id text,
  p_moderator_id uuid,
  p_featured boolean
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.moderator_profiles
    where user_id = p_moderator_id and active = true
  ) then
    raise exception 'moderator access required';
  end if;
  if p_listing_id !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' then
    raise exception 'invalid listing identifier';
  end if;

  insert into public.listing_moderation_state (
    listing_id, featured, updated_by
  ) values (
    p_listing_id, p_featured, p_moderator_id
  ) on conflict (listing_id) do update set
    featured = excluded.featured,
    updated_by = excluded.updated_by,
    updated_at = now();

  insert into public.moderation_actions (
    moderator_id, action, reason, metadata
  ) values (
    p_moderator_id,
    case when p_featured then 'listing_featured' else 'listing_unfeatured' end,
    case when p_featured then 'featured' else 'unfeatured' end,
    jsonb_build_object('listing_id', p_listing_id)
  );
end;
$$;

create or replace function public.purge_rejected_submissions(
  p_moderator_id uuid,
  p_submission_id uuid default null
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  if not exists (
    select 1 from public.moderator_profiles
    where user_id = p_moderator_id and active = true
  ) then
    raise exception 'moderator access required';
  end if;

  insert into public.moderation_actions (
    submission_id, moderator_id, action, reason, metadata
  )
  select id, p_moderator_id, 'rejected_submission_purged', 'storage cleanup',
    jsonb_build_object('submission_id', id, 'name', name, 'organization', organization)
  from public.opportunity_submissions
  where status = 'rejected'
    and (p_submission_id is null or id = p_submission_id);

  delete from public.opportunity_submissions
  where status = 'rejected'
    and (p_submission_id is null or id = p_submission_id);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create or replace function public.apply_moderation_retention(
  p_now timestamptz default now()
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_expired_bans integer := 0;
  v_fingerprints_deleted integer := 0;
  v_submissions_redacted integer := 0;
  v_reports_redacted integer := 0;
  v_action_notes_redacted integer := 0;
  v_flag_notes_redacted integer := 0;
  v_ban_notes_redacted integer := 0;
  v_report_details_redacted integer := 0;
  v_temporary_bans_deleted integer := 0;
  v_old_actions_deleted integer := 0;
  v_old_flags_deleted integer := 0;
  v_old_reports_deleted integer := 0;
  v_stale_active_submissions integer := 0;
  v_permanent_bans_due_review integer := 0;
  v_results jsonb;
begin
  update public.moderation_bans
  set active = false
  where active = true
    and expires_at is not null
    and expires_at <= p_now;
  get diagnostics v_expired_bans = row_count;

  delete from public.submission_fingerprints as fingerprints
  using public.opportunity_submissions as submissions
  where fingerprints.submission_id = submissions.id
    and submissions.status in ('rejected', 'withdrawn', 'published')
    and coalesce(
      submissions.published_at,
      submissions.reviewed_at,
      submissions.last_action_at,
      submissions.created_at
    ) < p_now - interval '90 days';
  get diagnostics v_fingerprints_deleted = row_count;

  update public.opportunity_submissions
  set submitter_name = null,
      submitter_email = null,
      submitter_notes = null,
      submission_ip_hash = null,
      submission_email_hash = null,
      submission_country_code = null,
      submission_user_agent_hash = null
  where status in ('rejected', 'withdrawn', 'published')
    and coalesce(published_at, reviewed_at, last_action_at, created_at)
      < p_now - interval '90 days'
    and (
      submitter_name is not null
      or submitter_email is not null
      or submitter_notes is not null
      or submission_ip_hash is not null
      or submission_email_hash is not null
      or submission_country_code is not null
      or submission_user_agent_hash is not null
    );
  get diagnostics v_submissions_redacted = row_count;

  update public.listing_reports
  set reporter_email = null,
      reporter_email_hash = null,
      reporter_ip_hash = null,
      reporter_country_code = null
  where status in ('upheld', 'dismissed')
    and coalesce(resolved_at, created_at) < p_now - interval '90 days'
    and (
      reporter_email is not null
      or reporter_email_hash is not null
      or reporter_ip_hash is not null
      or reporter_country_code is not null
    );
  get diagnostics v_reports_redacted = row_count;

  update public.moderation_actions
  set notes = null
  where notes is not null
    and created_at < p_now - interval '1 year';
  get diagnostics v_action_notes_redacted = row_count;

  update public.submission_flags
  set notes = null
  where notes is not null
    and created_at < p_now - interval '1 year';
  get diagnostics v_flag_notes_redacted = row_count;

  update public.moderation_bans
  set notes = null
  where notes is not null
    and created_at < p_now - interval '1 year';
  get diagnostics v_ban_notes_redacted = row_count;

  update public.listing_reports
  set details = null
  where details is not null
    and status in ('upheld', 'dismissed')
    and coalesce(resolved_at, created_at) < p_now - interval '1 year';
  get diagnostics v_report_details_redacted = row_count;

  delete from public.moderation_bans
  where active = false
    and expires_at is not null
    and expires_at < p_now - interval '90 days';
  get diagnostics v_temporary_bans_deleted = row_count;

  delete from public.submission_flags
  where resolved = true
    and coalesce(resolved_at, created_at) < p_now - interval '3 years';
  get diagnostics v_old_flags_deleted = row_count;

  delete from public.listing_reports
  where status in ('upheld', 'dismissed')
    and coalesce(resolved_at, created_at) < p_now - interval '3 years';
  get diagnostics v_old_reports_deleted = row_count;

  delete from public.moderation_actions
  where created_at < p_now - interval '3 years';
  get diagnostics v_old_actions_deleted = row_count;

  select count(*)::integer
  into v_stale_active_submissions
  from public.opportunity_submissions
  where status in ('pending', 'reviewing', 'flagged')
    and created_at < p_now - interval '180 days';

  select count(*)::integer
  into v_permanent_bans_due_review
  from public.moderation_bans
  where active = true
    and expires_at is null
    and created_at < p_now - interval '1 year';

  v_results := jsonb_build_object(
    'expired_bans', v_expired_bans,
    'fingerprints_deleted', v_fingerprints_deleted,
    'submissions_redacted', v_submissions_redacted,
    'reports_redacted', v_reports_redacted,
    'action_notes_redacted', v_action_notes_redacted,
    'flag_notes_redacted', v_flag_notes_redacted,
    'ban_notes_redacted', v_ban_notes_redacted,
    'report_details_redacted', v_report_details_redacted,
    'temporary_bans_deleted', v_temporary_bans_deleted,
    'old_actions_deleted', v_old_actions_deleted,
    'old_flags_deleted', v_old_flags_deleted,
    'old_reports_deleted', v_old_reports_deleted,
    'stale_active_submissions', v_stale_active_submissions,
    'permanent_bans_due_review', v_permanent_bans_due_review
  );

  delete from public.moderation_retention_runs
  where ran_at < p_now - interval '1 year';

  insert into public.moderation_retention_runs (ran_at, results)
  values (p_now, v_results);

  return v_results;
end;
$$;

alter table public.listing_moderation_state enable row level security;
revoke all on public.listing_moderation_state from anon, authenticated;
revoke execute on function public.resolve_listing_report(uuid, uuid, text, text)
  from public, anon, authenticated;
revoke execute on function public.set_listing_featured(text, uuid, boolean)
  from public, anon, authenticated;
revoke execute on function public.purge_rejected_submissions(uuid, uuid)
  from public, anon, authenticated;
revoke execute on function public.apply_moderation_retention(timestamptz)
  from public, anon, authenticated;
grant execute on function public.resolve_listing_report(uuid, uuid, text, text)
  to service_role;
grant execute on function public.set_listing_featured(text, uuid, boolean)
  to service_role;
grant execute on function public.purge_rejected_submissions(uuid, uuid)
  to service_role;
grant execute on function public.apply_moderation_retention(timestamptz)
  to service_role;

commit;
