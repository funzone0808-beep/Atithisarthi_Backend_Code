-- Hotel-scoped staff/owner access table for the limited billing screen.
-- Safe first version:
-- - separate from full admin users
-- - maps each staff/owner login to exactly one hotel slug
-- - stores hashed PINs only, never plaintext PINs
-- - supports multiple staff/owner credentials per hotel if needed later

create table if not exists public.hotel_staff_access (
  id bigserial primary key,
  hotel_slug text not null,
  display_name text not null default 'Staff',
  role text not null default 'staff' check (role in ('staff', 'owner')),
  pin_hash text not null,
  is_active boolean not null default true,
  last_login_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.hotel_staff_access is
  'Limited hotel-scoped staff/owner access for the staff billing screen. This is separate from full admin users.';

comment on column public.hotel_staff_access.hotel_slug is
  'The only hotel slug this staff/owner credential can access.';

comment on column public.hotel_staff_access.pin_hash is
  'bcrypt hash of the hotel staff PIN. Never store a plaintext PIN here.';

create index if not exists hotel_staff_access_hotel_slug_active_idx
  on public.hotel_staff_access (hotel_slug, is_active);

create index if not exists hotel_staff_access_role_idx
  on public.hotel_staff_access (role);

-- Generate a PIN hash with:
-- node scripts/hash-password.js 123456
--
-- Example seed row after generating a real hash:
-- insert into public.hotel_staff_access (hotel_slug, display_name, role, pin_hash)
-- values ('hotel-example', 'Example Owner', 'owner', '$2b$10$replace_with_generated_hash');
