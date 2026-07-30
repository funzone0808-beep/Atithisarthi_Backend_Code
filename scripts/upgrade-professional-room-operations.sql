-- Professional, hotel-scoped Room Operations extension.
-- Apply after create-room-booking-tables.sql.
-- All changes are additive; existing room, booking, checkout, food, KDS and bill flows remain authoritative.

create table if not exists public.hotel_floors (
  id bigserial primary key,
  hotel_slug text not null,
  floor_code text not null,
  floor_name text not null,
  display_order integer not null default 0,
  description text not null default '',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint hotel_floors_hotel_code_unique unique (hotel_slug, floor_code)
);

create index if not exists idx_hotel_floors_scope_order
  on public.hotel_floors (hotel_slug, is_active, display_order, id);

alter table public.rooms add column if not exists floor_id bigint references public.hotel_floors(id) on delete restrict;
alter table public.rooms add column if not exists base_occupancy integer not null default 1 check (base_occupancy >= 0);
alter table public.rooms add column if not exists extra_bed_limit integer not null default 0 check (extra_bed_limit >= 0);
alter table public.rooms add column if not exists smoking_policy text not null default 'unspecified'
  check (smoking_policy in ('unspecified', 'smoking', 'non_smoking'));
alter table public.rooms add column if not exists display_order integer not null default 0;
alter table public.rooms add column if not exists notes text not null default '';

create index if not exists idx_rooms_scope_floor_type_status
  on public.rooms (hotel_slug, floor_id, room_type_id, status, is_active);

alter table public.room_types add column if not exists short_code text;
alter table public.room_types add column if not exists base_capacity integer not null default 1 check (base_capacity >= 0);
alter table public.room_types add column if not exists extra_adult_rate numeric(12,2) not null default 0 check (extra_adult_rate >= 0);
alter table public.room_types add column if not exists extra_child_rate numeric(12,2) not null default 0 check (extra_child_rate >= 0);
alter table public.room_types add column if not exists check_in_time time;
alter table public.room_types add column if not exists check_out_time time;

create unique index if not exists room_types_hotel_short_code_unique
  on public.room_types (hotel_slug, lower(short_code)) where short_code is not null and short_code <> '';

create table if not exists public.room_rate_plans (
  id bigserial primary key,
  hotel_slug text not null,
  room_type_id bigint references public.room_types(id) on delete restrict,
  plan_name text not null,
  plan_code text not null,
  start_date date,
  end_date date,
  days_of_week smallint[] not null default '{}'::smallint[],
  nightly_price numeric(12,2) not null check (nightly_price >= 0),
  extra_adult_price numeric(12,2) not null default 0 check (extra_adult_price >= 0),
  extra_child_price numeric(12,2) not null default 0 check (extra_child_price >= 0),
  included_services jsonb not null default '[]'::jsonb,
  cancellation_rule text not null default '',
  minimum_stay integer not null default 1 check (minimum_stay > 0),
  maximum_stay integer check (maximum_stay is null or maximum_stay >= minimum_stay),
  priority integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint room_rate_plans_hotel_code_unique unique (hotel_slug, plan_code),
  constraint room_rate_plans_dates_check check (end_date is null or start_date is null or end_date >= start_date)
);

create index if not exists idx_room_rate_plans_lookup
  on public.room_rate_plans (hotel_slug, room_type_id, is_active, start_date, end_date, priority desc);

alter table public.room_bookings add column if not exists rate_plan_id bigint references public.room_rate_plans(id) on delete set null;
alter table public.room_bookings add column if not exists pricing_snapshot jsonb not null default '{}'::jsonb;
alter table public.room_bookings add column if not exists idempotency_key text;
alter table public.room_bookings add column if not exists previous_room_id bigint references public.rooms(id) on delete restrict;

create unique index if not exists room_bookings_scope_idempotency_unique
  on public.room_bookings (hotel_slug, idempotency_key) where idempotency_key is not null;

create table if not exists public.hotel_room_amenities (
  id bigserial primary key,
  hotel_slug text not null,
  amenity_code text not null,
  amenity_name text not null,
  description text not null default '',
  is_active boolean not null default true,
  display_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint hotel_room_amenities_scope_code_unique unique (hotel_slug, amenity_code)
);

create table if not exists public.room_maintenance (
  id bigserial primary key,
  hotel_slug text not null,
  room_id bigint not null references public.rooms(id) on delete restrict,
  maintenance_type text not null default 'repair',
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high', 'urgent')),
  description text not null,
  start_at timestamptz not null,
  end_at timestamptz,
  status text not null default 'open' check (status in ('open', 'in_progress', 'completed', 'cancelled')),
  assigned_to text,
  cost numeric(12,2) check (cost is null or cost >= 0),
  created_by_user_id text,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint room_maintenance_range_check check (end_at is null or end_at > start_at)
);

create index if not exists idx_room_maintenance_availability
  on public.room_maintenance (hotel_slug, room_id, status, start_at, end_at);

create table if not exists public.room_housekeeping_tasks (
  id bigserial primary key,
  hotel_slug text not null,
  room_id bigint not null references public.rooms(id) on delete restrict,
  booking_id bigint references public.room_bookings(id) on delete set null,
  status text not null default 'dirty' check (status in ('dirty', 'cleaning', 'clean', 'inspected')),
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high', 'urgent')),
  assigned_to text,
  notes text not null default '',
  started_at timestamptz,
  completed_at timestamptz,
  inspected_at timestamptz,
  updated_by_user_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_room_housekeeping_queue
  on public.room_housekeeping_tasks (hotel_slug, status, priority, created_at);

create table if not exists public.hotel_guest_profiles (
  id bigserial primary key,
  hotel_slug text not null,
  guest_name text not null,
  phone text not null,
  email text,
  address text not null default '',
  nationality text not null default '',
  id_type text not null default '',
  masked_id_number text not null default '',
  preferences text not null default '',
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_hotel_guest_profiles_lookup
  on public.hotel_guest_profiles (hotel_slug, phone, lower(guest_name));

create table if not exists public.guest_stays (
  id bigserial primary key,
  hotel_slug text not null,
  booking_id bigint not null references public.room_bookings(id) on delete restrict,
  guest_profile_id bigint references public.hotel_guest_profiles(id) on delete set null,
  room_id bigint not null references public.rooms(id) on delete restrict,
  stay_status text not null default 'checked_in' check (stay_status in ('checked_in', 'checked_out', 'cancelled')),
  check_in_at timestamptz not null default now(),
  expected_check_out_at timestamptz,
  checked_out_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint guest_stays_one_active_booking unique (hotel_slug, booking_id)
);

create index if not exists idx_guest_stays_active_room
  on public.guest_stays (hotel_slug, room_id, stay_status, check_in_at);

create table if not exists public.room_shifts (
  id bigserial primary key,
  hotel_slug text not null,
  booking_id bigint not null references public.room_bookings(id) on delete restrict,
  stay_id bigint references public.guest_stays(id) on delete set null,
  from_room_id bigint not null references public.rooms(id) on delete restrict,
  to_room_id bigint not null references public.rooms(id) on delete restrict,
  shift_kind text not null default 'same_type' check (shift_kind in ('same_type', 'upgrade', 'downgrade')),
  old_nightly_rate numeric(12,2) not null default 0,
  new_nightly_rate numeric(12,2) not null default 0,
  rate_difference numeric(12,2) not null default 0,
  effective_at timestamptz not null default now(),
  reason text not null,
  shifted_by_user_id text,
  created_at timestamptz not null default now(),
  constraint room_shifts_different_rooms_check check (from_room_id <> to_room_id)
);

create index if not exists idx_room_shifts_history
  on public.room_shifts (hotel_slug, booking_id, effective_at desc);

create table if not exists public.room_operation_audit (
  id bigserial primary key,
  hotel_slug text not null,
  actor_id text,
  actor_role text not null default '',
  action text not null,
  target_type text not null,
  target_id text not null,
  old_value jsonb not null default '{}'::jsonb,
  new_value jsonb not null default '{}'::jsonb,
  reason text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists idx_room_operation_audit_scope_time
  on public.room_operation_audit (hotel_slug, created_at desc, action);

-- Snapshot the trusted backend-calculated price on every booking, including legacy API callers.
create or replace function public.snapshot_room_booking_pricing()
returns trigger
language plpgsql
as $$
begin
  if new.pricing_snapshot is null or new.pricing_snapshot = '{}'::jsonb then
    new.pricing_snapshot := jsonb_build_object(
      'capturedAt', now(),
      'roomId', new.room_id,
      'ratePlanId', new.rate_plan_id,
      'totalNights', new.total_nights,
      'roomPrice', new.room_price,
      'taxAmount', new.tax_amount,
      'discountAmount', new.discount_amount,
      'totalAmount', new.total_amount,
      'currency', 'INR'
    );
  end if;
  return new;
end;
$$;

drop trigger if exists trg_room_booking_pricing_snapshot on public.room_bookings;
create trigger trg_room_booking_pricing_snapshot
before insert on public.room_bookings
for each row execute function public.snapshot_room_booking_pricing();

-- The API calls this function for room moves so both room locks, availability recheck,
-- booking update, stay update, shift history and audit entry commit atomically.
create or replace function public.shift_room_booking(
  p_hotel_slug text,
  p_booking_id bigint,
  p_target_room_id bigint,
  p_reason text,
  p_actor_id text,
  p_actor_role text,
  p_effective_at timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_booking room_bookings%rowtype;
  v_source rooms%rowtype;
  v_target rooms%rowtype;
  v_shift_kind text;
  v_old_rate numeric(12,2);
  v_new_rate numeric(12,2);
  v_shift_id bigint;
begin
  select * into v_booking from room_bookings
   where id = p_booking_id and hotel_slug = p_hotel_slug for update;
  if not found or v_booking.booking_status <> 'checked_in' then
    raise exception using errcode = 'P0001', message = 'ACTIVE_STAY_REQUIRED';
  end if;

  select * into v_source from rooms
   where id = v_booking.room_id and hotel_slug = p_hotel_slug for update;
  select * into v_target from rooms
   where id = p_target_room_id and hotel_slug = p_hotel_slug for update;
  if not found or v_target.is_active = false or v_target.status in ('maintenance', 'inactive', 'cleaning') then
    raise exception using errcode = 'P0001', message = 'TARGET_ROOM_UNAVAILABLE';
  end if;
  if v_source.id = v_target.id then
    raise exception using errcode = 'P0001', message = 'TARGET_ROOM_MUST_DIFFER';
  end if;
  if exists (
    select 1 from room_bookings b
     where b.hotel_slug = p_hotel_slug and b.room_id = v_target.id and b.id <> v_booking.id
       and b.booking_status in ('pending', 'confirmed', 'checked_in')
       and b.check_in_date < v_booking.check_out_date and b.check_out_date > current_date
  ) or exists (
    select 1 from room_maintenance m
     where m.hotel_slug = p_hotel_slug and m.room_id = v_target.id
       and m.status in ('open', 'in_progress')
       and m.start_at < coalesce(v_booking.check_out_date::timestamptz, 'infinity')
       and coalesce(m.end_at, 'infinity') > p_effective_at
  ) then
    raise exception using errcode = '23P01', message = 'ROOM_ALREADY_BOOKED';
  end if;

  v_old_rate := coalesce(v_source.discount_price, v_source.base_price, 0);
  v_new_rate := coalesce(v_target.discount_price, v_target.base_price, 0);
  v_shift_kind := case when v_new_rate > v_old_rate then 'upgrade' when v_new_rate < v_old_rate then 'downgrade' else 'same_type' end;

  update room_bookings set previous_room_id = room_id, room_id = v_target.id, updated_at = now()
   where id = v_booking.id and hotel_slug = p_hotel_slug;
  update guest_stays set room_id = v_target.id, updated_at = now()
   where booking_id = v_booking.id and hotel_slug = p_hotel_slug and stay_status = 'checked_in';
  insert into room_housekeeping_tasks (hotel_slug, room_id, booking_id, status, priority, notes, updated_by_user_id)
  values (p_hotel_slug, v_source.id, v_booking.id, 'dirty', 'high', 'Room released after guest move', p_actor_id);

  insert into room_shifts (hotel_slug, booking_id, stay_id, from_room_id, to_room_id, shift_kind, old_nightly_rate, new_nightly_rate, rate_difference, effective_at, reason, shifted_by_user_id)
  values (p_hotel_slug, v_booking.id, (select id from guest_stays where hotel_slug=p_hotel_slug and booking_id=v_booking.id limit 1), v_source.id, v_target.id, v_shift_kind, v_old_rate, v_new_rate, v_new_rate-v_old_rate, p_effective_at, p_reason, p_actor_id)
  returning id into v_shift_id;

  insert into room_operation_audit (hotel_slug, actor_id, actor_role, action, target_type, target_id, old_value, new_value, reason)
  values (p_hotel_slug, p_actor_id, p_actor_role, 'room_shifted', 'room_booking', v_booking.id::text,
    jsonb_build_object('roomId', v_source.id, 'rate', v_old_rate), jsonb_build_object('roomId', v_target.id, 'rate', v_new_rate, 'shiftId', v_shift_id), p_reason);

  return jsonb_build_object('shiftId', v_shift_id, 'bookingId', v_booking.id, 'fromRoomId', v_source.id, 'toRoomId', v_target.id, 'shiftKind', v_shift_kind, 'rateDifference', v_new_rate-v_old_rate);
end;
$$;

-- Keep a durable stay record and create turnover work when the existing booking
-- lifecycle endpoints check a guest in or out. Room.status remains operational,
-- so a present stay never becomes a permanent future-date booking flag.
create or replace function public.sync_guest_stay_from_booking_status()
returns trigger
language plpgsql
as $$
begin
  if new.booking_status = 'checked_in' and old.booking_status is distinct from 'checked_in' then
    insert into guest_stays (hotel_slug, booking_id, room_id, stay_status, check_in_at, expected_check_out_at, updated_at)
    values (new.hotel_slug, new.id, new.room_id, 'checked_in', coalesce(new.checked_in_at, now()), new.check_out_date::timestamptz, now())
    on conflict (hotel_slug, booking_id) do update
      set room_id=excluded.room_id, stay_status='checked_in', check_in_at=excluded.check_in_at,
          expected_check_out_at=excluded.expected_check_out_at, checked_out_at=null, updated_at=now();
  elsif new.booking_status = 'checked_out' and old.booking_status is distinct from 'checked_out' then
    update guest_stays set stay_status='checked_out', checked_out_at=coalesce(new.checked_out_at,now()), updated_at=now()
      where hotel_slug=new.hotel_slug and booking_id=new.id;
    insert into room_housekeeping_tasks (hotel_slug, room_id, booking_id, status, priority, notes)
    values (new.hotel_slug, new.room_id, new.id, 'dirty', 'high', 'Checkout room turnaround');
  end if;
  return new;
end;
$$;

drop trigger if exists trg_sync_guest_stay_from_booking_status on public.room_bookings;
create trigger trg_sync_guest_stay_from_booking_status
after update of booking_status on public.room_bookings
for each row execute function public.sync_guest_stay_from_booking_status();

create or replace function public.extend_room_booking(
  p_hotel_slug text,
  p_booking_id bigint,
  p_new_check_out date,
  p_actor_id text,
  p_actor_role text,
  p_reason text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_booking room_bookings%rowtype;
  v_room rooms%rowtype;
  v_nights integer;
  v_nightly numeric(12,2);
  v_room_price numeric(12,2);
  v_tax numeric(12,2);
  v_total numeric(12,2);
begin
  select * into v_booking from room_bookings where id=p_booking_id and hotel_slug=p_hotel_slug for update;
  if not found or v_booking.booking_status not in ('confirmed','checked_in') then
    raise exception using errcode='P0001', message='ACTIVE_BOOKING_REQUIRED';
  end if;
  if p_new_check_out <= v_booking.check_out_date then
    raise exception using errcode='P0001', message='NEW_CHECKOUT_MUST_BE_LATER';
  end if;
  perform 1 from rooms where id=v_booking.room_id and hotel_slug=p_hotel_slug for update;
  if exists (select 1 from room_bookings b where b.hotel_slug=p_hotel_slug and b.room_id=v_booking.room_id and b.id<>v_booking.id
    and b.booking_status in ('pending','confirmed','checked_in') and b.check_in_date < p_new_check_out and b.check_out_date > v_booking.check_out_date) then
    raise exception using errcode='23P01', message='ROOM_ALREADY_BOOKED';
  end if;
  select * into v_room from rooms where id=v_booking.room_id and hotel_slug=p_hotel_slug;
  v_nights := p_new_check_out - v_booking.check_in_date;
  v_nightly := coalesce(nullif(v_booking.room_price,0) / nullif(v_booking.total_nights,0), v_room.discount_price, v_room.base_price, 0);
  v_room_price := round(v_nightly * v_nights, 2);
  v_tax := round(v_room_price * coalesce(v_room.tax_percent,0) / 100, 2);
  v_total := greatest(0, v_room_price + v_tax - coalesce(v_booking.discount_amount,0));
  update room_bookings set check_out_date=p_new_check_out, total_nights=v_nights, room_price=v_room_price,
    tax_amount=v_tax, total_amount=v_total, balance_amount=greatest(0,v_total-coalesce(advance_paid,0)), updated_at=now()
    where id=v_booking.id and hotel_slug=p_hotel_slug;
  update guest_stays set expected_check_out_at=p_new_check_out::timestamptz, updated_at=now()
    where booking_id=v_booking.id and hotel_slug=p_hotel_slug and stay_status='checked_in';
  insert into room_operation_audit (hotel_slug,actor_id,actor_role,action,target_type,target_id,old_value,new_value,reason)
  values (p_hotel_slug,p_actor_id,p_actor_role,'stay_extended','room_booking',v_booking.id::text,
    jsonb_build_object('checkOutDate',v_booking.check_out_date,'totalAmount',v_booking.total_amount),
    jsonb_build_object('checkOutDate',p_new_check_out,'totalAmount',v_total),p_reason);
  return jsonb_build_object('bookingId',v_booking.id,'checkOutDate',p_new_check_out,'totalNights',v_nights,'totalAmount',v_total,'balanceAmount',greatest(0,v_total-coalesce(v_booking.advance_paid,0)));
end;
$$;

revoke all on function public.shift_room_booking(text,bigint,bigint,text,text,text,timestamptz) from public, anon, authenticated;
revoke all on function public.extend_room_booking(text,bigint,date,text,text,text) from public, anon, authenticated;
grant execute on function public.shift_room_booking(text,bigint,bigint,text,text,text,timestamptz) to service_role;
grant execute on function public.extend_room_booking(text,bigint,date,text,text,text) to service_role;
