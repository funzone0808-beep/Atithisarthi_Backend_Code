-- Transaction-safe notification records for the dashboard live-update pipeline.
-- Apply after the existing notification_events migration.

alter table if exists public.notification_events
  drop constraint if exists notification_events_source_type_check;
alter table if exists public.notification_events
  add constraint notification_events_source_type_check check (source_type in (
    'order', 'reservation', 'inquiry', 'contact_submission', 'testimonial',
    'support_request', 'room_booking'
  ));

alter table if exists public.notification_events
  drop constraint if exists notification_events_event_type_check;
alter table if exists public.notification_events
  add constraint notification_events_event_type_check check (event_type in (
    'order_created', 'reservation_created', 'inquiry_created',
    'contact_submission_created', 'testimonial_submitted',
    'support_request_created', 'room_website_booking_created'
  ));

alter table if exists public.notification_card_acknowledgements
  drop constraint if exists notification_card_ack_card_key_check;
alter table if exists public.notification_card_acknowledgements
  add constraint notification_card_ack_card_key_check check (card_key in (
    'qr-orders', 'staff-orders', 'website-orders', 'website-room-bookings',
    'support', 'reservations', 'inquiries', 'contacts', 'testimonials'
  ));

create index if not exists idx_notification_events_hotel_id_desc
  on public.notification_events (hotel_slug, id desc);

create or replace function public.record_operational_notification_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  source_value text;
  event_value text;
  payload_value jsonb;
  source_id_value text := new.id::text;
  hotel_value text := new.hotel_slug;
begin
  if not exists (select 1 from pg_class where oid = 'public.notification_events'::regclass) then
    return new;
  end if;

  if tg_table_name = 'orders' then
    source_value := 'order';
    event_value := 'order_created';
    payload_value := jsonb_build_object(
      'orderId', new.id,
      'status', coalesce(to_jsonb(new)->>'status', 'new'),
      'orderContext', jsonb_build_object(
        'orderSource', coalesce(to_jsonb(new)->>'order_source', 'website'),
        'orderType', coalesce(to_jsonb(new)->>'order_type', '')
      )
    );
  elsif tg_table_name = 'room_bookings' then
    source_value := 'room_booking';
    event_value := 'room_website_booking_created';
    payload_value := jsonb_build_object(
      'bookingId', new.id,
      'source', 'website',
      'bookingStatus', coalesce(to_jsonb(new)->>'booking_status', 'pending')
    );
  elsif tg_table_name = 'testimonials' then
    source_value := 'testimonial';
    event_value := 'testimonial_submitted';
    payload_value := jsonb_build_object(
      'testimonialId', new.id,
      'approvalStatus', 'pending_approval'
    );
  else
    return new;
  end if;

  if hotel_value is not null and hotel_value <> '' then
    insert into public.notification_events (
      hotel_slug, source_type, source_id, event_type, dedupe_key,
      delivery_channel, status, payload, updated_at
    ) values (
      hotel_value, source_value, source_id_value, event_value,
      lower(source_value || ':' || source_id_value || ':' || event_value || ':'),
      'internal', 'pending', payload_value, now()
    ) on conflict (hotel_slug, dedupe_key) where dedupe_key is not null do nothing;
  end if;
  return new;
end;
$$;

-- These triggers run in the same database transaction as the business insert.
drop trigger if exists trg_orders_notification_event on public.orders;
create trigger trg_orders_notification_event
  after insert on public.orders
  for each row execute function public.record_operational_notification_event();

drop trigger if exists trg_room_bookings_notification_event on public.room_bookings;
create trigger trg_room_bookings_notification_event
  after insert on public.room_bookings
  for each row execute function public.record_operational_notification_event();

drop trigger if exists trg_testimonials_notification_event on public.testimonials;
create trigger trg_testimonials_notification_event
  after insert on public.testimonials
  for each row execute function public.record_operational_notification_event();

revoke all on function public.record_operational_notification_event() from public, anon, authenticated;
grant execute on function public.record_operational_notification_event() to service_role;