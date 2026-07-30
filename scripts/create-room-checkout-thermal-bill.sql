-- Hotel-scoped Room Checkout Thermal Bill and Bill Format Master.
-- Additive migration: existing checkout, settlement, payment, order, and booking
-- tables/functions remain unchanged.

create table if not exists public.room_checkout_bill_formats (
  id bigserial primary key,
  hotel_slug text not null,
  template_name text not null default 'Default thermal guest folio',
  paper_width text not null default '80',
  company_name text not null default '',
  property_subtitle text not null default '',
  logo_url text not null default '',
  logo_storage_path text not null default '',
  logo_alt_text text not null default '',
  address_line_1 text not null default '',
  address_line_2 text not null default '',
  city text not null default '',
  state text not null default '',
  postal_code text not null default '',
  country text not null default '',
  phone text not null default '',
  alternate_phone text not null default '',
  email text not null default '',
  website_url text not null default '',
  tax_id text not null default '',
  licence_number text not null default '',
  registration_number text not null default '',
  bill_title text not null default 'HOTEL CHECKOUT BILL / GUEST FOLIO',
  labels_json jsonb not null default '{}'::jsonb,
  privacy_json jsonb not null default '{}'::jsonb,
  display_json jsonb not null default '{}'::jsonb,
  qr_json jsonb not null default '{}'::jsonb,
  print_json jsonb not null default '{}'::jsonb,
  messages_json jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  version integer not null default 1 check (version > 0),
  created_by text,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint room_checkout_bill_formats_hotel_unique unique (hotel_slug),
  constraint room_checkout_bill_formats_paper_width_check
    check (paper_width in ('58', '80')),
  constraint room_checkout_bill_formats_json_check check (
    jsonb_typeof(labels_json) = 'object' and
    jsonb_typeof(privacy_json) = 'object' and
    jsonb_typeof(display_json) = 'object' and
    jsonb_typeof(qr_json) = 'object' and
    jsonb_typeof(print_json) = 'object' and
    jsonb_typeof(messages_json) = 'object'
  )
);

create unique index if not exists uq_room_checkout_bill_formats_active_hotel
  on public.room_checkout_bill_formats (hotel_slug)
  where is_active;

create index if not exists idx_room_checkout_bill_formats_hotel_version
  on public.room_checkout_bill_formats (hotel_slug, version desc);

comment on table public.room_checkout_bill_formats is
  'One active hotel-owned Room Checkout Thermal Bill presentation configuration.';

create table if not exists public.room_checkout_bill_snapshots (
  id bigserial primary key,
  hotel_slug text not null,
  booking_id bigint not null references public.room_bookings(id) on delete restrict,
  checkout_receipt_id bigint references public.room_checkout_receipts(id) on delete restrict,
  folio_number text not null,
  invoice_number text,
  snapshot_version integer not null default 1 check (snapshot_version > 0),
  template_version integer not null default 1 check (template_version > 0),
  snapshot_json jsonb not null,
  payload_hash text not null,
  reprint_count integer not null default 0 check (reprint_count >= 0),
  issued_by text,
  issued_by_role text not null default '',
  issued_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint room_checkout_bill_snapshots_hotel_booking_unique
    unique (hotel_slug, booking_id),
  constraint room_checkout_bill_snapshots_hotel_folio_unique
    unique (hotel_slug, folio_number),
  constraint room_checkout_bill_snapshots_json_check
    check (jsonb_typeof(snapshot_json) = 'object'),
  constraint room_checkout_bill_snapshots_hash_check
    check (payload_hash ~ '^[a-f0-9]{64}$')
);

create unique index if not exists uq_room_checkout_bill_snapshots_hotel_invoice
  on public.room_checkout_bill_snapshots (hotel_slug, invoice_number)
  where invoice_number is not null;

create index if not exists idx_room_checkout_bill_snapshots_hotel_issued
  on public.room_checkout_bill_snapshots (hotel_slug, issued_at desc);

comment on table public.room_checkout_bill_snapshots is
  'Immutable issued guest-folio payload. Only reprint_count and updated_at may change.';

create or replace function public.protect_room_checkout_bill_snapshot()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if
    new.hotel_slug is distinct from old.hotel_slug or
    new.booking_id is distinct from old.booking_id or
    new.checkout_receipt_id is distinct from old.checkout_receipt_id or
    new.folio_number is distinct from old.folio_number or
    new.invoice_number is distinct from old.invoice_number or
    new.snapshot_version is distinct from old.snapshot_version or
    new.template_version is distinct from old.template_version or
    new.snapshot_json is distinct from old.snapshot_json or
    new.payload_hash is distinct from old.payload_hash or
    new.issued_by is distinct from old.issued_by or
    new.issued_by_role is distinct from old.issued_by_role or
    new.issued_at is distinct from old.issued_at or
    new.created_at is distinct from old.created_at
  then
    raise exception using
      errcode = '23514',
      message = 'Issued room checkout bill snapshots are immutable';
  end if;

  if new.reprint_count < old.reprint_count then
    raise exception using
      errcode = '23514',
      message = 'Room checkout bill reprint count cannot decrease';
  end if;
  return new;
end;
$$;

drop trigger if exists room_checkout_bill_snapshots_protect
  on public.room_checkout_bill_snapshots;

create trigger room_checkout_bill_snapshots_protect
before update on public.room_checkout_bill_snapshots
for each row execute function public.protect_room_checkout_bill_snapshot();

create table if not exists public.room_checkout_bill_audit (
  id bigserial primary key,
  hotel_slug text not null,
  actor_id text,
  actor_role text not null default '',
  action text not null,
  booking_id bigint,
  snapshot_id bigint references public.room_checkout_bill_snapshots(id) on delete set null,
  format_version integer,
  details_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint room_checkout_bill_audit_details_check
    check (jsonb_typeof(details_json) = 'object')
);

create index if not exists idx_room_checkout_bill_audit_hotel_created
  on public.room_checkout_bill_audit (hotel_slug, created_at desc);

create index if not exists idx_room_checkout_bill_audit_hotel_booking
  on public.room_checkout_bill_audit (hotel_slug, booking_id, created_at desc);

comment on table public.room_checkout_bill_audit is
  'Append-only hotel-scoped audit history for bill format, issue, print, download, and reprint actions.';

insert into public.room_checkout_bill_formats (
  hotel_slug,
  company_name,
  property_subtitle,
  logo_url,
  address_line_1,
  phone,
  email,
  website_url,
  labels_json,
  privacy_json,
  display_json,
  qr_json,
  print_json,
  messages_json
)
select
  profile.hotel_slug,
  coalesce(profile.hotel_name, profile.hotel_slug),
  coalesce(profile.tagline, ''),
  coalesce(profile.branding ->> 'logoUrl', profile.branding ->> 'logo', ''),
  coalesce(profile.contact ->> 'address', profile.location ->> 'address', ''),
  coalesce(profile.contact ->> 'phone', profile.contact ->> 'mobile', ''),
  coalesce(profile.contact ->> 'email', ''),
  coalesce(profile.contact ->> 'website', profile.contact ->> 'websiteUrl', ''),
  '{
    "folio":"Folio No.",
    "invoice":"Receipt No.",
    "bookingReference":"Booking Ref.",
    "paymentStatus":"Payment",
    "currency":"Currency",
    "room":"Room",
    "roomType":"Type",
    "checkIn":"Check-in",
    "checkOut":"Check-out",
    "grandTotal":"GRAND TOTAL",
    "paid":"Paid",
    "balance":"Balance"
  }'::jsonb,
  '{
    "showGuestName":true,
    "maskGuestPhone":true,
    "maskGuestEmail":true,
    "maskGuestId":true,
    "showGuestAddress":false,
    "showGuestCount":true,
    "showSignatureLines":true
  }'::jsonb,
  '{
    "showHotelLogo":true,
    "showRoomType":true,
    "showPaymentMethod":true,
    "showCashier":true,
    "showQrCode":true,
    "showDiscount":true,
    "showAdvance":true,
    "showBalance":true,
    "showPaymentBreakdown":true,
    "hideZeroTotals":true
  }'::jsonb,
  jsonb_build_object(
    'enabled', false,
    'type', 'website',
    'value', coalesce(profile.contact ->> 'website', profile.contact ->> 'websiteUrl', ''),
    'caption', 'Scan to visit our website',
    'size', 112,
    'alignment', 'center'
  ),
  '{
    "fontScale":1,
    "logoWidthMm":22,
    "marginMm":2,
    "lineSpacing":1.15,
    "separatorStyle":"dashed",
    "printCopies":1,
    "autoPrintAfterCheckout":false
  }'::jsonb,
  '{
    "thankYou":"Thank you for staying with us.",
    "feedback":"",
    "support":"",
    "footer":"",
    "legalNote":"This is a computer-generated guest folio."
  }'::jsonb
from public.hotel_profiles as profile
on conflict (hotel_slug) do nothing;

revoke all on table public.room_checkout_bill_formats from anon, authenticated;
revoke all on table public.room_checkout_bill_snapshots from anon, authenticated;
revoke all on table public.room_checkout_bill_audit from anon, authenticated;
revoke all on function public.protect_room_checkout_bill_snapshot()
  from public, anon, authenticated;

grant select, insert, update, delete on table public.room_checkout_bill_formats to service_role;
grant select, insert, update on table public.room_checkout_bill_snapshots to service_role;
grant select, insert on table public.room_checkout_bill_audit to service_role;
grant usage, select on all sequences in schema public to service_role;
