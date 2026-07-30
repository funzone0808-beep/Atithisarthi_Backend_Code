-- Repairs the public.menu_items id sequence after manual inserts with explicit ids.
-- Safe to run multiple times.

select setval(
  pg_get_serial_sequence('public.menu_items', 'id'),
  coalesce((select max(id) from public.menu_items), 0) + 1,
  false
);
