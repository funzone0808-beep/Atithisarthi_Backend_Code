-- Staff/Manager corrections for secure QR submissions.
-- Apply after create-secure-qr-table-ordering.sql and upgrade-secure-qr-corrections.sql.

create table if not exists public.qr_staff_idempotency_records (
  id bigserial primary key,
  hotel_slug text not null,
  actor_reference text not null,
  action_scope text not null,
  idempotency_key_hash text not null,
  request_fingerprint text not null,
  response_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  constraint qr_staff_idempotency_records_unique
    unique (hotel_slug, actor_reference, action_scope, idempotency_key_hash)
);
create index if not exists idx_qr_staff_idempotency_cleanup
  on public.qr_staff_idempotency_records (expires_at);
alter table public.qr_staff_idempotency_records enable row level security;
revoke all on public.qr_staff_idempotency_records from public, anon, authenticated;
grant select, insert, update on public.qr_staff_idempotency_records to service_role;
grant usage, select on sequence public.qr_staff_idempotency_records_id_seq to service_role;

create or replace function public.correct_secure_qr_submission_staff(
  p_hotel_slug text,
  p_submission_reference uuid,
  p_expected_version bigint,
  p_action text,
  p_idempotency_key_hash text,
  p_request_fingerprint text,
  p_items jsonb,
  p_totals jsonb,
  p_note text,
  p_reason text,
  p_actor_reference text,
  p_actor_role text,
  p_request_id text
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_hotel text := lower(btrim(coalesce(p_hotel_slug, '')));
  v_action text := lower(btrim(coalesce(p_action, '')));
  v_role text := lower(btrim(coalesce(p_actor_role, 'staff')));
  v_submission public.qr_order_submissions%rowtype;
  v_order public.orders%rowtype;
  v_round public.order_rounds%rowtype;
  v_idempotency public.qr_staff_idempotency_records%rowtype;
  v_remaining_items jsonb := '[]'::jsonb;
  v_next_items jsonb := coalesce(p_items, '[]'::jsonb);
  v_next_totals jsonb := coalesce(p_totals, '{}'::jsonb);
  v_kitchen_status text;
  v_response jsonb;
  v_event_type text;
  v_next_submission_status text;
begin
  if v_hotel = '' or p_submission_reference is null or
     btrim(coalesce(p_actor_reference, '')) = '' or
     v_action not in ('edit', 'approve', 'reject', 'cancel') or
     btrim(coalesce(p_idempotency_key_hash, '')) = '' or
     btrim(coalesce(p_request_fingerprint, '')) = '' then
    return jsonb_build_object('ok', false, 'code', 'INVALID_STAFF_CORRECTION');
  end if;
  if v_action = 'cancel' and v_role <> 'manager' then
    return jsonb_build_object('ok', false, 'code', 'MANAGER_REQUIRED');
  end if;
  if v_action in ('reject', 'cancel') and length(btrim(coalesce(p_reason, ''))) < 3 then
    return jsonb_build_object('ok', false, 'code', 'REASON_REQUIRED');
  end if;
  if v_action = 'edit' and (jsonb_typeof(v_next_items) <> 'array' or jsonb_array_length(v_next_items) = 0) then
    return jsonb_build_object('ok', false, 'code', 'EMPTY_ITEMS');
  end if;

  select * into v_idempotency from public.qr_staff_idempotency_records
   where hotel_slug = v_hotel and actor_reference = p_actor_reference
     and action_scope = v_action || ':' || p_submission_reference::text
     and idempotency_key_hash = p_idempotency_key_hash;
  if found then
    if v_idempotency.request_fingerprint <> p_request_fingerprint then
      return jsonb_build_object('ok', false, 'code', 'IDEMPOTENCY_KEY_REUSED');
    end if;
    return v_idempotency.response_json || jsonb_build_object('duplicate', true);
  end if;

  select * into v_submission from public.qr_order_submissions
   where public_reference = p_submission_reference and lower(btrim(hotel_slug)) = v_hotel for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'QR_SUBMISSION_NOT_FOUND'); end if;
  if v_submission.row_version <> p_expected_version then
    return jsonb_build_object('ok', false, 'code', 'QR_SUBMISSION_CHANGED', 'currentVersion', v_submission.row_version);
  end if;

  select * into v_order from public.orders
   where id::text = v_submission.order_id and lower(btrim(hotel_slug)) = v_hotel for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'ORDER_NOT_FOUND'); end if;
  if lower(coalesce(v_order.payment_status, 'unpaid')) not in ('', 'unpaid', 'customer_confirmed') or
     lower(coalesce(v_order.billing_status, 'not_billed')) not in ('', 'not_billed') or
     coalesce(btrim(v_order.bill_number), '') <> '' then
    return jsonb_build_object('ok', false, 'code', 'BILLING_LOCKED');
  end if;

  if v_submission.round_sequence = 1 then
    v_kitchen_status := lower(coalesce(v_order.kitchen_status, v_order.status, 'new'));
  else
    select * into v_round from public.order_rounds
     where lower(btrim(hotel_slug)) = v_hotel and order_id = v_submission.order_id
       and sequence_number = v_submission.round_sequence for update;
    if not found then return jsonb_build_object('ok', false, 'code', 'ROUND_NOT_FOUND'); end if;
    v_kitchen_status := lower(coalesce(v_round.status, 'new'));
  end if;

  if v_action in ('edit', 'approve', 'reject') and v_kitchen_status not in ('pending', 'received', 'new') then
    return jsonb_build_object('ok', false, 'code', 'QR_EDIT_LOCKED', 'kitchenStatus', v_kitchen_status);
  end if;
  if v_action = 'cancel' and v_kitchen_status in ('ready', 'served', 'cancelled') then
    return jsonb_build_object('ok', false, 'code', 'QR_CANCELLATION_LOCKED', 'kitchenStatus', v_kitchen_status);
  end if;

  if v_action = 'edit' then
    select coalesce(jsonb_agg(item), '[]'::jsonb) into v_remaining_items
      from jsonb_array_elements(coalesce(v_order.items, '[]'::jsonb)) item
     where coalesce(item->>'qrSubmissionReference', '') <> v_submission.public_reference::text;
    update public.orders set
      items = v_remaining_items || v_next_items,
      totals = public.replace_qr_order_totals(totals, v_submission.totals_delta, v_next_totals),
      order_version = coalesce(order_version, 1) + 1
     where id = v_order.id returning * into v_order;
    if v_submission.round_sequence > 1 then
      update public.order_rounds set items = v_next_items, totals_delta = v_next_totals,
        note = nullif(btrim(coalesce(p_note, '')), ''), row_version = row_version + 1, updated_at = now()
       where id = v_round.id returning * into v_round;
    end if;
    update public.qr_order_submissions set items = v_next_items, totals_delta = v_next_totals,
      note = nullif(btrim(coalesce(p_note, '')), ''), row_version = row_version + 1, updated_at = now()
     where id = v_submission.id returning * into v_submission;
    v_event_type := case when v_role = 'manager' then 'QR_ITEM_EDITED_BY_MANAGER' else 'QR_ITEM_EDITED_BY_STAFF' end;
  elsif v_action = 'approve' then
    if v_submission.round_sequence = 1 then
      update public.orders set kitchen_status = 'new', order_version = coalesce(order_version, 1) + 1
       where id = v_order.id returning * into v_order;
    else
      update public.order_rounds set status = 'new', row_version = row_version + 1,
        sent_to_kitchen_at = coalesce(sent_to_kitchen_at, now()), updated_at = now()
       where id = v_round.id returning * into v_round;
    end if;
    update public.qr_order_submissions set status = 'new', row_version = row_version + 1, updated_at = now()
     where id = v_submission.id returning * into v_submission;
    v_event_type := 'QR_ROUND_APPROVED';
  else
    select coalesce(jsonb_agg(item), '[]'::jsonb) into v_remaining_items
      from jsonb_array_elements(coalesce(v_order.items, '[]'::jsonb)) item
     where coalesce(item->>'qrSubmissionReference', '') <> v_submission.public_reference::text;
    update public.orders set
      items = v_remaining_items,
      totals = public.replace_qr_order_totals(totals, v_submission.totals_delta, '{}'::jsonb),
      order_version = coalesce(order_version, 1) + 1,
      kitchen_status = case when v_submission.round_sequence = 1 then 'cancelled' else kitchen_status end
     where id = v_order.id returning * into v_order;
    if v_submission.round_sequence > 1 then
      update public.order_rounds set status = 'cancelled', row_version = row_version + 1,
        cancelled_at = now(), cancellation_reason = btrim(p_reason), updated_at = now()
       where id = v_round.id returning * into v_round;
    end if;
    v_next_submission_status := case when v_action = 'reject' then 'rejected' else 'cancelled' end;
    update public.qr_order_submissions set status = v_next_submission_status,
      row_version = row_version + 1, locked_at = now(), updated_at = now()
     where id = v_submission.id returning * into v_submission;
    v_event_type := case when v_action = 'reject' then 'QR_ROUND_REJECTED' else 'QR_ROUND_CANCELLED' end;
  end if;

  v_response := jsonb_build_object('ok', true, 'duplicate', false, 'action', v_action,
    'order', to_jsonb(v_order), 'submission', to_jsonb(v_submission),
    'round', case when v_submission.round_sequence > 1 then to_jsonb(v_round) else null end);
  insert into public.qr_staff_idempotency_records (
    hotel_slug, actor_reference, action_scope, idempotency_key_hash,
    request_fingerprint, response_json, expires_at
  ) values (v_hotel, p_actor_reference, v_action || ':' || p_submission_reference::text,
    p_idempotency_key_hash, p_request_fingerprint, v_response, now() + interval '24 hours');
  insert into public.qr_event_outbox (
    hotel_slug, aggregate_type, aggregate_id, event_type, deduplication_key, payload
  ) values (v_hotel, 'order', v_order.id::text, v_event_type,
    'qr-staff:' || p_actor_reference || ':' || p_idempotency_key_hash,
    jsonb_build_object('orderId', v_order.id, 'submissionReference', v_submission.public_reference,
      'roundSequence', v_submission.round_sequence, 'action', v_action, 'source', 'qr'));
  insert into public.qr_security_events (
    hotel_slug, restaurant_table_id, order_id, submission_reference,
    actor_type, actor_reference, event_type, request_id, safe_context
  ) values (v_hotel, v_submission.restaurant_table_id, v_order.id::text,
    v_submission.public_reference::text, case when v_role = 'manager' then 'manager' else 'staff' end,
    p_actor_reference, v_event_type, nullif(p_request_id, ''),
    jsonb_build_object('roundSequence', v_submission.round_sequence, 'action', v_action,
      'reason', nullif(btrim(coalesce(p_reason, '')), ''), 'newVersion', v_submission.row_version));
  return v_response;
end;
$$;

revoke all on function public.correct_secure_qr_submission_staff(
  text,uuid,bigint,text,text,text,jsonb,jsonb,text,text,text,text,text
) from public, anon, authenticated;
grant execute on function public.correct_secure_qr_submission_staff(
  text,uuid,bigint,text,text,text,jsonb,jsonb,text,text,text,text,text
) to service_role;

-- Ask Supabase PostgREST to expose the new RPC without waiting for cache expiry.
notify pgrst, 'reload schema';
