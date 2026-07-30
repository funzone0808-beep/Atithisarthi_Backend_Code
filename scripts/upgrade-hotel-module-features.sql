-- Upgrade the existing hotel_feature_settings table into the shared module entitlement source.
-- Existing restaurant tenants keep Food enabled. Existing room-booking tenants keep Rooms enabled.
-- No historical orders, bookings, payments, invoices, or profiles are deleted.

begin;

alter table public.hotel_feature_settings
  add column if not exists enable_food_module boolean,
  add column if not exists enable_room_module boolean,
  add column if not exists enable_food_reports boolean,
  add column if not exists enable_room_reports boolean,
  add column if not exists enable_combined_reports boolean,
  add column if not exists enable_combined_billing boolean,
  add column if not exists version integer,
  add column if not exists updated_by text;

update public.hotel_feature_settings
set
  enable_food_module = coalesce(enable_food_module, true),
  enable_room_module = coalesce(enable_room_module, enable_room_booking, false),
  enable_food_reports = coalesce(enable_food_reports, true),
  enable_room_reports = coalesce(enable_room_reports, enable_room_booking, false),
  enable_combined_reports = coalesce(
    enable_combined_reports,
    coalesce(enable_food_module, true) and coalesce(enable_room_booking, false)
  ),
  enable_combined_billing = coalesce(enable_combined_billing, enable_room_service, false),
  version = greatest(coalesce(version, 1), 1);

-- Normalize every dependent feature before constraints are installed.
update public.hotel_feature_settings
set
  enable_food_ordering = enable_food_module and enable_food_ordering,
  enable_room_booking = enable_room_module and enable_room_booking,
  enable_food_reports = enable_food_module and enable_food_reports,
  enable_room_reports = enable_room_module and enable_room_reports,
  enable_room_service = enable_food_module and enable_room_module and enable_room_service,
  enable_combined_reports = enable_food_module and enable_room_module and enable_combined_reports,
  enable_combined_billing =
    enable_food_module and enable_room_module and enable_room_service and enable_combined_billing;

alter table public.hotel_feature_settings
  alter column enable_food_module set default true,
  alter column enable_food_module set not null,
  alter column enable_room_module set default false,
  alter column enable_room_module set not null,
  alter column enable_food_reports set default true,
  alter column enable_food_reports set not null,
  alter column enable_room_reports set default false,
  alter column enable_room_reports set not null,
  alter column enable_combined_reports set default false,
  alter column enable_combined_reports set not null,
  alter column enable_combined_billing set default false,
  alter column enable_combined_billing set not null,
  alter column version set default 1,
  alter column version set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'hotel_feature_settings_core_module_check'
      and conrelid = 'public.hotel_feature_settings'::regclass
  ) then
    alter table public.hotel_feature_settings
      add constraint hotel_feature_settings_core_module_check check (
        enable_food_module or enable_room_module
      );
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'hotel_feature_settings_version_check'
      and conrelid = 'public.hotel_feature_settings'::regclass
  ) then
    alter table public.hotel_feature_settings
      add constraint hotel_feature_settings_version_check check (version > 0);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'hotel_feature_settings_food_dependencies'
      and conrelid = 'public.hotel_feature_settings'::regclass
  ) then
    alter table public.hotel_feature_settings
      add constraint hotel_feature_settings_food_dependencies check (
        enable_food_module or (
          not enable_food_ordering and
          not enable_food_reports and
          not enable_room_service and
          not enable_combined_reports and
          not enable_combined_billing
        )
      );
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'hotel_feature_settings_room_dependencies'
      and conrelid = 'public.hotel_feature_settings'::regclass
  ) then
    alter table public.hotel_feature_settings
      add constraint hotel_feature_settings_room_dependencies check (
        enable_room_module or (
          not enable_room_booking and
          not enable_room_reports and
          not enable_room_service and
          not enable_combined_reports and
          not enable_combined_billing
        )
      );
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'hotel_feature_settings_combined_dependencies'
      and conrelid = 'public.hotel_feature_settings'::regclass
  ) then
    alter table public.hotel_feature_settings
      add constraint hotel_feature_settings_combined_dependencies check (
        (not enable_room_service or (enable_food_module and enable_room_module)) and
        (not enable_combined_reports or (enable_food_module and enable_room_module)) and
        (not enable_combined_billing or (enable_food_module and enable_room_module and enable_room_service))
      );
  end if;
end $$;

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

commit;
