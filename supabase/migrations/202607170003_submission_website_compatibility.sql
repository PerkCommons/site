begin;

-- Preserve legacy organization URLs, then make the old column optional. The
-- Worker continues writing it during rollout so this migration is not required
-- for uninterrupted submissions.
update public.opportunity_submissions
set organization_website_url = website_url
where organization_website_url is null
  and website_url is not null;

alter table public.opportunity_submissions
  alter column website_url drop not null;

commit;
