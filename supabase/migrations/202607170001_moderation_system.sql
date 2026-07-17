begin;

create extension if not exists pgcrypto;

do $$
begin
  alter type public.submission_status add value if not exists 'reviewing';
  alter type public.submission_status add value if not exists 'withdrawn';
exception
  when undefined_object then null;
end $$;

-- The Worker is now the only submission writer. Remove legacy browser policies
-- before changing status because PostgreSQL policies can depend on its type.
do $$
declare
  policy_record record;
begin
  for policy_record in
    select policyname
    from pg_policies
    where schemaname = 'public'
      and tablename = 'opportunity_submissions'
  loop
    execute format(
      'drop policy if exists %I on public.opportunity_submissions',
      policy_record.policyname
    );
  end loop;
end $$;

alter table public.opportunity_submissions
  drop constraint if exists opportunity_submissions_status_check;
alter table public.opportunity_submissions
  alter column status drop default;
alter table public.opportunity_submissions
  alter column status type text using status::text;
alter table public.opportunity_submissions
  alter column status set default 'pending';

alter table public.opportunity_submissions
  add column if not exists benefits text,
  add column if not exists organization_website_url text,
  add column if not exists submitter_notes text,
  add column if not exists reviewed_by uuid references auth.users(id) on delete set null,
  add column if not exists decision_reason text,
  add column if not exists risk_score numeric(5, 2) not null default 0,
  add column if not exists flag_count integer not null default 0,
  add column if not exists submission_ip_hash text,
  add column if not exists submission_email_hash text,
  add column if not exists submission_country_code varchar(2),
  add column if not exists submission_user_agent_hash text,
  add column if not exists last_action_at timestamptz,
  add column if not exists reviewed_at timestamptz,
  add column if not exists published_at timestamptz;

alter table public.opportunity_submissions
  add constraint opportunity_submissions_status_check
  check (status::text in ('pending', 'reviewing', 'flagged', 'approved', 'rejected', 'published', 'withdrawn'));
alter table public.opportunity_submissions
  drop constraint if exists opportunity_submissions_country_code_check;
alter table public.opportunity_submissions
  add constraint opportunity_submissions_country_code_check
  check (submission_country_code is null or submission_country_code ~ '^[A-Z]{2}$');

create table if not exists public.moderator_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('reviewer', 'admin')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.normalized_opportunities (
  submission_id uuid primary key references public.opportunity_submissions(id) on delete cascade,
  title text not null,
  organization text not null,
  categories text[] not null default '{}',
  description text not null,
  eligibility text not null,
  benefits text,
  location text,
  deadline date,
  source_url text not null,
  organization_website_url text,
  normalized_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.moderation_actions (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid references public.opportunity_submissions(id) on delete set null,
  moderator_id uuid not null references auth.users(id),
  action text not null,
  reason text,
  notes text,
  previous_status text,
  new_status text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.submission_flags (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.opportunity_submissions(id) on delete cascade,
  reason text not null,
  notes text,
  moderator_id uuid not null references auth.users(id),
  resolved boolean not null default false,
  resolved_by uuid references auth.users(id),
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.listing_reports (
  id uuid primary key default gen_random_uuid(),
  listing_id text not null,
  reason text not null,
  details text,
  reporter_email text,
  reporter_email_hash text,
  reporter_ip_hash text,
  reporter_country_code varchar(2),
  status text not null default 'open' check (status in ('open', 'reviewing', 'resolved', 'dismissed')),
  assigned_to uuid references auth.users(id),
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create table if not exists public.moderation_bans (
  id uuid primary key default gen_random_uuid(),
  identifier_type text not null check (identifier_type in ('email', 'ip')),
  identifier_hash text not null,
  display_hint text not null,
  reason text not null,
  notes text,
  mode text not null default 'block' check (mode in ('block', 'flag', 'warn')),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  active boolean not null default true
);

create table if not exists public.submission_fingerprints (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.opportunity_submissions(id) on delete cascade,
  email_hash text,
  ip_hash text,
  user_agent_hash text,
  country_code varchar(2),
  created_at timestamptz not null default now(),
  unique (submission_id)
);

create index if not exists opportunity_submissions_moderation_queue
  on public.opportunity_submissions (status, created_at);
create index if not exists moderation_actions_submission_created
  on public.moderation_actions (submission_id, created_at desc);
create index if not exists submission_flags_active
  on public.submission_flags (submission_id, resolved, created_at desc);
create index if not exists listing_reports_queue
  on public.listing_reports (status, created_at);
create index if not exists moderation_bans_lookup
  on public.moderation_bans (identifier_type, identifier_hash, active, expires_at);
create unique index if not exists moderation_bans_one_active_identifier
  on public.moderation_bans (identifier_type, identifier_hash) where active = true;
create index if not exists submission_fingerprints_email
  on public.submission_fingerprints (email_hash) where email_hash is not null;
create index if not exists submission_fingerprints_ip
  on public.submission_fingerprints (ip_hash) where ip_hash is not null;

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists moderator_profiles_touch_updated_at on public.moderator_profiles;
create trigger moderator_profiles_touch_updated_at before update on public.moderator_profiles
for each row execute function public.touch_updated_at();
drop trigger if exists normalized_opportunities_touch_updated_at on public.normalized_opportunities;
create trigger normalized_opportunities_touch_updated_at before update on public.normalized_opportunities
for each row execute function public.touch_updated_at();

create or replace function public.perform_moderation_action(
  p_submission_id uuid,
  p_moderator_id uuid,
  p_action text,
  p_reason text default null,
  p_notes text default null,
  p_normalized jsonb default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_previous text;
  v_next text;
  v_action_id uuid;
begin
  select role into v_role from public.moderator_profiles
  where user_id = p_moderator_id and active = true;
  if v_role is null then raise exception 'moderator access required'; end if;

  select status::text into v_previous from public.opportunity_submissions
  where id = p_submission_id for update;
  if v_previous is null then raise exception 'submission not found'; end if;

  v_next := case p_action
    when 'approve' then 'approved'
    when 'decline' then 'rejected'
    when 'flag' then 'flagged'
    when 'unflag' then 'pending'
    when 'publish' then 'published'
    when 'withdraw' then 'withdrawn'
    else v_previous
  end;

  if p_action not in ('approve', 'decline', 'flag', 'unflag', 'publish', 'withdraw', 'note', 'edit') then
    raise exception 'unsupported moderation action';
  end if;

  update public.opportunity_submissions
  set status = v_next,
      reviewed_by = p_moderator_id,
      decision_reason = case when p_action in ('approve', 'decline') then p_reason else decision_reason end,
      reviewed_at = case when p_action in ('approve', 'decline') then now() else reviewed_at end,
      published_at = case when p_action = 'publish' then now() else published_at end,
      last_action_at = now(),
      flag_count = case when p_action = 'flag' then flag_count + 1 when p_action = 'unflag' then 0 else flag_count end
  where id = p_submission_id;

  if p_action = 'flag' then
    insert into public.submission_flags (submission_id, reason, notes, moderator_id)
    values (p_submission_id, coalesce(p_reason, 'Other'), p_notes, p_moderator_id);
  elsif p_action = 'unflag' then
    update public.submission_flags
    set resolved = true, resolved_by = p_moderator_id, resolved_at = now()
    where submission_id = p_submission_id and resolved = false;
  end if;

  if p_action = 'approve' and p_normalized is not null then
    insert into public.normalized_opportunities (
      submission_id, title, organization, categories, description, eligibility,
      benefits, location, deadline, source_url, organization_website_url, normalized_by
    ) values (
      p_submission_id, p_normalized->>'title', p_normalized->>'organization',
      coalesce(array(select jsonb_array_elements_text(p_normalized->'categories')), '{}'),
      p_normalized->>'description', p_normalized->>'eligibility', p_normalized->>'benefits',
      p_normalized->>'location', nullif(p_normalized->>'deadline', '')::date,
      p_normalized->>'source_url', p_normalized->>'organization_website_url', p_moderator_id
    ) on conflict (submission_id) do update set
      title = excluded.title, organization = excluded.organization, categories = excluded.categories,
      description = excluded.description, eligibility = excluded.eligibility, benefits = excluded.benefits,
      location = excluded.location, deadline = excluded.deadline, source_url = excluded.source_url,
      organization_website_url = excluded.organization_website_url,
      normalized_by = excluded.normalized_by, updated_at = now();
  end if;

  insert into public.moderation_actions (
    submission_id, moderator_id, action, reason, notes, previous_status, new_status,
    metadata
  ) values (
    p_submission_id, p_moderator_id, p_action, p_reason, p_notes, v_previous, v_next,
    case when p_normalized is null then '{}'::jsonb else jsonb_build_object('normalized_fields', true) end
  ) returning id into v_action_id;

  return v_action_id;
end;
$$;

create or replace function public.undo_moderation_action(
  p_submission_id uuid,
  p_moderator_id uuid
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_last public.moderation_actions%rowtype;
  v_current text;
  v_action_id uuid;
begin
  select role into v_role from public.moderator_profiles
  where user_id = p_moderator_id and active = true;
  if v_role is null then raise exception 'moderator access required'; end if;

  select * into v_last from public.moderation_actions
  where submission_id = p_submission_id and action in ('approve', 'decline', 'flag', 'unflag')
  order by created_at desc limit 1;
  if v_last.id is null then raise exception 'nothing to undo'; end if;
  if v_last.created_at < now() - interval '10 minutes' then raise exception 'undo window expired'; end if;

  select status::text into v_current from public.opportunity_submissions
  where id = p_submission_id for update;

  if v_last.action = 'flag' then
    with latest_flag as (
      select id from public.submission_flags
      where submission_id = p_submission_id and moderator_id = v_last.moderator_id
        and resolved = false and created_at between v_last.created_at - interval '5 seconds' and v_last.created_at + interval '5 seconds'
      order by created_at desc limit 1
    )
    update public.submission_flags set resolved = true, resolved_by = p_moderator_id, resolved_at = now()
    where id in (select id from latest_flag);
  elsif v_last.action = 'unflag' then
    update public.submission_flags set resolved = false, resolved_by = null, resolved_at = null
    where submission_id = p_submission_id and resolved_by = v_last.moderator_id
      and resolved_at between v_last.created_at - interval '5 seconds' and v_last.created_at + interval '5 seconds';
  end if;

  update public.opportunity_submissions
  set status = v_last.previous_status,
      decision_reason = case when v_last.action in ('approve', 'decline') then null else decision_reason end,
      reviewed_at = case when v_last.action in ('approve', 'decline') then null else reviewed_at end,
      flag_count = (select count(*)::integer from public.submission_flags where submission_id = p_submission_id and resolved = false),
      last_action_at = now()
  where id = p_submission_id;

  insert into public.moderation_actions (
    submission_id, moderator_id, action, reason, previous_status, new_status, metadata
  ) values (
    p_submission_id, p_moderator_id, 'undo', 'Moderator undo', v_current,
    v_last.previous_status, jsonb_build_object('undone_action_id', v_last.id)
  ) returning id into v_action_id;
  return v_action_id;
end;
$$;

create or replace function public.create_moderation_ban(
  p_submission_id uuid,
  p_moderator_id uuid,
  p_identifier_type text,
  p_identifier_hash text,
  p_display_hint text,
  p_reason text,
  p_notes text,
  p_mode text,
  p_expires_at timestamptz
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_ban_id uuid;
begin
  select role into v_role from public.moderator_profiles
  where user_id = p_moderator_id and active = true;
  if v_role is distinct from 'admin' then raise exception 'administrator access required'; end if;
  if p_identifier_type not in ('email', 'ip') or p_mode not in ('block', 'flag', 'warn') then
    raise exception 'invalid abuse control';
  end if;

  insert into public.moderation_bans (
    identifier_type, identifier_hash, display_hint, reason, notes, mode,
    created_by, expires_at
  ) values (
    p_identifier_type, p_identifier_hash, p_display_hint, p_reason, p_notes,
    p_mode, p_moderator_id, p_expires_at
  ) returning id into v_ban_id;

  insert into public.moderation_actions (
    submission_id, moderator_id, action, reason, notes, metadata
  ) values (
    p_submission_id, p_moderator_id, 'ban', p_reason, p_notes,
    jsonb_build_object('ban_id', v_ban_id, 'identifier_type', p_identifier_type, 'mode', p_mode, 'expires_at', p_expires_at)
  );
  return v_ban_id;
end;
$$;

create or replace function public.disable_moderation_ban(
  p_ban_id uuid,
  p_moderator_id uuid
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_action_id uuid;
begin
  select role into v_role from public.moderator_profiles
  where user_id = p_moderator_id and active = true;
  if v_role is distinct from 'admin' then raise exception 'administrator access required'; end if;

  update public.moderation_bans set active = false
  where id = p_ban_id and active = true;
  if not found then raise exception 'active abuse control not found'; end if;

  insert into public.moderation_actions (moderator_id, action, reason, metadata)
  values (p_moderator_id, 'unban', 'Administrator removed abuse control', jsonb_build_object('ban_id', p_ban_id))
  returning id into v_action_id;
  return v_action_id;
end;
$$;

create or replace function public.create_submission_bans(
  p_submission_id uuid,
  p_moderator_id uuid,
  p_identifier_type text,
  p_email_hash text,
  p_ip_hash text,
  p_email_hint text,
  p_ip_hint text,
  p_reason text,
  p_notes text,
  p_mode text,
  p_expires_at timestamptz
) returns uuid[]
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_type text;
  v_hash text;
  v_hint text;
  v_ban_id uuid;
  v_ids uuid[] := '{}';
begin
  select role into v_role from public.moderator_profiles
  where user_id = p_moderator_id and active = true;
  if v_role is distinct from 'admin' then raise exception 'administrator access required'; end if;
  if p_identifier_type not in ('email', 'ip', 'both') or p_mode not in ('block', 'flag', 'warn') then
    raise exception 'invalid abuse control';
  end if;

  foreach v_type in array case p_identifier_type when 'both' then array['email', 'ip'] else array[p_identifier_type] end
  loop
    v_hash := case v_type when 'email' then p_email_hash else p_ip_hash end;
    v_hint := case v_type when 'email' then p_email_hint else p_ip_hint end;
    if v_hash is null then raise exception 'fingerprint unavailable'; end if;
    insert into public.moderation_bans (
      identifier_type, identifier_hash, display_hint, reason, notes, mode,
      created_by, expires_at
    ) values (
      v_type, v_hash, v_hint, p_reason, p_notes, p_mode, p_moderator_id, p_expires_at
    ) returning id into v_ban_id;
    v_ids := array_append(v_ids, v_ban_id);
    insert into public.moderation_actions (
      submission_id, moderator_id, action, reason, notes, metadata
    ) values (
      p_submission_id, p_moderator_id, 'ban', p_reason, p_notes,
      jsonb_build_object('ban_id', v_ban_id, 'identifier_type', v_type, 'mode', p_mode, 'expires_at', p_expires_at)
    );
  end loop;
  return v_ids;
end;
$$;

alter table public.opportunity_submissions enable row level security;
alter table public.moderator_profiles enable row level security;
alter table public.normalized_opportunities enable row level security;
alter table public.moderation_actions enable row level security;
alter table public.submission_flags enable row level security;
alter table public.listing_reports enable row level security;
alter table public.moderation_bans enable row level security;
alter table public.submission_fingerprints enable row level security;

revoke all on public.opportunity_submissions, public.moderator_profiles, public.normalized_opportunities,
  public.moderation_actions, public.submission_flags, public.listing_reports,
  public.moderation_bans, public.submission_fingerprints from anon, authenticated;
revoke execute on function public.perform_moderation_action(uuid, uuid, text, text, text, jsonb) from public, anon, authenticated;
revoke execute on function public.undo_moderation_action(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.create_moderation_ban(uuid, uuid, text, text, text, text, text, text, timestamptz) from public, anon, authenticated;
revoke execute on function public.disable_moderation_ban(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.create_submission_bans(uuid, uuid, text, text, text, text, text, text, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.perform_moderation_action(uuid, uuid, text, text, text, jsonb) to service_role;
grant execute on function public.undo_moderation_action(uuid, uuid) to service_role;
grant execute on function public.create_moderation_ban(uuid, uuid, text, text, text, text, text, text, timestamptz) to service_role;
grant execute on function public.disable_moderation_ban(uuid, uuid) to service_role;
grant execute on function public.create_submission_bans(uuid, uuid, text, text, text, text, text, text, text, text, timestamptz) to service_role;

commit;
