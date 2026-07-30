-- Website / Manual Room Booking source workflow.
-- Apply after create-room-booking-tables.sql and create-notification-events-table.sql.
-- This is additive: it preserves every booking row, the existing source values,
-- inventory, payments, folios, status lifecycle, and overlap protection.

begin;

alter table public.notification_events
  add column if not exists dedupe_key text;

alter table public.notification_events
  drop constraint if exists notification_events_source_type_check;
alter table public.notification_events
  add constraint notification_events_source_type_check check (
    source_type in (
      'order',
      'reservation',
      'inquiry',
      'contact_submission',
      'testimonial',
      'support_request',
      'room_booking'
    )
  );

alter table public.notification_events
  drop constraint if exists notification_events_event_type_check;
alter table public.notification_events
  add constraint notification_events_event_type_check check (
    event_type in (
      'order_created',
      'reservation_created',
      'inquiry_created',
      'contact_submission_created',
      'testimonial_submitted',
      'support_request_created',
      'room_website_booking_created'
    )
  );

do $$
begin
  if to_regclass('public.notification_card_acknowledgements') is not null then
    alter table public.notification_card_acknowledgements
      drop constraint if exists notification_card_ack_card_key_check;
    alter table public.notification_card_acknowledgements
      add constraint notification_card_ack_card_key_check check (
        card_key in (
          'qr-orders',
          'staff-orders',
          'website-orders',
          'website-room-bookings',
          'support',
          'reservations',
          'inquiries',
          'contacts',
          'testimonials'
        )
      );
  end if;
end
$$;
create unique index if not exists idx_notification_events_hotel_dedupe
  on public.notification_events (hotel_slug, dedupe_key)
  where dedupe_key is not null;

create index if not exists idx_room_bookings_hotel_source_created
  on public.room_bookings (hotel_slug, booking_source, created_at desc);

create index if not exists idx_room_bookings_hotel_source_status_created
  on public.room_bookings (hotel_slug, booking_source, booking_status, created_at desc);

create or replace function public.normalize_room_booking_source_group(p_source text)
returns text
language sql
immutable
as $$
  select case lower(trim(coalesce(p_source, '')))
    when 'online' then 'website'
    when 'website' then 'website'
    when 'web' then 'website'
    when 'public_site' then 'website'
    when 'staff' then 'manual'
    when 'admin' then 'manual'
    when 'walk-in' then 'manual'
    when 'phone' then 'manual'
    when 'whatsapp' then 'manual'
    else 'legacy'
  end
$$;

comment on function public.normalize_room_booking_source_group(text) is
  'Operational source grouping that preserves the historical room_bookings.booking_source value.';

create or replace function public.get_room_booking_source_summary(p_hotel_slug text)
returns table (
  source_group text,
  total_count bigint,
  pending_count bigint,
  today_count bigint
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select
    public.normalize_room_booking_source_group(booking_source) as source_group,
    count(*) as total_count,
    count(*) filter (where booking_status = 'pending') as pending_count,
    count(*) filter (where created_at >= date_trunc('day', now())) as today_count
  from public.room_bookings
  where hotel_slug = p_hotel_slug
  group by public.normalize_room_booking_source_group(booking_source)
$$;

create or replace view public.room_booking_source_migration_audit as
select
  hotel_slug,
  booking_source as raw_source,
  public.normalize_room_booking_source_group(booking_source) as source_group,
  count(*) as booking_count,
  min(created_at) as oldest_created_at,
  max(created_at) as newest_created_at
from public.room_bookings
group by hotel_slug, booking_source;

comment on view public.room_booking_source_migration_audit is
  'Read-only audit of raw and normalized Room booking sources. Legacy values are reported, never guessed or overwritten.';

create or replace function public.prevent_room_booking_source_change()
returns trigger
language plpgsql
as $$
begin
  if new.booking_source is distinct from old.booking_source then
    raise exception using
      errcode = 'P0001',
      message = 'ROOM_BOOKING_SOURCE_IMMUTABLE';
  end if;
  return new;
end
$$;

drop trigger if exists trg_room_booking_source_immutable on public.room_bookings;
create trigger trg_room_booking_source_immutable
before update of booking_source on public.room_bookings
for each row execute function public.prevent_room_booking_source_change();

create or replace function public.enqueue_website_room_booking_notification()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_dedupe_key text;
begin
  if public.normalize_room_booking_source_group(new.booking_source) <> 'website' then
    return new;
  end if;

  v_dedupe_key :=
    'room_booking:' || new.id::text || ':room_website_booking_created:1';

  insert into public.notification_events (
    hotel_slug,
    source_type,
    source_id,
    event_type,
    dedupe_key,
    delivery_channel,
    status,
    payload,
    updated_at
  ) values (
    new.hotel_slug,
    'room_booking',
    new.id::text,
    'room_website_booking_created',
    v_dedupe_key,
    'internal',
    'pending',
    jsonb_build_object(
      'eventType', 'room_website_booking_created',
      'eventVersion', 1,
      'bookingReference', new.id::text,
      'bookingSource', 'website',
      'bookingStatus', new.booking_status,
      'paymentStatus', new.payment_status,
      'checkInDate', new.check_in_date,
      'createdAt', new.created_at
    ),
    now()
  )
  on conflict (hotel_slug, dedupe_key) where dedupe_key is not null
  do nothing;

  return new;
end
$$;

drop trigger if exists trg_enqueue_website_room_booking_notification on public.room_bookings;
create trigger trg_enqueue_website_room_booking_notification
after insert on public.room_bookings
for each row execute function public.enqueue_website_room_booking_notification();

revoke all on function public.get_room_booking_source_summary(text) from public;
grant execute on function public.get_room_booking_source_summary(text) to service_role;
revoke all on function public.enqueue_website_room_booking_notification() from public;
revoke all on function public.prevent_room_booking_source_change() from public;

commit;


