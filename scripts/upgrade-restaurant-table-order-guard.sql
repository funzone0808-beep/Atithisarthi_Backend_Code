-- Run after create-restaurant-table-master.sql.
-- Extends the existing cross-channel guard with table-master row validation,
-- authoritative table-id linkage, and billing-pending occupancy.

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
     and (
       lower(btrim(coalesce(orders.status, 'new'))) in ('new', 'confirmed', 'preparing')
       or lower(btrim(coalesce(orders.kitchen_status, ''))) in ('new', 'accepted', 'preparing', 'ready', 'delayed')
       or (
         lower(btrim(coalesce(orders.status, ''))) = 'completed'
         and lower(btrim(coalesce(orders.payment_status, 'unpaid'))) <> 'paid'
       )
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
  v_new_blocks boolean :=
    lower(btrim(coalesce(new.status, 'new'))) in ('new', 'confirmed', 'preparing')
    or lower(btrim(coalesce(new.kitchen_status, ''))) in ('new', 'accepted', 'preparing', 'ready', 'delayed')
    or (
      lower(btrim(coalesce(new.status, ''))) = 'completed'
      and lower(btrim(coalesce(new.payment_status, 'unpaid'))) <> 'paid'
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
     and new.payment_status is not distinct from old.payment_status then
    return new;
  end if;

  perform pg_advisory_xact_lock(hashtext(v_hotel_key), hashtext(v_table_key));
  v_conflict := public.get_staff_active_table_order(new.hotel_slug, new.table_number);

  if v_conflict is not null and (tg_op = 'INSERT' or (v_conflict->>'id') is distinct from new.id::text) then
    raise exception using
      errcode = '23505',
      message = 'duplicate key value violates active table order guard',
      detail = format('orders_one_active_root_dine_in_table_guard: table already has active order %s', v_conflict->>'id');
  end if;

  return new;
end;
$$;

drop trigger if exists orders_one_active_root_dine_in_table_guard on public.orders;
create trigger orders_one_active_root_dine_in_table_guard
before insert or update of hotel_slug, table_number, order_type, parent_order_id, status, kitchen_status, payment_status
on public.orders
for each row
execute function public.enforce_one_active_root_dine_in_order();

create or replace function public.create_staff_table_order_if_available(p_order jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_hotel_slug text := btrim(coalesce(p_order->>'hotel_slug', ''));
  v_table_number text := btrim(coalesce(p_order->>'table_number', ''));
  v_hotel_key text := lower(v_hotel_slug);
  v_table_key text := lower(v_table_number);
  v_table_id bigint := case
    when coalesce(p_order->>'restaurant_table_id', '') ~ '^[0-9]+$'
      then (p_order->>'restaurant_table_id')::bigint
    else null
  end;
  v_enforce boolean := false;
  v_table public.restaurant_tables%rowtype;
  v_active_order jsonb;
  v_created_order public.orders%rowtype;
begin
  if v_hotel_key = '' or v_table_key = '' then
    raise exception using errcode = '22023', message = 'hotel_slug and table_number are required';
  end if;

  select coalesce(settings.enforce_table_master, false)
    into v_enforce
    from public.hotel_ordering_settings settings
   where lower(btrim(settings.hotel_slug)) = v_hotel_key;
  v_enforce := coalesce(v_enforce, false);

  if v_table_id is not null then
    select tables.* into v_table
      from public.restaurant_tables tables
     where tables.id = v_table_id
       and lower(btrim(tables.hotel_slug)) = v_hotel_key
     for update;
  else
    select tables.* into v_table
      from public.restaurant_tables tables
     where lower(btrim(tables.hotel_slug)) = v_hotel_key
       and lower(btrim(tables.table_code)) = v_table_key
     for update;
  end if;

  if found then
    if not v_table.is_active or v_table.operational_status <> 'active' then
      raise exception using errcode = 'P0001', message = 'TABLE_NOT_OPERATIONAL';
    end if;
    v_table_id := v_table.id;
    v_table_number := v_table.table_code;
    v_table_key := lower(btrim(v_table_number));
  elsif v_table_id is not null or v_enforce then
    raise exception using errcode = 'P0001', message = 'TABLE_NOT_CONFIGURED';
  end if;

  perform pg_advisory_xact_lock(hashtext(v_hotel_key), hashtext(v_table_key));
  v_active_order := public.get_staff_active_table_order(v_hotel_slug, v_table_number);
  if v_active_order is not null then
    return jsonb_build_object('created', false, 'code', 'TABLE_HAS_ACTIVE_ORDER', 'activeOrder', v_active_order);
  end if;

  begin
    insert into public.orders (
      hotel_name, hotel_slug, customer_name, customer_phone, customer_address,
      payment_method, note, items, totals, whatsapp_message, status, order_type,
      restaurant_table_id, table_number, order_source, payment_status, billing_status,
      created_by_staff_id, tracking_token, tracking_token_created_at
    ) values (
      coalesce(p_order->>'hotel_name', ''), v_hotel_slug,
      coalesce(p_order->>'customer_name', ''), coalesce(p_order->>'customer_phone', ''),
      coalesce(p_order->>'customer_address', ''), coalesce(p_order->>'payment_method', 'COD'),
      coalesce(p_order->>'note', ''), coalesce(p_order->'items', '[]'::jsonb),
      coalesce(p_order->'totals', '{}'::jsonb), coalesce(p_order->>'whatsapp_message', ''),
      'new', 'dine-in', v_table_id, v_table_number,
      coalesce(p_order->>'order_source', 'staff'), 'unpaid', 'not_billed',
      nullif(p_order->>'created_by_staff_id', '')::bigint,
      nullif(p_order->>'tracking_token', ''),
      nullif(p_order->>'tracking_token_created_at', '')::timestamptz
    ) returning * into v_created_order;
  exception when unique_violation then
    v_active_order := public.get_staff_active_table_order(v_hotel_slug, v_table_number);
    if v_active_order is null then raise; end if;
    return jsonb_build_object('created', false, 'code', 'TABLE_HAS_ACTIVE_ORDER', 'activeOrder', v_active_order);
  end;

  return jsonb_build_object('created', true, 'order', to_jsonb(v_created_order));
end;
$$;

revoke all on function public.get_staff_active_table_order(text, text) from public, anon, authenticated;
revoke all on function public.create_staff_table_order_if_available(jsonb) from public, anon, authenticated;
revoke all on function public.enforce_one_active_root_dine_in_order() from public, anon, authenticated;
grant execute on function public.get_staff_active_table_order(text, text) to service_role;
grant execute on function public.create_staff_table_order_if_available(jsonb) to service_role;
grant execute on function public.enforce_one_active_root_dine_in_order() to service_role;
