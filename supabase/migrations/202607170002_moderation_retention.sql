begin;

create extension if not exists pg_cron with schema pg_catalog;

create table if not exists public.moderation_retention_runs (
  id bigint generated always as identity primary key,
  ran_at timestamptz not null default now(),
  results jsonb not null
);

alter table public.moderation_retention_runs enable row level security;
revoke all on public.moderation_retention_runs from public, anon, authenticated;

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
  where status in ('resolved', 'dismissed')
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
    and status in ('resolved', 'dismissed')
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
  where status in ('resolved', 'dismissed')
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

revoke execute on function public.apply_moderation_retention(timestamptz)
  from public, anon, authenticated;
grant execute on function public.apply_moderation_retention(timestamptz)
  to service_role;

do $$
declare
  existing_job record;
begin
  for existing_job in
    select jobid
    from cron.job
    where jobname = 'perkcommons-moderation-retention'
  loop
    perform cron.unschedule(existing_job.jobid);
  end loop;

  perform cron.schedule(
    'perkcommons-moderation-retention',
    '23 3 * * *',
    'select public.apply_moderation_retention();'
  );
end $$;

commit;
