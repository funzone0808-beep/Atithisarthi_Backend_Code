begin;

create table if not exists public.room_negotiated_rate_approvals (
  id bigserial primary key,
  hotel_slug text not null,
  booking_id bigint not null references public.room_bookings(id) on delete restrict,
  configured_taxable_amount numeric(14,2) not null check (configured_taxable_amount >= 0),
  negotiated_taxable_amount numeric(14,2) not null check (negotiated_taxable_amount >= 0),
  discount_amount numeric(14,2) not null check (discount_amount > 0),
  negotiated_nightly_rate numeric(14,2) not null check (negotiated_nightly_rate > 0),
  final_total_amount numeric(14,2) not null check (final_total_amount >= 0),
  reason text not null check (length(btrim(reason)) >= 5),
  approved_by text not null check (length(btrim(approved_by)) > 0),
  approved_role text not null check (approved_role in ('owner','manager')),
  pricing_snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint room_negotiated_rate_approval_scope_unique unique (hotel_slug, booking_id),
  constraint room_negotiated_rate_discount_check check (
    negotiated_taxable_amount < configured_taxable_amount and
    discount_amount = round(configured_taxable_amount - negotiated_taxable_amount, 2)
  )
);

comment on table public.room_negotiated_rate_approvals is
  'Immutable manager approval evidence for booking-level negotiated Room rates. Created transactionally by the booking insert trigger.';

create index if not exists idx_room_negotiated_rate_approvals_scope_time
  on public.room_negotiated_rate_approvals (hotel_slug, created_at desc, booking_id);

create or replace function public.capture_room_negotiated_rate_approval()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_rate jsonb;
  v_reason text;
  v_approved_by text;
  v_approved_role text;
  v_configured_taxable numeric(14,2);
  v_negotiated_taxable numeric(14,2);
  v_discount numeric(14,2);
  v_nightly numeric(14,2);
begin
  v_rate := coalesce(new.pricing_snapshot -> 'negotiatedRate', '{}'::jsonb);
  if coalesce((v_rate ->> 'applied')::boolean, false) is false then
    return new;
  end if;

  v_reason := btrim(coalesce(v_rate ->> 'reason', ''));
  v_approved_by := btrim(coalesce(v_rate ->> 'approvedBy', ''));
  v_approved_role := lower(btrim(coalesce(v_rate ->> 'approverRole', '')));
  v_configured_taxable := round(coalesce((v_rate ->> 'configuredTaxableValue')::numeric, -1), 2);
  v_negotiated_taxable := round(coalesce((v_rate ->> 'negotiatedTaxableValue')::numeric, -1), 2);
  v_discount := round(coalesce((v_rate ->> 'discountAmount')::numeric, -1), 2);
  v_nightly := round(coalesce((v_rate ->> 'nightlyRate')::numeric, -1), 2);

  if coalesce(new.pricing_version, 0) < 4 then
    raise exception using errcode = '23514', message = 'ROOM_NEGOTIATED_RATE_PRICING_VERSION_REQUIRED';
  end if;
  if length(v_reason) < 5 then
    raise exception using errcode = '23514', message = 'ROOM_NEGOTIATED_RATE_REASON_REQUIRED';
  end if;
  if v_approved_by = '' or v_approved_role not in ('owner','manager') then
    raise exception using errcode = '42501', message = 'ROOM_NEGOTIATED_RATE_MANAGER_APPROVAL_REQUIRED';
  end if;
  if v_nightly <= 0 or v_configured_taxable <= v_negotiated_taxable or v_discount <= 0 then
    raise exception using errcode = '23514', message = 'ROOM_NEGOTIATED_RATE_INVALID_FINANCIALS';
  end if;
  if abs(v_discount - round(v_configured_taxable - v_negotiated_taxable, 2)) > 0.01 or
     abs(v_discount - new.discount_amount) > 0.01 or
     abs(v_configured_taxable - new.room_price) > 0.01 or
     abs(new.total_amount - coalesce((new.tax_snapshot ->> 'totalAmount')::numeric, new.total_amount)) > 0.01 then
    raise exception using errcode = '23514', message = 'ROOM_NEGOTIATED_RATE_SNAPSHOT_MISMATCH';
  end if;

  insert into public.room_negotiated_rate_approvals (
    hotel_slug, booking_id, configured_taxable_amount, negotiated_taxable_amount,
    discount_amount, negotiated_nightly_rate, final_total_amount, reason,
    approved_by, approved_role, pricing_snapshot
  ) values (
    new.hotel_slug, new.id, v_configured_taxable, v_negotiated_taxable,
    v_discount, v_nightly, new.total_amount, v_reason,
    v_approved_by, v_approved_role, new.pricing_snapshot
  );

  insert into public.room_operation_audit (
    hotel_slug, actor_id, actor_role, action, target_type, target_id,
    old_value, new_value, reason
  ) values (
    new.hotel_slug, v_approved_by, v_approved_role,
    'room_negotiated_rate_approved', 'room_booking', new.id::text,
    jsonb_build_object(
      'configuredTaxableAmount', v_configured_taxable,
      'configuredNightlyPrices', v_rate -> 'configuredNightlyPrices'
    ),
    jsonb_build_object(
      'negotiatedTaxableAmount', v_negotiated_taxable,
      'negotiatedNightlyRate', v_nightly,
      'discountAmount', v_discount,
      'finalTotalAmount', new.total_amount,
      'pricingVersion', new.pricing_version
    ),
    v_reason
  );

  return new;
end;
$$;

drop trigger if exists trg_capture_room_negotiated_rate_approval on public.room_bookings;
create trigger trg_capture_room_negotiated_rate_approval
after insert on public.room_bookings
for each row execute function public.capture_room_negotiated_rate_approval();

create or replace function public.room_negotiated_rate_ready()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    to_regclass('public.room_negotiated_rate_approvals') is not null and
    exists (
      select 1
      from pg_trigger
      where tgname = 'trg_capture_room_negotiated_rate_approval'
        and tgrelid = 'public.room_bookings'::regclass
        and not tgisinternal
        and tgenabled <> 'D'
    );
$$;

alter table public.room_negotiated_rate_approvals enable row level security;
revoke all on public.room_negotiated_rate_approvals from public, anon, authenticated;
grant select on public.room_negotiated_rate_approvals to service_role;
revoke all on sequence public.room_negotiated_rate_approvals_id_seq from public, anon, authenticated;

revoke all on function public.capture_room_negotiated_rate_approval() from public, anon, authenticated;
revoke all on function public.room_negotiated_rate_ready() from public, anon, authenticated;
grant execute on function public.room_negotiated_rate_ready() to service_role;

notify pgrst, 'reload schema';

commit;
