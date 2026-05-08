-- Stores hotel-scoped notification delivery settings.
-- Safe for existing data: creates the table only if it does not already exist.

create table if not exists public.hotel_notification_settings (
  hotel_slug text primary key,
  email_enabled boolean not null default false,
  owner_email text,
  notify_on_new_order boolean not null default true,
  notify_on_new_reservation boolean not null default true,
  notify_on_new_inquiry boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.hotel_notification_settings is
  'Hotel-scoped notification delivery settings used by the internal notification event pipeline.';

comment on column public.hotel_notification_settings.hotel_slug is
  'Hotel slug that owns these notification settings.';

comment on column public.hotel_notification_settings.owner_email is
  'Destination email address for hotel operational alerts when email notifications are enabled.';

