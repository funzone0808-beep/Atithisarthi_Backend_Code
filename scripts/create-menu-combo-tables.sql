-- Adds production-safe combo support on top of the existing menu_items table.
-- Safe first version:
-- - existing normal menu items keep working unchanged
-- - combos are stored as regular sellable menu rows with item_type = 'combo'
-- - combo child item composition stays in additive side tables
-- - no current order, billing, QR, or payment flow is rewritten by this script

alter table public.menu_items
  add column if not exists item_type text not null default 'single';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'menu_items_item_type_check'
  ) then
    alter table public.menu_items
      add constraint menu_items_item_type_check
      check (item_type in ('single', 'combo'));
  end if;
end $$;

comment on column public.menu_items.item_type is
  'Additive item type. Existing records default to single. Sellable combo rows use combo.';

create index if not exists idx_menu_items_hotel_slug_item_type
  on public.menu_items (hotel_slug, item_type);

create table if not exists public.menu_combo_items (
  id bigserial primary key,
  hotel_slug text not null,
  combo_item_id text not null,
  child_item_id text not null,
  quantity integer not null default 1 check (quantity > 0),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint menu_combo_items_combo_child_unique
    unique (hotel_slug, combo_item_id, child_item_id)
);

comment on table public.menu_combo_items is
  'Maps one sellable combo menu item to its included child menu items inside the same hotel.';

comment on column public.menu_combo_items.hotel_slug is
  'Hotel tenant slug. Application validation must ensure the combo row and all child rows belong to this hotel.';

comment on column public.menu_combo_items.combo_item_id is
  'Parent sellable combo key. This should match menu_items.item_id where menu_items.item_type = combo.';

comment on column public.menu_combo_items.child_item_id is
  'Included child menu key. This should match another menu_items.item_id in the same hotel.';

create index if not exists idx_menu_combo_items_hotel_combo_sort
  on public.menu_combo_items (hotel_slug, combo_item_id, sort_order, id);

create index if not exists idx_menu_combo_items_hotel_child
  on public.menu_combo_items (hotel_slug, child_item_id);

create table if not exists public.menu_combo_settings (
  hotel_slug text not null,
  combo_item_id text not null,
  start_date date,
  end_date date,
  start_time time,
  end_time time,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (hotel_slug, combo_item_id),
  constraint menu_combo_settings_date_range_check
    check (start_date is null or end_date is null or end_date >= start_date)
);

comment on table public.menu_combo_settings is
  'Optional availability windows for combo menu items. Base name, image, description, price, category, and active state continue to live on menu_items.';

comment on column public.menu_combo_settings.combo_item_id is
  'Combo key that matches menu_items.item_id where item_type = combo.';

create index if not exists idx_menu_combo_settings_hotel_dates
  on public.menu_combo_settings (hotel_slug, start_date, end_date);
