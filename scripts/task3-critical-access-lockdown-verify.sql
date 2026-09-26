-- Task 3 SEC0 read-only verification.
-- Expected: every row reports PASS.

with public_tables as (
  select c.oid, n.nspname, c.relname, c.relrowsecurity, c.relforcerowsecurity
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind in ('r', 'p')
),
public_functions as (
  select p.oid, p.proname, p.prosecdef
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
),
public_sequences as (
  select c.oid
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind = 'S'
),
direct_table_access as (
  select count(*)::bigint as issue_count
  from public_tables t
  cross join (values ('anon'), ('authenticated')) as r(role_name)
  cross join (values
    ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'),
    ('TRUNCATE'), ('REFERENCES'), ('TRIGGER'), ('MAINTAIN')
  ) as p(privilege_name)
  where has_table_privilege(r.role_name, t.oid, p.privilege_name)
),
direct_sequence_access as (
  select count(*)::bigint as issue_count
  from public_sequences s
  cross join (values ('anon'), ('authenticated')) as r(role_name)
  cross join (values ('USAGE'), ('SELECT'), ('UPDATE')) as p(privilege_name)
  where has_sequence_privilege(r.role_name, s.oid, p.privilege_name)
),
direct_function_access as (
  select count(*)::bigint as issue_count
  from public_functions f
  cross join (values ('anon'), ('authenticated')) as r(role_name)
  where has_function_privilege(r.role_name, f.oid, 'EXECUTE')
),
unsafe_default_access as (
  select count(*)::bigint as issue_count
  from pg_default_acl d
  join pg_namespace n on n.oid = d.defaclnamespace
  cross join lateral aclexplode(d.defaclacl) acl
  left join pg_roles grantee on grantee.oid = acl.grantee
  where n.nspname = 'public'
    and d.defaclrole = 'postgres'::regrole
    and d.defaclobjtype in ('r', 'S', 'f')
    and coalesce(grantee.rolname, 'PUBLIC') in ('PUBLIC', 'anon', 'authenticated')
),
checks as (
  select
    'all_public_tables_rls_enabled'::text as check_name,
    '0'::text as expected,
    count(*) filter (where not relrowsecurity)::text as actual
  from public_tables

  union all

  select
    'force_rls_not_prematurely_enabled',
    '0',
    count(*) filter (where relforcerowsecurity)::text
  from public_tables

  union all

  select
    'anon_authenticated_effective_table_privileges',
    '0',
    issue_count::text
  from direct_table_access

  union all

  select
    'anon_authenticated_effective_sequence_privileges',
    '0',
    issue_count::text
  from direct_sequence_access

  union all

  select
    'anon_authenticated_application_function_execute',
    '0',
    issue_count::text
  from direct_function_access

  union all

  select
    'unsafe_postgres_default_privileges',
    '0',
    issue_count::text
  from unsafe_default_access

  union all

  select
    'rls_policies_not_yet_installed',
    '0',
    count(*)::text
  from pg_policies
  where schemaname in ('public', 'storage')

  union all

  select
    'service_role_orders_read_write_preserved',
    'true',
    (
      has_table_privilege('service_role', 'public.orders', 'SELECT') and
      has_table_privilege('service_role', 'public.orders', 'INSERT') and
      has_table_privilege('service_role', 'public.orders', 'UPDATE')
    )::text

  union all

  select
    'service_role_payment_rpc_preserved',
    'true',
    (
      has_function_privilege(
        'service_role',
        'public.finalize_captured_payment(uuid,text,text,text,text,bigint,text,text,text,text)',
        'EXECUTE'
      ) and
      has_function_privilege(
        'service_role',
        'public.claim_payment_webhook(text,integer,integer)',
        'EXECUTE'
      )
    )::text
)
select
  check_name,
  expected,
  actual,
  case when actual = expected then 'PASS' else 'FAIL' end as result
from checks
order by check_name;
