-- Roll back upgrade-production-room-pricing-gst.sql.
-- Take a database backup first. This removes Room GST/refund/adjustment data.
-- Deploy the matching pre-upgrade application source in the same release window.

begin;

drop trigger if exists trg_lock_room_booking_financial_scope on public.room_bookings;
drop trigger if exists trg_protect_room_booking_snapshots on public.room_bookings;
drop trigger if exists trg_protect_room_master_financial_change on public.rooms;
drop trigger if exists trg_protect_room_type_financial_change on public.room_types;
drop trigger if exists trg_protect_room_rate_plan_change on public.room_rate_plans;

drop function if exists public.lock_room_booking_financial_scope();
drop function if exists public.protect_room_booking_snapshots();
drop function if exists public.protect_room_master_financial_change();
drop function if exists public.protect_room_type_financial_change();
drop function if exists public.protect_room_rate_plan_change();
drop function if exists public.activate_room_tax_rule(text,bigint,integer,text);
drop function if exists public.record_room_booking_payment(text,bigint,numeric,text,text,text,text,text,text);
drop function if exists public.record_room_booking_refund(text,bigint,numeric,text,text,text,text,text);

drop index if exists public.uq_room_booking_payments_scope_idempotency;
drop index if exists public.idx_room_rate_plans_effective_target;
drop index if exists public.idx_room_tax_rules_scope_effective;
drop index if exists public.idx_room_booking_refunds_scope_booking;
drop index if exists public.idx_room_stay_rate_adjustments_scope_booking;

drop table if exists public.room_stay_rate_adjustments;
drop table if exists public.room_booking_refunds;

alter table public.room_booking_payments drop column if exists idempotency_key;

alter table public.room_bookings drop column if exists guest_place_of_supply;
alter table public.room_bookings drop column if exists guest_gstin;
alter table public.room_bookings drop column if exists guest_company_name;
alter table public.room_bookings drop column if exists pricing_version;
alter table public.room_bookings drop column if exists tax_snapshot;
alter table public.room_bookings drop column if exists tax_rule_id;

alter table public.room_rate_plans drop column if exists retired_at;
alter table public.room_rate_plans drop column if exists approved_at;
alter table public.room_rate_plans drop column if exists approved_by;
alter table public.room_rate_plans drop column if exists version;
alter table public.room_rate_plans drop column if exists status;
alter table public.room_rate_plans drop column if exists room_id;

drop table if exists public.room_tax_rules;
drop table if exists public.hotel_room_tax_settings;

-- Restore the professional pre-upgrade extension behavior.
create or replace function public.extend_room_booking(
  p_hotel_slug text,
  p_booking_id bigint,
  p_new_check_out date,
  p_actor_id text,
  p_actor_role text,
  p_reason text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_booking room_bookings%rowtype;
  v_room rooms%rowtype;
  v_nights integer;
  v_nightly numeric(12,2);
  v_room_price numeric(12,2);
  v_tax numeric(12,2);
  v_total numeric(12,2);
begin
  select * into v_booking from room_bookings where id=p_booking_id and hotel_slug=p_hotel_slug for update;
  if not found or v_booking.booking_status not in ('confirmed','checked_in') then
    raise exception using errcode='P0001', message='ACTIVE_BOOKING_REQUIRED';
  end if;
  if p_new_check_out <= v_booking.check_out_date then
    raise exception using errcode='P0001', message='NEW_CHECKOUT_MUST_BE_LATER';
  end if;
  perform 1 from rooms where id=v_booking.room_id and hotel_slug=p_hotel_slug for update;
  if exists (
    select 1 from room_bookings b
    where b.hotel_slug=p_hotel_slug and b.room_id=v_booking.room_id and b.id<>v_booking.id
      and b.booking_status in ('pending','confirmed','checked_in')
      and b.check_in_date < p_new_check_out and b.check_out_date > v_booking.check_out_date
  ) then
    raise exception using errcode='23P01', message='ROOM_ALREADY_BOOKED';
  end if;
  select * into v_room from rooms where id=v_booking.room_id and hotel_slug=p_hotel_slug;
  v_nights := p_new_check_out - v_booking.check_in_date;
  v_nightly := coalesce(nullif(v_booking.room_price,0) / nullif(v_booking.total_nights,0), v_room.discount_price, v_room.base_price, 0);
  v_room_price := round(v_nightly * v_nights, 2);
  v_tax := round(v_room_price * coalesce(v_room.tax_percent,0) / 100, 2);
  v_total := greatest(0, v_room_price + v_tax - coalesce(v_booking.discount_amount,0));
  update room_bookings set
    check_out_date=p_new_check_out,total_nights=v_nights,room_price=v_room_price,
    tax_amount=v_tax,total_amount=v_total,
    balance_amount=greatest(0,v_total-coalesce(advance_paid,0)),updated_at=now()
  where id=v_booking.id and hotel_slug=p_hotel_slug;
  update guest_stays set expected_check_out_at=p_new_check_out::timestamptz,updated_at=now()
  where booking_id=v_booking.id and hotel_slug=p_hotel_slug and stay_status='checked_in';
  insert into room_operation_audit(
    hotel_slug,actor_id,actor_role,action,target_type,target_id,old_value,new_value,reason
  ) values (
    p_hotel_slug,p_actor_id,p_actor_role,'stay_extended','room_booking',v_booking.id::text,
    jsonb_build_object('checkOutDate',v_booking.check_out_date,'totalAmount',v_booking.total_amount),
    jsonb_build_object('checkOutDate',p_new_check_out,'totalAmount',v_total),p_reason
  );
  return jsonb_build_object(
    'bookingId',v_booking.id,'checkOutDate',p_new_check_out,'totalNights',v_nights,
    'totalAmount',v_total,'balanceAmount',greatest(0,v_total-coalesce(v_booking.advance_paid,0))
  );
end;
$$;

revoke all on function public.extend_room_booking(text,bigint,date,text,text,text) from public,anon,authenticated;
grant execute on function public.extend_room_booking(text,bigint,date,text,text,text) to service_role;

notify pgrst,'reload schema';
commit;
