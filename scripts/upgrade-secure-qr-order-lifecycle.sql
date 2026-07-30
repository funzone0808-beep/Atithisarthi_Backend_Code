-- Synchronizes dine-in terminal states and releases fully settled tables.
-- Apply after upgrade-secure-qr-staff-corrections.sql.

create or replace function public.is_dine_in_order_open(
  p_status text,
  p_kitchen_status text,
  p_payment_status text,
  p_billing_status text
)
returns boolean
language sql
immutable
set search_path = public, pg_temp
as $$
  select
    lower(btrim(coalesce(p_status, 'new'))) <> 'cancelled'
    and lower(btrim(coalesce(p_kitchen_status, ''))) <> 'cancelled'
    and not (
      (
        lower(btrim(coalesce(p_status, ''))) = 'completed'
        or lower(btrim(coalesce(p_kitchen_status, ''))) = 'served'
      )
      and lower(btrim(coalesce(p_payment_status, 'unpaid'))) = 'paid'
      and lower(btrim(coalesce(p_billing_status, 'not_billed'))) = 'billed'
    )
    and (
      lower(btrim(coalesce(p_status, 'new'))) in ('new', 'confirmed', 'preparing')
      or lower(btrim(coalesce(p_kitchen_status, ''))) in ('new', 'accepted', 'preparing', 'ready', 'delayed')
      or (
        lower(btrim(coalesce(p_status, ''))) = 'completed'
        and (
          lower(btrim(coalesce(p_payment_status, 'unpaid'))) <> 'paid'
          or lower(btrim(coalesce(p_billing_status, 'not_billed'))) <> 'billed'
        )
      )
    );
$$;

create or replace function public.get_staff_active_table_order(
  p_hotel_slug text,
  p_table_number text
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_hotel_key text := lower(btrim(coalesce(p_hotel_slug, '')));
  v_table_key text := lower(btrim(coalesce(p_table_number, '')));
  v_active_order public.orders%rowtype;
begin
  if v_hotel_key = '' or v_table_key = '' then return null; end if;

  select orders.* into v_active_order
    from public.orders
   where lower(btrim(orders.hotel_slug)) = v_hotel_key
     and lower(btrim(coalesce(orders.order_type, ''))) = 'dine-in'
     and lower(btrim(coalesce(orders.table_number, ''))) = v_table_key
     and orders.parent_order_id is null
     and public.is_dine_in_order_open(
       orders.status,
       orders.kitchen_status,
       orders.payment_status,
       orders.billing_status
     )
   order by orders.created_at desc, orders.id desc
   limit 1;

  if not found then return null; end if;

  return jsonb_build_object(
    'id', v_active_order.id,
    'status', v_active_order.status,
    'tableNumber', v_active_order.table_number,
    'restaurantTableId', v_active_order.restaurant_table_id,
    'createdAt', v_active_order.created_at
  );
end;
$$;

create or replace function public.sync_dine_in_order_terminal_lifecycle()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if lower(btrim(coalesce(new.order_type, ''))) <> 'dine-in'
     or new.parent_order_id is not null then
    return new;
  end if;

  if lower(btrim(coalesce(new.status, ''))) = 'cancelled' then
    new.kitchen_status := 'cancelled';
  elsif lower(btrim(coalesce(new.status, ''))) = 'completed'
        and lower(btrim(coalesce(new.kitchen_status, ''))) <> 'cancelled' then
    new.kitchen_status := 'served';
  end if;

  return new;
end;
$$;

create or replace function public.enforce_one_active_root_dine_in_order()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_hotel_key text := lower(btrim(coalesce(new.hotel_slug, '')));
  v_table_key text := lower(btrim(coalesce(new.table_number, '')));
  v_conflict jsonb;
  v_new_blocks boolean := public.is_dine_in_order_open(
    new.status,
    new.kitchen_status,
    new.payment_status,
    new.billing_status
  );
begin
  if lower(btrim(coalesce(new.order_type, ''))) <> 'dine-in'
     or new.parent_order_id is not null
     or v_hotel_key = ''
     or v_table_key = ''
     or not v_new_blocks then
    return new;
  end if;

  if tg_op = 'UPDATE'
     and new.hotel_slug is not distinct from old.hotel_slug
     and new.table_number is not distinct from old.table_number
     and new.order_type is not distinct from old.order_type
     and new.parent_order_id is not distinct from old.parent_order_id
     and new.status is not distinct from old.status
     and new.kitchen_status is not distinct from old.kitchen_status
     and new.payment_status is not distinct from old.payment_status
     and new.billing_status is not distinct from old.billing_status then
    return new;
  end if;

  perform pg_advisory_xact_lock(hashtext(v_hotel_key), hashtext(v_table_key));
  v_conflict := public.get_staff_active_table_order(new.hotel_slug, new.table_number);

  if v_conflict is not null
     and (tg_op = 'INSERT' or (v_conflict->>'id') is distinct from new.id::text) then
    raise exception using
      errcode = '23505',
      message = 'duplicate key value violates active table order guard',
      detail = format(
        'orders_one_active_root_dine_in_table_guard: table already has active order %s',
        v_conflict->>'id'
      );
  end if;

  return new;
end;
$$;

drop trigger if exists orders_00_sync_dine_in_terminal_lifecycle on public.orders;
create trigger orders_00_sync_dine_in_terminal_lifecycle
before insert or update of order_type, parent_order_id, status, kitchen_status
on public.orders
for each row
execute function public.sync_dine_in_order_terminal_lifecycle();

drop trigger if exists orders_one_active_root_dine_in_table_guard on public.orders;
create trigger orders_one_active_root_dine_in_table_guard
before insert or update of hotel_slug, table_number, order_type, parent_order_id,
  status, kitchen_status, payment_status, billing_status
on public.orders
for each row
execute function public.enforce_one_active_root_dine_in_order();

-- Repair already-settled dine-in roots whose kitchen state remained active.
update public.orders
   set kitchen_status = 'served'
 where lower(btrim(coalesce(order_type, ''))) = 'dine-in'
   and parent_order_id is null
   and lower(btrim(coalesce(status, ''))) = 'completed'
   and lower(btrim(coalesce(payment_status, 'unpaid'))) = 'paid'
   and lower(btrim(coalesce(billing_status, 'not_billed'))) = 'billed'
   and lower(btrim(coalesce(kitchen_status, ''))) in
     ('new', 'accepted', 'preparing', 'ready', 'delayed');

revoke all on function public.is_dine_in_order_open(text,text,text,text)
  from public, anon, authenticated;
revoke all on function public.get_staff_active_table_order(text,text)
  from public, anon, authenticated;
revoke all on function public.sync_dine_in_order_terminal_lifecycle()
  from public, anon, authenticated;
revoke all on function public.enforce_one_active_root_dine_in_order()
  from public, anon, authenticated;

grant execute on function public.is_dine_in_order_open(text,text,text,text)
  to service_role;
grant execute on function public.get_staff_active_table_order(text,text)
  to service_role;
grant execute on function public.sync_dine_in_order_terminal_lifecycle()
  to service_role;
grant execute on function public.enforce_one_active_root_dine_in_order()
  to service_role;

notify pgrst, 'reload schema';
