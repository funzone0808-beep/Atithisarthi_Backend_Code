-- Roll back only the additive module/reporting upgrade.
-- The original food-ordering, room-booking, and room-service flags remain intact.

begin;

alter table public.hotel_feature_settings
  drop constraint if exists hotel_feature_settings_core_module_check,
  drop constraint if exists hotel_feature_settings_combined_dependencies,
  drop constraint if exists hotel_feature_settings_room_dependencies,
  drop constraint if exists hotel_feature_settings_food_dependencies,
  drop constraint if exists hotel_feature_settings_version_check;

drop table if exists public.hotel_feature_setting_audit;

alter table public.hotel_feature_settings
  drop column if exists updated_by,
  drop column if exists version,
  drop column if exists enable_combined_billing,
  drop column if exists enable_combined_reports,
  drop column if exists enable_room_reports,
  drop column if exists enable_food_reports,
  drop column if exists enable_room_module,
  drop column if exists enable_food_module;

commit;
