begin;

drop index if exists public.idx_menu_items_hotel_category_available_order;
drop table if exists public.menu_category_audit;
drop table if exists public.menu_categories;

commit;

-- menu_items, existing category strings, item relationships, orders, KOTs, and bills are intentionally untouched.
