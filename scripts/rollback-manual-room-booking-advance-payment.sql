-- Roll back code objects added by upgrade-manual-room-booking-advance-payment.sql.
-- Export room_booking_payments before rollback. Existing payment rows are preserved.

begin;

drop trigger if exists trg_enforce_room_payment_hotel_scope on public.room_booking_payments;
drop function if exists public.enforce_room_payment_hotel_scope();
drop function if exists public.create_room_booking_with_advance(text,jsonb,jsonb,text,text,text);
-- Reapply upgrade-production-room-pricing-gst.sql after rollback to restore the
-- prior record_room_booking_payment function definition without advance-policy columns.
drop index if exists public.idx_room_bookings_payment_report;
drop index if exists public.idx_room_booking_payments_group;
drop index if exists public.uq_room_booking_payment_provider_reference;
drop index if exists public.idx_room_booking_payments_reconciliation;
drop index if exists public.uq_room_booking_payment_receipt_scope;

alter table public.room_booking_payments drop constraint if exists room_booking_payments_currency_check;
alter table public.room_booking_payments drop constraint if exists room_booking_payments_type_check;
alter table public.room_booking_payments drop column if exists version;
alter table public.room_booking_payments drop column if exists provider_reference;
alter table public.room_booking_payments drop column if exists received_role;
alter table public.room_booking_payments drop column if exists received_by;
alter table public.room_booking_payments drop column if exists currency;
alter table public.room_booking_payments drop column if exists receipt_reference;
alter table public.room_booking_payments drop column if exists payment_group_id;
alter table public.room_booking_payments drop column if exists payment_type;

alter table public.room_bookings drop column if exists request_fingerprint;
drop table if exists public.hotel_room_advance_policies;

commit;
