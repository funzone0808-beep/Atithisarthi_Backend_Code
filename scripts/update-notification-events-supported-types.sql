-- Expands existing notification_events check constraints so the table accepts
-- the newer source and event types used by the application.
-- Apply this when notification_events already exists but contact/testimonial/
-- support events fail to insert with check-constraint errors.

alter table if exists public.notification_events
  drop constraint if exists notification_events_source_type_check;

alter table if exists public.notification_events
  add constraint notification_events_source_type_check check (
    source_type in (
      'order',
      'reservation',
      'inquiry',
      'contact_submission',
      'testimonial',
      'support_request'
    )
  );

alter table if exists public.notification_events
  drop constraint if exists notification_events_event_type_check;

alter table if exists public.notification_events
  add constraint notification_events_event_type_check check (
    event_type in (
      'order_created',
      'reservation_created',
      'inquiry_created',
      'contact_submission_created',
      'testimonial_submitted',
      'support_request_created'
    )
  );
