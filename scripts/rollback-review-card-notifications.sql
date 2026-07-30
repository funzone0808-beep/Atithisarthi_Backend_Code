-- Rollback for card acknowledgement persistence only.
-- The existing notification_events and testimonials data are intentionally preserved.

drop function if exists public.acknowledge_notification_card(text, text, text, bigint);
drop table if exists public.notification_card_acknowledgements;
drop index if exists public.idx_notification_events_hotel_dedupe;
alter table if exists public.notification_events drop column if exists dedupe_key;
