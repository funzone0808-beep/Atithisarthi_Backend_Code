-- Atomically prevents two root dine-in orders from occupying the same hotel table.
-- Active table policy: new, confirmed, and preparing root orders occupy a table.
-- QR add-on rows are intentionally excluded through parent_order_id is null.
-- Prerequisites: order table-context, billing, add-on metadata, tracking, and
-- staff-attribution migrations must already be applied.

-- The trigger below is the final cross-channel invariant. Unlike a unique
-- index, it can be installed safely when legacy duplicate active orders already
-- exist. It serializes and rejects future conflicting root inserts without
-- rewriting production history.
create or replace function public.enforce_one_active_root_dine_in_order()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_hotel_key text := lower(btrim(coalesce(new.hotel_slug, '')));
  v_table_key text := lower(btrim(coalesce(new.table_number, '')));
  v_conflicting_order_id text;
begin
  if lower(btrim(coalesce(new.order_type, ''))) <> 'dine-in'
     or new.parent_order_id is not null
     or v_hotel_key = ''
     or v_table_key = ''
     or lower(btrim(coalesce(new.status, 'new'))) not in ('new', 'confirmed', 'preparing') then
    return new;
  end if;

  if tg_op = 'UPDATE'
     and new.hotel_slug is not distinct from old.hotel_slug
     and new.table_number is not distinct from old.table_number
     and new.order_type is not distinct from old.order_type
     and new.parent_order_id is not distinct from old.parent_order_id
     and new.status is not distinct from old.status then
    return new;
  end if;

  perform pg_advisory_xact_lock(hashtext(v_hotel_key), hashtext(v_table_key));

  select orders.id::text
    into v_conflicting_order_id
    from public.orders
   where lower(btrim(orders.hotel_slug)) = v_hotel_key
     and lower(btrim(coalesce(orders.order_type, ''))) = 'dine-in'
     and lower(btrim(coalesce(orders.table_number, ''))) = v_table_key
     and orders.parent_order_id is null
     and lower(btrim(coalesce(orders.status, 'new'))) in ('new', 'confirmed', 'preparing')
     and (tg_op = 'INSERT' or orders.id is distinct from new.id)
   order by orders.created_at desc
   limit 1;

  if v_conflicting_order_id is not null then
    raise exception using
      errcode = '23505',
      message = 'duplicate key value violates active table order guard',
      detail = format(
        'orders_one_active_root_dine_in_table_guard: table already has active order %s',
        v_conflicting_order_id
      );
  end if;

  return new;
end;
$$;

drop trigger if exists orders_one_active_root_dine_in_table_guard on public.orders;

create trigger orders_one_active_root_dine_in_table_guard
before insert or update of hotel_slug, table_number, order_type, parent_order_id, status
on public.orders
for each row
execute function public.enforce_one_active_root_dine_in_order();

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
  if v_hotel_key = '' or v_table_key = '' then
    return null;
  end if;

  select orders.*
    into v_active_order
    from public.orders
   where lower(btrim(orders.hotel_slug)) = v_hotel_key
     and lower(btrim(coalesce(orders.order_type, ''))) = 'dine-in'
     and lower(btrim(coalesce(orders.table_number, ''))) = v_table_key
     and orders.parent_order_id is null
     and lower(btrim(coalesce(orders.status, 'new'))) in ('new', 'confirmed', 'preparing')
   order by orders.created_at desc
   limit 1;

  if not found then
    return null;
  end if;

  return jsonb_build_object(
    'id', v_active_order.id,
    'status', v_active_order.status,
    'tableNumber', v_active_order.table_number,
    'createdAt', v_active_order.created_at
  );
end;
$$;

create or replace function public.create_staff_table_order_if_available(
  p_order jsonb
)
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
  v_active_order jsonb;
  v_created_order public.orders%rowtype;
begin
  if v_hotel_key = '' or v_table_key = '' then
    raise exception using
      errcode = '22023',
      message = 'hotel_slug and table_number are required';
  end if;

  -- The transaction-scoped lock serializes staff attempts for one normalized
  -- hotel/table pair. Hash collisions only cause harmless extra serialization.
  perform pg_advisory_xact_lock(hashtext(v_hotel_key), hashtext(v_table_key));

  v_active_order := public.get_staff_active_table_order(v_hotel_slug, v_table_number);

  if v_active_order is not null then
    return jsonb_build_object(
      'created', false,
      'code', 'TABLE_HAS_ACTIVE_ORDER',
      'activeOrder', v_active_order
    );
  end if;

  begin
    insert into public.orders (
      hotel_name,
      hotel_slug,
      customer_name,
      customer_phone,
      customer_address,
      payment_method,
      note,
      items,
      totals,
      whatsapp_message,
      status,
      order_type,
      table_number,
      order_source,
      payment_status,
      billing_status,
      created_by_staff_id,
      tracking_token,
      tracking_token_created_at
    ) values (
      coalesce(p_order->>'hotel_name', ''),
      v_hotel_slug,
      coalesce(p_order->>'customer_name', ''),
      coalesce(p_order->>'customer_phone', ''),
      coalesce(p_order->>'customer_address', ''),
      coalesce(p_order->>'payment_method', 'COD'),
      coalesce(p_order->>'note', ''),
      coalesce(p_order->'items', '[]'::jsonb),
      coalesce(p_order->'totals', '{}'::jsonb),
      coalesce(p_order->>'whatsapp_message', ''),
      'new',
      'dine-in',
      v_table_number,
      coalesce(p_order->>'order_source', 'staff'),
      'unpaid',
      'not_billed',
      nullif(p_order->>'created_by_staff_id', '')::bigint,
      nullif(p_order->>'tracking_token', ''),
      nullif(p_order->>'tracking_token_created_at', '')::timestamptz
    )
    returning * into v_created_order;
  exception
    when unique_violation then
      v_active_order := public.get_staff_active_table_order(v_hotel_slug, v_table_number);

      if v_active_order is null then
        raise;
      end if;

      return jsonb_build_object(
        'created', false,
        'code', 'TABLE_HAS_ACTIVE_ORDER',
        'activeOrder', v_active_order
      );
  end;

  return jsonb_build_object(
    'created', true,
    'order', to_jsonb(v_created_order)
  );
end;
$$;

revoke all on function public.get_staff_active_table_order(text, text) from public;
revoke all on function public.create_staff_table_order_if_available(jsonb) from public;
revoke all on function public.enforce_one_active_root_dine_in_order() from public;
revoke all on function public.get_staff_active_table_order(text, text) from anon, authenticated;
revoke all on function public.create_staff_table_order_if_available(jsonb) from anon, authenticated;
revoke all on function public.enforce_one_active_root_dine_in_order() from anon, authenticated;
grant execute on function public.get_staff_active_table_order(text, text) to service_role;
grant execute on function public.create_staff_table_order_if_available(jsonb) to service_role;
grant execute on function public.enforce_one_active_root_dine_in_order() to service_role;

comment on function public.get_staff_active_table_order(text, text) is
  'Returns one hotel-scoped active root dine-in order for a normalized table number.';

comment on function public.create_staff_table_order_if_available(jsonb) is
  'Atomically locks a hotel/table scope, rejects an existing active root dine-in order, or creates a staff order.';
