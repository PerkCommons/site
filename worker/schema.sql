create extension if not exists pgcrypto;

create type submission_status as enum ('pending', 'flagged', 'approved', 'rejected', 'published');

create table public.submissions (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (char_length(provider) between 1 and 100),
  title text not null check (char_length(title) between 1 and 140),
  category text not null,
  source_url text not null check (source_url like 'https://%'),
  details text not null check (char_length(details) between 30 and 2000),
  submitter_email text,
  status submission_status not null default 'pending',
  moderator_notes text,
  ip_hash text,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz
);

alter table public.submissions enable row level security;
-- No public policy is intentional. Only the server-side service role may access submissions.
create index submissions_moderation_queue on public.submissions (status, created_at);
