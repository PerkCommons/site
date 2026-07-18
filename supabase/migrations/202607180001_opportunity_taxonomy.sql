begin;

alter table public.opportunity_submissions
  add column if not exists primary_category text,
  add column if not exists subcategories text[] not null default '{}',
  add column if not exists tags text[] not null default '{}';

alter table public.normalized_opportunities
  add column if not exists primary_category text,
  add column if not exists subcategories text[] not null default '{}',
  add column if not exists tags text[] not null default '{}';

update public.opportunity_submissions
set primary_category = case coalesce(primary_category, categories[1])
  when 'ai-credits' then 'startup-benefits'
  when 'cloud-credits' then 'startup-benefits'
  when 'startup-programs' then 'startup-benefits'
  when 'grants' then 'funding'
  when 'discounts' then 'discounts-perks'
  when 'accelerators' then 'accelerators-incubators'
  when 'business-perks' then 'startup-benefits'
  else coalesce(primary_category, categories[1])
end
where primary_category is null
   or primary_category in ('ai-credits', 'cloud-credits', 'startup-programs', 'grants', 'discounts', 'accelerators', 'business-perks');

update public.normalized_opportunities
set primary_category = case coalesce(primary_category, categories[1])
  when 'ai-credits' then 'startup-benefits'
  when 'cloud-credits' then 'startup-benefits'
  when 'startup-programs' then 'startup-benefits'
  when 'grants' then 'funding'
  when 'discounts' then 'discounts-perks'
  when 'accelerators' then 'accelerators-incubators'
  when 'business-perks' then 'startup-benefits'
  else coalesce(primary_category, categories[1])
end
where primary_category is null
   or primary_category in ('ai-credits', 'cloud-credits', 'startup-programs', 'grants', 'discounts', 'accelerators', 'business-perks');

alter table public.opportunity_submissions
  drop constraint if exists opportunity_submissions_primary_category_check,
  drop constraint if exists opportunity_submissions_subcategories_count_check,
  drop constraint if exists opportunity_submissions_tags_count_check;
alter table public.opportunity_submissions
  add constraint opportunity_submissions_primary_category_check check (
    primary_category is null or primary_category in (
      'startup-benefits', 'student-benefits', 'nonprofit-benefits',
      'developer-programs', 'funding', 'accelerators-incubators',
      'competitions-hackathons', 'fellowships', 'internships-work-experience',
      'research-opportunities', 'mentorship-community', 'education-training',
      'open-source', 'social-impact-civic-tech', 'creator-media',
      'events-conferences', 'discounts-perks', 'volunteer-service',
      'awards-recognition', 'early-access'
    )
  ),
  add constraint opportunity_submissions_subcategories_count_check check (cardinality(subcategories) <= 8),
  add constraint opportunity_submissions_tags_count_check check (cardinality(tags) <= 12);

alter table public.normalized_opportunities
  drop constraint if exists normalized_opportunities_primary_category_check,
  drop constraint if exists normalized_opportunities_subcategories_count_check,
  drop constraint if exists normalized_opportunities_tags_count_check;
alter table public.normalized_opportunities
  add constraint normalized_opportunities_primary_category_check check (
    primary_category is null or primary_category in (
      'startup-benefits', 'student-benefits', 'nonprofit-benefits',
      'developer-programs', 'funding', 'accelerators-incubators',
      'competitions-hackathons', 'fellowships', 'internships-work-experience',
      'research-opportunities', 'mentorship-community', 'education-training',
      'open-source', 'social-impact-civic-tech', 'creator-media',
      'events-conferences', 'discounts-perks', 'volunteer-service',
      'awards-recognition', 'early-access'
    )
  ),
  add constraint normalized_opportunities_subcategories_count_check check (cardinality(subcategories) <= 8),
  add constraint normalized_opportunities_tags_count_check check (cardinality(tags) <= 12);

create index if not exists opportunity_submissions_category_queue
  on public.opportunity_submissions (primary_category, status, created_at);

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
      submission_id, title, organization, categories, primary_category,
      subcategories, tags, description, eligibility, benefits, location,
      deadline, source_url, organization_website_url, normalized_by
    ) values (
      p_submission_id, p_normalized->>'title', p_normalized->>'organization',
      coalesce(array(select jsonb_array_elements_text(p_normalized->'categories')), '{}'),
      p_normalized->>'primary_category',
      coalesce(array(select jsonb_array_elements_text(p_normalized->'subcategories')), '{}'),
      coalesce(array(select jsonb_array_elements_text(p_normalized->'tags')), '{}'),
      p_normalized->>'description', p_normalized->>'eligibility', p_normalized->>'benefits',
      p_normalized->>'location', nullif(p_normalized->>'deadline', '')::date,
      p_normalized->>'source_url', p_normalized->>'organization_website_url', p_moderator_id
    ) on conflict (submission_id) do update set
      title = excluded.title,
      organization = excluded.organization,
      categories = excluded.categories,
      primary_category = excluded.primary_category,
      subcategories = excluded.subcategories,
      tags = excluded.tags,
      description = excluded.description,
      eligibility = excluded.eligibility,
      benefits = excluded.benefits,
      location = excluded.location,
      deadline = excluded.deadline,
      source_url = excluded.source_url,
      organization_website_url = excluded.organization_website_url,
      normalized_by = excluded.normalized_by,
      updated_at = now();
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

revoke execute on function public.perform_moderation_action(uuid, uuid, text, text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.perform_moderation_action(uuid, uuid, text, text, text, jsonb)
  to service_role;

commit;
