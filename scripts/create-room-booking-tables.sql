-- Room booking foundation for hotel + restaurant SaaS tenants.
-- Safe first version:
-- - creates only new room-booking tables
-- - keeps existing restaurant ordering, QR ordering, KDS, billing, and payment flows unchanged
-- - defaults room booking and room service to disabled until a hotel explicitly enables them

create table if not exists public.hotel_feature_settings (
  hotel_slug text primary key,
  enable_food_module boolean not null default true,
  enable_room_module boolean not null default false,
  enable_food_ordering boolean not null default true,
  enable_room_booking boolean not null default false,
  enable_room_service boolean not null default false,
  enable_food_reports boolean not null default true,
  enable_room_reports boolean not null default false,
  enable_combined_reports boolean not null default false,
  enable_combined_billing boolean not null default false,
  version integer not null default 1 check (version > 0),
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint hotel_feature_settings_core_module_check check (
    enable_food_module or enable_room_module
  ),
  constraint hotel_feature_settings_food_dependencies check (
    enable_food_module or (
      not enable_food_ordering and
      not enable_food_reports and
      not enable_room_service and
      not enable_combined_reports and
      not enable_combined_billing
    )
  ),
  constraint hotel_feature_settings_room_dependencies check (
    enable_room_module or (
      not enable_room_booking and
      not enable_room_reports and
      not enable_room_service and
      not enable_combined_reports and
      not enable_combined_billing
    )
  ),
  constraint hotel_feature_settings_combined_dependencies check (
    (not enable_room_service or (enable_food_module and enable_room_module)) and
    (not enable_combined_reports or (enable_food_module and enable_room_module)) and
    (not enable_combined_billing or (enable_food_module and enable_room_module and enable_room_service))
  )
);

comment on table public.hotel_feature_settings is
  'Hotel-scoped feature toggles for food ordering, room booking, and room service.';

comment on column public.hotel_feature_settings.hotel_slug is
  'Hotel tenant slug that owns these feature flags.';

comment on column public.hotel_feature_settings.enable_food_ordering is
  'Whether food ordering features should be visible/available for this hotel. Defaults true to preserve existing restaurants.';

comment on column public.hotel_feature_settings.enable_room_booking is
  'Whether public/admin/staff room booking features should be visible/available for this hotel.';

comment on column public.hotel_feature_settings.enable_room_service is
  'Whether food orders may be linked to an active room booking as room service.';

comment on column public.hotel_feature_settings.enable_food_module is
  'Top-level Food Operations entitlement. All food subfeatures require this flag.';

comment on column public.hotel_feature_settings.enable_room_module is
  'Top-level Room Operations entitlement. All room subfeatures require this flag.';

create table if not exists public.hotel_feature_setting_audit (
  id bigserial primary key,
  hotel_slug text not null,
  actor_id text,
  actor_scope text not null default 'platform_admin',
  previous_config jsonb not null default '{}'::jsonb,
  next_config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_hotel_feature_setting_audit_hotel_created
  on public.hotel_feature_setting_audit (hotel_slug, created_at desc);

comment on table public.hotel_feature_setting_audit is
  'Append-only history of hotel module configuration changes. Disabling a module never deletes business data.';

create table if not exists public.room_types (
  id bigserial primary key,
  hotel_slug text not null,
  name text not null,
  description text not null default '',
  base_price numeric(12,2) not null default 0 check (base_price >= 0),
  max_adults integer not null default 2 check (max_adults >= 0),
  max_children integer not null default 0 check (max_children >= 0),
  amenities_json jsonb not null default '[]'::jsonb,
  images_json jsonb not null default '[]'::jsonb,
  cancellation_policy text not null default '',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint room_types_hotel_name_unique unique (hotel_slug, name)
);

comment on table public.room_types is
  'Hotel-scoped room categories such as Standard Room, Deluxe Room, Family Room, Suite, or Dormitory.';

comment on column public.room_types.hotel_slug is
  'Hotel tenant slug. Application code must scope all room type access by this value.';

comment on column public.room_types.amenities_json is
  'JSON array of room type amenities, for example ["Wi-Fi","AC","Breakfast"].';

comment on column public.room_types.images_json is
  'JSON array of image objects or URLs for this room type.';

create index if not exists idx_room_types_hotel_active
  on public.room_types (hotel_slug, is_active);

create table if not exists public.rooms (
  id bigserial primary key,
  hotel_slug text not null,
  room_type_id bigint references public.room_types(id) on delete set null,
  room_number text not null,
  floor text not null default '',
  title text not null default '',
  capacity integer not null default 2 check (capacity >= 0),
  max_adults integer not null default 2 check (max_adults >= 0),
  max_children integer not null default 0 check (max_children >= 0),
  bed_type text not null default '',
  base_price numeric(12,2) not null default 0 check (base_price >= 0),
  discount_price numeric(12,2) check (discount_price is null or discount_price >= 0),
  tax_percent numeric(5,2) not null default 0 check (tax_percent >= 0 and tax_percent <= 100),
  status text not null default 'available',
  amenities_json jsonb not null default '[]'::jsonb,
  images_json jsonb not null default '[]'::jsonb,
  description text not null default '',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint rooms_status_check check (
    status in ('available', 'booked', 'occupied', 'cleaning', 'maintenance', 'inactive')
  ),
  constraint rooms_hotel_room_number_unique unique (hotel_slug, room_number)
);

comment on table public.rooms is
  'Hotel-scoped physical rooms available for room booking.';

comment on column public.rooms.hotel_slug is
  'Hotel tenant slug. Application code must never trust a client-supplied hotel id.';

comment on column public.rooms.room_type_id is
  'Optional room type category. Room remains valid if a type is deleted.';

comment on column public.rooms.status is
  'Operational room status. Public booking should only consider active, available rooms.';

create index if not exists idx_rooms_hotel_status
  on public.rooms (hotel_slug, status);

create index if not exists idx_rooms_hotel_room_type
  on public.rooms (hotel_slug, room_type_id);

create index if not exists idx_rooms_hotel_active
  on public.rooms (hotel_slug, is_active);

create table if not exists public.room_bookings (
  id bigserial primary key,
  hotel_slug text not null,
  room_id bigint not null references public.rooms(id) on delete restrict,
  guest_name text not null,
  guest_phone text not null,
  guest_email text,
  guest_id_proof text,
  check_in_date date not null,
  check_out_date date not null,
  adults integer not null default 1 check (adults >= 0),
  children integer not null default 0 check (children >= 0),
  total_nights integer not null default 1 check (total_nights > 0),
  room_price numeric(12,2) not null default 0 check (room_price >= 0),
  tax_amount numeric(12,2) not null default 0 check (tax_amount >= 0),
  discount_amount numeric(12,2) not null default 0 check (discount_amount >= 0),
  total_amount numeric(12,2) not null default 0 check (total_amount >= 0),
  advance_paid numeric(12,2) not null default 0 check (advance_paid >= 0),
  balance_amount numeric(12,2) not null default 0 check (balance_amount >= 0),
  booking_status text not null default 'pending',
  payment_status text not null default 'unpaid',
  booking_source text not null default 'online',
  created_by_user_id text,
  created_by_role text,
  notes text not null default '',
  checked_in_at timestamptz,
  checked_out_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint room_bookings_date_range_check check (check_out_date > check_in_date),
  constraint room_bookings_status_check check (
    booking_status in ('pending', 'confirmed', 'checked_in', 'checked_out', 'cancelled', 'no_show')
  ),
  constraint room_bookings_payment_status_check check (
    payment_status in ('unpaid', 'partial', 'paid', 'refunded')
  ),
  constraint room_bookings_source_check check (
    booking_source in ('online', 'walk-in', 'phone', 'whatsapp', 'staff', 'admin')
  )
);

comment on table public.room_bookings is
  'Hotel-scoped room bookings. Check-in is inclusive and check-out is exclusive.';

comment on column public.room_bookings.hotel_slug is
  'Hotel tenant slug copied onto each booking for tenant-safe queries.';

comment on column public.room_bookings.check_in_date is
  'Inclusive stay start date.';

comment on column public.room_bookings.check_out_date is
  'Exclusive stay end date. Same-day checkout/check-in is allowed because checkout date is not occupied overnight.';

comment on column public.room_bookings.room_price is
  'Backend-calculated room subtotal before tax and discount.';

comment on column public.room_bookings.total_amount is
  'Backend-calculated final room booking amount.';

create index if not exists idx_room_bookings_hotel_room_dates
  on public.room_bookings (hotel_slug, room_id, check_in_date, check_out_date);

create index if not exists idx_room_bookings_hotel_status
  on public.room_bookings (hotel_slug, booking_status);

create index if not exists idx_room_bookings_hotel_payment_status
  on public.room_bookings (hotel_slug, payment_status);

create index if not exists idx_room_bookings_hotel_check_in
  on public.room_bookings (hotel_slug, check_in_date);

create index if not exists idx_room_bookings_hotel_check_out
  on public.room_bookings (hotel_slug, check_out_date);

-- Prevent overlapping active stays for the same room.
-- This enforces: existing.check_in_date < requested.check_out_date
-- and existing.check_out_date > requested.check_in_date.
-- Cancelled, checked-out, and no-show bookings do not block future availability.
create extension if not exists btree_gist;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'room_bookings_no_active_overlap'
  ) then
    alter table public.room_bookings
      add constraint room_bookings_no_active_overlap
      exclude using gist (
        room_id with =,
        daterange(check_in_date, check_out_date, '[)') with &&
      )
      where (booking_status in ('pending', 'confirmed', 'checked_in'));
  end if;
end $$;

create table if not exists public.room_booking_payments (
  id bigserial primary key,
  hotel_slug text not null,
  booking_id bigint not null references public.room_bookings(id) on delete cascade,
  amount numeric(12,2) not null check (amount > 0),
  payment_method text not null default 'cash',
  payment_status text not null default 'paid',
  transaction_id text,
  notes text not null default '',
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint room_booking_payments_status_check check (
    payment_status in ('pending', 'paid', 'failed', 'refunded')
  )
);

comment on table public.room_booking_payments is
  'Payment records collected against room bookings. Payment state should be updated by backend/staff actions only.';

comment on column public.room_booking_payments.hotel_slug is
  'Hotel tenant slug copied onto each payment for tenant-safe queries.';

create index if not exists idx_room_booking_payments_hotel_booking
  on public.room_booking_payments (hotel_slug, booking_id);

create index if not exists idx_room_booking_payments_hotel_status
  on public.room_booking_payments (hotel_slug, payment_status);
