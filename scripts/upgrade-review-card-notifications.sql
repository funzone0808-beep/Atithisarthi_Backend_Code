-- Hotel/user-scoped card acknowledgement state for the existing notification event log.
-- Apply after create-notification-events-table.sql.

alter table if exists public.notification_events
  add column if not exists dedupe_key text;

create unique index if not exists idx_notification_events_hotel_dedupe
  on public.notification_events (hotel_slug, dedupe_key)
  where dedupe_key is not null;

create table if not exists public.notification_card_acknowledgements (
  id bigserial primary key,
  hotel_slug text not null,
  staff_id text not null,
  card_key text not null,
  acknowledged_through_id bigint not null default 0,
  acknowledged_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint notification_card_ack_card_key_check check (
    card_key in (
      'qr-orders',
      'staff-orders',
      'website-orders',
      'support',
      'reservations',
      'inquiries',
      'contacts',
      'testimonials'
    )
  ),
  constraint notification_card_ack_through_check check (acknowledged_through_id >= 0),
  constraint notification_card_ack_unique unique (hotel_slug, staff_id, card_key)
);

create index if not exists idx_notification_card_ack_scope
  on public.notification_card_acknowledgements
  (hotel_slug, staff_id, card_key, acknowledged_through_id desc);

alter table public.notification_card_acknowledgements enable row level security;
revoke all on table public.notification_card_acknowledgements from public, anon, authenticated;
grant select, insert, update on table public.notification_card_acknowledgements to service_role;
grant usage, select on sequence public.notification_card_acknowledgements_id_seq to service_role;

create or replace function public.acknowledge_notification_card(
  p_hotel_slug text,
  p_staff_id text,
  p_card_key text,
  p_acknowledged_through_id bigint
)
returns table (
  acknowledged_through_id bigint,
  acknowledged_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  insert into public.notification_card_acknowledgements as existing (
    hotel_slug,
    staff_id,
    card_key,
    acknowledged_through_id,
    acknowledged_at,
    updated_at
  )
  values (
    p_hotel_slug,
    p_staff_id,
    p_card_key,
    greatest(0, p_acknowledged_through_id),
    now(),
    now()
  )
  on conflict (hotel_slug, staff_id, card_key)
  do update set
    acknowledged_through_id = greatest(
      existing.acknowledged_through_id,
      excluded.acknowledged_through_id
    ),
    acknowledged_at = case
      when excluded.acknowledged_through_id > existing.acknowledged_through_id
        then excluded.acknowledged_at
      else existing.acknowledged_at
    end,
    updated_at = now()
  returning
    existing.acknowledged_through_id,
    existing.acknowledged_at;
end;
$$;

revoke all on function public.acknowledge_notification_card(text, text, text, bigint)
  from public, anon, authenticated;
grant execute on function public.acknowledge_notification_card(text, text, text, bigint)
  to service_role;

comment on function public.acknowledge_notification_card(text, text, text, bigint) is
  'Atomically advances a hotel/staff/card acknowledgement cursor without allowing regression.';

comment on table public.notification_card_acknowledgements is
  'Per-staff, per-hotel acknowledgement cursors for operational notification cards.';
