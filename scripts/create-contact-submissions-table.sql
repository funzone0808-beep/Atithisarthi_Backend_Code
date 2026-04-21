-- Hotel-scoped contact form submissions.
-- Safe bridge version:
-- - keeps the existing Google Sheet flow independent
-- - stores public contact form messages per hotel
-- - supports simple admin/staff status handling later

create table if not exists public.contact_submissions (
  id bigserial primary key,
  hotel_slug text not null,
  hotel_name text not null default '',
  name text not null,
  email text not null,
  subject text not null default '',
  message text not null,
  status text not null default 'new'
    check (status in ('new', 'contacted', 'resolved', 'closed', 'archived')),
  source text not null default 'website_contact',
  google_sheet_status text not null default 'not_attempted',
  google_sheet_response jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists contact_submissions_hotel_slug_idx
  on public.contact_submissions (hotel_slug);

create index if not exists contact_submissions_hotel_status_idx
  on public.contact_submissions (hotel_slug, status, created_at desc);

create index if not exists contact_submissions_created_at_idx
  on public.contact_submissions (created_at desc);
