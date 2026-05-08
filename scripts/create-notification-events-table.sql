-- Stores internal notification events for hotel operations alerts.
-- Safe for existing data: creates the table only if it does not already exist.

create table if not exists public.notification_events (
  id bigserial primary key,
  hotel_slug text not null,
  source_type text not null,
  source_id text not null,
  event_type text not null,
  delivery_channel text not null default 'internal',
  status text not null default 'pending',
  payload jsonb not null default '{}'::jsonb,
  error_message text,
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  retry_count integer not null default 0,
  last_retry_at timestamptz,
  constraint notification_events_source_type_check check (
    source_type in (
      'order',
      'reservation',
      'inquiry',
      'contact_submission',
      'testimonial',
      'support_request'
    )
  ),
  constraint notification_events_event_type_check check (
    event_type in (
      'order_created',
      'reservation_created',
      'inquiry_created',
      'contact_submission_created',
      'testimonial_submitted',
      'support_request_created'
    )
  ),
  constraint notification_events_delivery_channel_check check (
    delivery_channel in ('internal')
  ),
  constraint notification_events_status_check check (
    status in ('pending', 'sent', 'failed', 'skipped')
  ),
  constraint notification_events_retry_count_check check (retry_count >= 0)
);

create index if not exists idx_notification_events_hotel_created_at
  on public.notification_events (hotel_slug, created_at desc);

create index if not exists idx_notification_events_status_created_at
  on public.notification_events (status, created_at desc);

create index if not exists idx_notification_events_source
  on public.notification_events (source_type, source_id);

comment on table public.notification_events is
  'Operational notification event log for hotel order, reservation, inquiry, contact, testimonial, and support alerts.';

