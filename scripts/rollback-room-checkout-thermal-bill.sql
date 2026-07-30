-- Reversible rollback for create-room-checkout-thermal-bill.sql.
-- Existing room checkout, booking, order, payment, and settlement tables/functions
-- are intentionally not changed.

drop trigger if exists room_checkout_bill_snapshots_protect
  on public.room_checkout_bill_snapshots;
drop function if exists public.protect_room_checkout_bill_snapshot();
drop table if exists public.room_checkout_bill_audit;
drop table if exists public.room_checkout_bill_snapshots;
drop table if exists public.room_checkout_bill_formats;
