-- Stores hotel-scoped ordering controls for public/customer ordering.
-- Safe for current flow: defaults keep all existing ordering behavior enabled.

create table if not exists public.hotel_ordering_settings (
  hotel_slug text primary key,
  customer_ordering_enabled boolean not null default true,
  staff_ordering_enabled boolean not null default true,
  whatsapp_ordering_enabled boolean not null default true,
  disabled_title text,
  disabled_message text,
  disabled_button_text text,
  disabled_button_link text,
  disabled_icon text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.hotel_ordering_settings is
  'Hotel-scoped controls for customer, staff, and WhatsApp ordering availability.';

comment on column public.hotel_ordering_settings.hotel_slug is
  'Hotel tenant slug that owns these ordering controls.';

comment on column public.hotel_ordering_settings.customer_ordering_enabled is
  'Whether public website and QR customer ordering are allowed for this hotel.';

comment on column public.hotel_ordering_settings.staff_ordering_enabled is
  'Whether authenticated staff ordering is allowed for this hotel.';

comment on column public.hotel_ordering_settings.whatsapp_ordering_enabled is
  'Whether customer-facing WhatsApp order handoff is allowed for this hotel when customer ordering is otherwise enabled.';

comment on column public.hotel_ordering_settings.disabled_title is
  'Optional hotel-specific title shown when customer ordering is unavailable.';

comment on column public.hotel_ordering_settings.disabled_message is
  'Optional hotel-specific message shown when customer ordering is unavailable.';

comment on column public.hotel_ordering_settings.disabled_button_text is
  'Optional CTA label shown in the ordering-unavailable modal/card.';

comment on column public.hotel_ordering_settings.disabled_button_link is
  'Optional relative or absolute http/https CTA target shown in the ordering-unavailable modal/card.';

comment on column public.hotel_ordering_settings.disabled_icon is
  'Optional short icon or badge text, for example warning, clock, or pause.';
