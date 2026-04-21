-- Stores private hotel-specific Razorpay Route configuration.
-- Safe for current flow: no checkout/payment code reads this table yet.

create table if not exists public.hotel_payment_route_settings (
  hotel_slug text primary key,
  provider text not null default 'razorpay',
  route_enabled boolean not null default false,
  razorpay_linked_account_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint hotel_payment_route_settings_provider_check
    check (provider in ('razorpay')),
  constraint hotel_payment_route_settings_linked_account_check
    check (
      razorpay_linked_account_id is null
      or razorpay_linked_account_id = ''
      or razorpay_linked_account_id ~ '^acc_[A-Za-z0-9]+$'
    )
);

comment on table public.hotel_payment_route_settings is
  'Private per-hotel payment routing settings used for Razorpay Route / Linked Accounts.';

comment on column public.hotel_payment_route_settings.hotel_slug is
  'Hotel tenant slug this payment routing config belongs to.';

comment on column public.hotel_payment_route_settings.route_enabled is
  'Whether Razorpay Route transfers are allowed for this hotel once checkout integration is enabled.';

comment on column public.hotel_payment_route_settings.razorpay_linked_account_id is
  'Razorpay Route linked account id for this hotel, for example acc_xxxxx. This is not a secret key.';

create index if not exists idx_hotel_payment_route_settings_enabled
  on public.hotel_payment_route_settings (route_enabled)
  where route_enabled = true;
