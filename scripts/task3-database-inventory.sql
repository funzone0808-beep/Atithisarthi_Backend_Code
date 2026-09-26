-- Task 3 read-only PostgreSQL/Supabase catalog inventory.
--
-- SAFETY:
--   * This script contains one SELECT statement only.
--   * It does not read application row data or storage objects.
--   * It does not create temporary objects, change settings, or mutate schema/data.
--   * Bucket configuration is included, but no customer object names are returned.
--
-- Run in the Supabase SQL Editor for the authorized pre-production project.
-- Export/return the complete single result grid (CSV preferred).

with inventory as (
  select
    '00_database_context'::text as section,
    'database'::text as object_type,
    current_database()::text as object_identity,
    jsonb_build_object(
      'database_name', current_database(),
      'postgres_version', current_setting('server_version'),
      'current_user', current_user,
      'session_user', session_user,
      'project_ref', coalesce(
        nullif(current_setting('app.settings.project_ref', true), ''),
        nullif(current_setting('supabase.project_ref', true), ''),
        'NOT_EXPOSED_BY_DATABASE'
      ),
      'inventory_timestamp_utc', timezone('utc', statement_timestamp())
    ) as details

  union all

  select
    '01_extensions', 'extension', e.extname,
    jsonb_build_object(
      'version', e.extversion,
      'schema', n.nspname,
      'owner', pg_get_userbyid(e.extowner)
    )
  from pg_extension e
  join pg_namespace n on n.oid = e.extnamespace

  union all

  select
    '02_schemas', 'schema', n.nspname,
    jsonb_build_object('owner', pg_get_userbyid(n.nspowner))
  from pg_namespace n
  where n.nspname in ('public', 'storage')

  union all

  select
    '03_relations',
    case c.relkind
      when 'r' then 'table'
      when 'p' then 'partitioned_table'
      when 'v' then 'view'
      when 'm' then 'materialized_view'
      when 'S' then 'sequence'
      when 'f' then 'foreign_table'
      else c.relkind::text
    end,
    format('%I.%I', n.nspname, c.relname),
    jsonb_build_object(
      'schema', n.nspname,
      'name', c.relname,
      'owner', pg_get_userbyid(c.relowner),
      'rls_enabled', c.relrowsecurity,
      'force_rls', c.relforcerowsecurity,
      'persistence', c.relpersistence,
      'is_partition', c.relispartition
    )
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname in ('public', 'storage')
    and c.relkind in ('r', 'p', 'v', 'm', 'S', 'f')

  union all

  select
    '04_columns', 'column',
    format('%I.%I.%I', c.table_schema, c.table_name, c.column_name),
    jsonb_build_object(
      'ordinal_position', c.ordinal_position,
      'data_type', c.data_type,
      'udt_schema', c.udt_schema,
      'udt_name', c.udt_name,
      'nullable', c.is_nullable,
      'default_expression', c.column_default,
      'identity', c.is_identity,
      'identity_generation', c.identity_generation,
      'generated', c.is_generated,
      'generation_expression', c.generation_expression
    )
  from information_schema.columns c
  where c.table_schema in ('public', 'storage')

  union all

  select
    '05_ownership_columns', 'ownership_candidate',
    format('%I.%I.%I', c.table_schema, c.table_name, c.column_name),
    jsonb_build_object(
      'data_type', c.data_type,
      'nullable', c.is_nullable,
      'ordinal_position', c.ordinal_position
    )
  from information_schema.columns c
  where c.table_schema in ('public', 'storage')
    and c.column_name in (
      'tenant_id', 'hotel_id', 'hotel_slug', 'property_id', 'outlet_id',
      'user_id', 'order_id'
    )

  union all

  select
    '06_constraints',
    case con.contype
      when 'p' then 'primary_key'
      when 'f' then 'foreign_key'
      when 'u' then 'unique'
      when 'c' then 'check'
      when 'x' then 'exclusion'
      when 'n' then 'not_null'
      else con.contype::text
    end,
    format('%I.%I.%I', n.nspname, c.relname, con.conname),
    jsonb_build_object(
      'definition', pg_get_constraintdef(con.oid, true),
      'validated', con.convalidated,
      'deferrable', con.condeferrable,
      'initially_deferred', con.condeferred,
      'referenced_relation', case
        when con.confrelid = 0 then null
        else con.confrelid::regclass::text
      end
    )
  from pg_constraint con
  join pg_class c on c.oid = con.conrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname in ('public', 'storage')

  union all

  select
    '07_indexes', 'index',
    format('%I.%I', i.schemaname, i.indexname),
    jsonb_build_object(
      'table', format('%I.%I', i.schemaname, i.tablename),
      'definition', i.indexdef
    )
  from pg_indexes i
  where i.schemaname in ('public', 'storage')

  union all

  select
    '08_rls_policies', 'policy',
    format('%I.%I.%I', p.schemaname, p.tablename, p.policyname),
    jsonb_build_object(
      'permissive', p.permissive,
      'roles', to_jsonb(p.roles),
      'command', p.cmd,
      'using_expression', p.qual,
      'with_check_expression', p.with_check
    )
  from pg_policies p
  where p.schemaname in ('public', 'storage')

  union all

  select
    '09_table_grants', 'table_grant',
    format('%I.%I:%s:%s', n.nspname, c.relname, coalesce(grantee.rolname, 'PUBLIC'), acl.privilege_type),
    jsonb_build_object(
      'grantor', coalesce(grantor.rolname, 'PUBLIC'),
      'grantee', coalesce(grantee.rolname, 'PUBLIC'),
      'privilege', acl.privilege_type,
      'grantable', acl.is_grantable
    )
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) acl
  left join pg_roles grantor on grantor.oid = acl.grantor
  left join pg_roles grantee on grantee.oid = acl.grantee
  where n.nspname in ('public', 'storage')
    and c.relkind in ('r', 'p', 'v', 'm', 'f')

  union all

  select
    '10_schema_grants', 'schema_grant',
    format('%I:%s:%s', n.nspname, coalesce(grantee.rolname, 'PUBLIC'), acl.privilege_type),
    jsonb_build_object(
      'grantor', coalesce(grantor.rolname, 'PUBLIC'),
      'grantee', coalesce(grantee.rolname, 'PUBLIC'),
      'privilege', acl.privilege_type,
      'grantable', acl.is_grantable
    )
  from pg_namespace n
  cross join lateral aclexplode(coalesce(n.nspacl, acldefault('n', n.nspowner))) acl
  left join pg_roles grantor on grantor.oid = acl.grantor
  left join pg_roles grantee on grantee.oid = acl.grantee
  where n.nspname in ('public', 'storage')

  union all

  select
    '11_sequence_grants', 'sequence_grant',
    format('%I.%I:%s:%s', n.nspname, c.relname, coalesce(grantee.rolname, 'PUBLIC'), acl.privilege_type),
    jsonb_build_object(
      'grantor', coalesce(grantor.rolname, 'PUBLIC'),
      'grantee', coalesce(grantee.rolname, 'PUBLIC'),
      'privilege', acl.privilege_type,
      'grantable', acl.is_grantable
    )
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  cross join lateral aclexplode(coalesce(c.relacl, acldefault('S', c.relowner))) acl
  left join pg_roles grantor on grantor.oid = acl.grantor
  left join pg_roles grantee on grantee.oid = acl.grantee
  where n.nspname in ('public', 'storage')
    and c.relkind = 'S'

  union all

  select
    '12_functions',
    case p.prokind when 'p' then 'procedure' else 'function' end,
    format('%I.%I(%s)', n.nspname, p.proname, pg_get_function_identity_arguments(p.oid)),
    jsonb_build_object(
      'owner', pg_get_userbyid(p.proowner),
      'security_mode', case when p.prosecdef then 'DEFINER' else 'INVOKER' end,
      'language', l.lanname,
      'volatility', case p.provolatile when 'i' then 'IMMUTABLE' when 's' then 'STABLE' else 'VOLATILE' end,
      'parallel', case p.proparallel when 's' then 'SAFE' when 'r' then 'RESTRICTED' else 'UNSAFE' end,
      'returns', pg_get_function_result(p.oid),
      'configuration', to_jsonb(p.proconfig)
    )
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  join pg_language l on l.oid = p.prolang
  where n.nspname in ('public', 'storage')
    and p.prokind in ('f', 'p')

  union all

  select
    '13_function_execute_grants', 'function_execute_grant',
    format(
      '%I.%I(%s):%s:%s',
      n.nspname, p.proname, pg_get_function_identity_arguments(p.oid),
      coalesce(grantee.rolname, 'PUBLIC'), acl.privilege_type
    ),
    jsonb_build_object(
      'grantor', coalesce(grantor.rolname, 'PUBLIC'),
      'grantee', coalesce(grantee.rolname, 'PUBLIC'),
      'privilege', acl.privilege_type,
      'grantable', acl.is_grantable
    )
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
  left join pg_roles grantor on grantor.oid = acl.grantor
  left join pg_roles grantee on grantee.oid = acl.grantee
  where n.nspname in ('public', 'storage')
    and p.prokind in ('f', 'p')
    and acl.privilege_type = 'EXECUTE'

  union all

  select
    '14_triggers', 'trigger',
    format('%I.%I.%I', n.nspname, c.relname, t.tgname),
    jsonb_build_object(
      'enabled_state', t.tgenabled,
      'function', t.tgfoid::regprocedure::text,
      'definition', pg_get_triggerdef(t.oid, true)
    )
  from pg_trigger t
  join pg_class c on c.oid = t.tgrelid
  join pg_namespace n on n.oid = c.relnamespace
  where not t.tgisinternal
    and n.nspname in ('public', 'storage')

  union all

  select
    '15_roles', 'database_role', r.rolname,
    jsonb_build_object(
      'login', r.rolcanlogin,
      'superuser', r.rolsuper,
      'bypass_rls', r.rolbypassrls,
      'inherit', r.rolinherit,
      'create_role', r.rolcreaterole,
      'create_database', r.rolcreatedb,
      'replication', r.rolreplication
    )
  from pg_roles r

  union all

  select
    '16_role_memberships', 'role_membership',
    format('%s->%s', member_role.rolname, granted_role.rolname),
    jsonb_build_object(
      'member', member_role.rolname,
      'granted_role', granted_role.rolname,
      'grantor', grantor_role.rolname,
      'admin_option', m.admin_option
    )
  from pg_auth_members m
  join pg_roles granted_role on granted_role.oid = m.roleid
  join pg_roles member_role on member_role.oid = m.member
  join pg_roles grantor_role on grantor_role.oid = m.grantor

  union all

  select
    '17_storage_buckets', 'storage_bucket', b.id::text,
    jsonb_build_object(
      'name', b.name,
      'public', b.public,
      'file_size_limit', b.file_size_limit,
      'allowed_mime_types', to_jsonb(b.allowed_mime_types)
    )
  from storage.buckets b
)
select section, object_type, object_identity, details
from inventory
order by section, object_type, object_identity;
