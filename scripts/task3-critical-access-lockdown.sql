-- Task 3 SEC0: emergency direct Supabase API lockdown.
-- Authorized pre-production database only. Run manually in Supabase SQL Editor.
--
-- Purpose:
--   1. Close direct anon/authenticated access discovered by catalog inventory.
--   2. Keep the current backend operational through service_role.
--   3. Do NOT claim tenant isolation or create final tenant RLS policies.
--
-- Data safety: no application rows are inserted, updated, or deleted.

begin;

-- These deployed application tables had RLS disabled while anon/authenticated
-- held broad privileges. Enabling RLS with no policies makes direct PostgREST
-- access deny by default. The current backend service_role path is unaffected.
alter table public.contact_submissions enable row level security;
alter table public.gallery_items enable row level security;
alter table public.hotel_notification_settings enable row level security;
alter table public.hotel_payment_route_settings enable row level security;
alter table public.hotel_profiles enable row level security;
alter table public.hotel_staff_access enable row level security;
alter table public.hotels enable row level security;
alter table public.inquiries enable row level security;
alter table public.menu_items enable row level security;
alter table public.order_support_requests enable row level security;
alter table public.orders enable row level security;
alter table public.payment_webhook_events enable row level security;
alter table public.reservations enable row level security;
alter table public.testimonials enable row level security;

-- The browser frontend uses the backend API and contains no direct Supabase
-- client. Remove current direct table/sequence access. Later Task 3 stages will
-- grant only the restricted runtime role the exact privileges it needs.
revoke all privileges on all tables in schema public
  from public, anon, authenticated;

revoke all privileges on all sequences in schema public
  from public, anon, authenticated;

-- Prevent application RPCs, including SECURITY DEFINER payment/worker RPCs,
-- from being invoked directly with anon/authenticated credentials. Extension
-- member functions are intentionally excluded so this checkpoint cannot break
-- PostgreSQL extension internals.
do $$
declare
  target_function record;
begin
  for target_function in
    select p.oid::regprocedure::text as identity
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prokind in ('f', 'p')
      and not exists (
        select 1
        from pg_depend d
        where d.classid = 'pg_proc'::regclass
          and d.objid = p.oid
          and d.deptype = 'e'
      )
  loop
    execute format(
      'revoke execute on function %s from public, anon, authenticated',
      target_function.identity
    );
    execute format(
      'grant execute on function %s to service_role',
      target_function.identity
    );
  end loop;
end;
$$;

-- Stop future postgres-owned objects from silently recreating broad access.
alter default privileges for role postgres in schema public
  revoke all privileges on tables from public, anon, authenticated;

alter default privileges for role postgres in schema public
  revoke all privileges on sequences from public, anon, authenticated;

alter default privileges for role postgres in schema public
  revoke execute on functions from public, anon, authenticated;

commit;

notify pgrst, 'reload schema';
