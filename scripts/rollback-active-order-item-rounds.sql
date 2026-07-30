-- Roll back only after the application no longer reads order rounds.
revoke all on function public.add_staff_items_to_active_order(
  text, text, text, bigint, text, text, jsonb, jsonb, jsonb, text, bigint, text
) from public, anon, authenticated, service_role;
drop function if exists public.add_staff_items_to_active_order(
  text, text, text, bigint, text, text, jsonb, jsonb, jsonb, text, bigint, text
);
drop table if exists public.order_rounds;
alter table public.orders
  drop column if exists last_item_added_at,
  drop column if exists order_version;
