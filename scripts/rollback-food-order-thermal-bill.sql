-- Reversible rollback for create-food-order-thermal-bill.sql.
-- Existing orders, billing, payment, KDS, room-service, and checkout records
-- are intentionally not changed.

drop trigger if exists food_order_bill_snapshots_protect
  on public.food_order_bill_snapshots;
drop function if exists public.protect_food_order_bill_snapshot();
drop table if exists public.food_order_bill_audit;
drop table if exists public.food_order_bill_snapshots;
drop table if exists public.food_order_bill_formats;
