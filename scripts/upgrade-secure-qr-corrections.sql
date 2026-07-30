-- Customer-owned corrections for secure QR submissions.
-- Apply after create-secure-qr-table-ordering.sql.

create or replace function public.replace_qr_order_totals(p_existing jsonb, p_old jsonb, p_new jsonb)
returns jsonb language sql immutable set search_path = public, pg_temp as $$
  select coalesce(p_existing, '{}'::jsonb) || jsonb_build_object(
    'subtotal', greatest(0, coalesce((p_existing->>'subtotal')::numeric, 0) - coalesce((p_old->>'subtotal')::numeric, 0) + coalesce((p_new->>'subtotal')::numeric, 0)),
    'gst', greatest(0, coalesce((p_existing->>'gst')::numeric, 0) - coalesce((p_old->>'gst')::numeric, 0) + coalesce((p_new->>'gst')::numeric, 0)),
    'normalTotal', greatest(0, coalesce((p_existing->>'normalTotal')::numeric, coalesce((p_existing->>'total')::numeric, 0)) - coalesce((p_old->>'normalTotal')::numeric, coalesce((p_old->>'total')::numeric, 0)) + coalesce((p_new->>'normalTotal')::numeric, coalesce((p_new->>'total')::numeric, 0))),
    'total', greatest(0, coalesce((p_existing->>'total')::numeric, 0) - coalesce((p_old->>'total')::numeric, 0) + coalesce((p_new->>'total')::numeric, 0))
  );
$$;

create or replace function public.edit_secure_qr_submission(
  p_session_hash text,
  p_submission_reference uuid,
  p_expected_version bigint,
  p_idempotency_key_hash text,
  p_request_fingerprint text,
  p_items jsonb,
  p_totals jsonb,
  p_note text,
  p_request_id text
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_session public.qr_customer_sessions%rowtype;
  v_submission public.qr_order_submissions%rowtype;
  v_order public.orders%rowtype;
  v_round public.order_rounds%rowtype;
  v_idempotency public.qr_idempotency_records%rowtype;
  v_remaining_items jsonb := '[]'::jsonb;
  v_response jsonb;
  v_kitchen_status text;
begin
  if coalesce(p_session_hash, '') = '' or p_submission_reference is null or
     coalesce(p_idempotency_key_hash, '') = '' or coalesce(p_request_fingerprint, '') = '' or
     jsonb_typeof(coalesce(p_items, 'null'::jsonb)) <> 'array' or jsonb_array_length(p_items) = 0 then
    return jsonb_build_object('ok', false, 'code', 'INVALID_EDIT_REQUEST');
  end if;

  select * into v_session from public.qr_customer_sessions
   where session_token_hash = p_session_hash for update;
  if not found or v_session.revoked_at is not null or v_session.expires_at <= now() then
    return jsonb_build_object('ok', false, 'code', 'QR_SESSION_INVALID');
  end if;

  select * into v_submission from public.qr_order_submissions
   where public_reference = p_submission_reference
     and qr_session_id = v_session.id and hotel_slug = v_session.hotel_slug for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'QR_SUBMISSION_NOT_OWNED'); end if;
  if v_submission.row_version <> p_expected_version then
    return jsonb_build_object('ok', false, 'code', 'QR_SUBMISSION_CHANGED', 'currentVersion', v_submission.row_version);
  end if;
  if v_submission.status not in ('pending', 'new') or
     (v_submission.edit_expires_at is not null and v_submission.edit_expires_at <= now()) then
    return jsonb_build_object('ok', false, 'code', 'QR_EDIT_LOCKED');
  end if;

  select * into v_idempotency from public.qr_idempotency_records
   where qr_session_id = v_session.id and action_scope = 'edit:' || p_submission_reference::text
     and idempotency_key_hash = p_idempotency_key_hash;
  if found then
    if v_idempotency.request_fingerprint <> p_request_fingerprint then
      return jsonb_build_object('ok', false, 'code', 'IDEMPOTENCY_KEY_REUSED');
    end if;
    return v_idempotency.response_json || jsonb_build_object('duplicate', true);
  end if;

  select * into v_order from public.orders
   where id::text = v_submission.order_id and hotel_slug = v_submission.hotel_slug for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'ORDER_NOT_FOUND'); end if;

  if v_submission.round_sequence = 1 then
    v_kitchen_status := lower(coalesce(v_order.kitchen_status, v_order.status, 'new'));
  else
    select * into v_round from public.order_rounds
     where hotel_slug = v_submission.hotel_slug and order_id = v_submission.order_id
       and sequence_number = v_submission.round_sequence for update;
    if not found then return jsonb_build_object('ok', false, 'code', 'ROUND_NOT_FOUND'); end if;
    v_kitchen_status := lower(coalesce(v_round.status, 'new'));
  end if;
  if v_kitchen_status not in ('pending', 'received', 'new') then
    return jsonb_build_object('ok', false, 'code', 'QR_EDIT_LOCKED', 'kitchenStatus', v_kitchen_status);
  end if;

  select coalesce(jsonb_agg(item), '[]'::jsonb) into v_remaining_items
    from jsonb_array_elements(coalesce(v_order.items, '[]'::jsonb)) item
   where coalesce(item->>'qrSubmissionReference', '') <> v_submission.public_reference::text;

  update public.orders set
    items = v_remaining_items || p_items,
    totals = public.replace_qr_order_totals(totals, v_submission.totals_delta, p_totals),
    order_version = coalesce(order_version, 1) + 1
   where id = v_order.id returning * into v_order;

  if v_submission.round_sequence > 1 then
    update public.order_rounds set
      items = p_items, totals_delta = p_totals, note = nullif(btrim(coalesce(p_note, '')), ''),
      row_version = row_version + 1, updated_at = now()
     where id = v_round.id returning * into v_round;
  end if;

  update public.qr_order_submissions set
    items = p_items, totals_delta = p_totals, note = nullif(btrim(coalesce(p_note, '')), ''),
    row_version = row_version + 1, updated_at = now()
   where id = v_submission.id returning * into v_submission;

  v_response := jsonb_build_object(
    'ok', true, 'duplicate', false, 'orderId', v_order.id,
    'submission', to_jsonb(v_submission),
    'round', case when v_submission.round_sequence > 1 then to_jsonb(v_round) else null end
  );
  insert into public.qr_idempotency_records (
    hotel_slug, qr_session_id, action_scope, idempotency_key_hash,
    request_fingerprint, response_json, expires_at
  ) values (
    v_session.hotel_slug, v_session.id, 'edit:' || p_submission_reference::text,
    p_idempotency_key_hash, p_request_fingerprint, v_response, now() + interval '24 hours'
  );
  insert into public.qr_event_outbox (
    hotel_slug, aggregate_type, aggregate_id, event_type, deduplication_key, payload
  ) values (
    v_session.hotel_slug, 'order', v_order.id::text, 'QR_ORDER_CORRECTED',
    'qr-edit:' || v_session.id::text || ':' || p_idempotency_key_hash,
    jsonb_build_object('orderId', v_order.id, 'submissionReference', v_submission.public_reference,
      'roundSequence', v_submission.round_sequence, 'source', 'qr')
  );
  insert into public.qr_security_events (
    hotel_slug, restaurant_table_id, order_id, submission_reference,
    actor_reference, event_type, request_id, safe_context
  ) values (
    v_session.hotel_slug, v_session.restaurant_table_id, v_order.id::text,
    v_submission.public_reference::text, v_session.public_reference::text,
    'QR_ITEM_EDITED_BY_CUSTOMER', nullif(p_request_id, ''),
    jsonb_build_object('roundSequence', v_submission.round_sequence,
      'newVersion', v_submission.row_version, 'itemCount', jsonb_array_length(p_items))
  );
  return v_response;
end;
$$;

revoke all on function public.edit_secure_qr_submission(text,uuid,bigint,text,text,jsonb,jsonb,text,text)
  from public, anon, authenticated;
grant execute on function public.edit_secure_qr_submission(text,uuid,bigint,text,text,jsonb,jsonb,text,text)
  to service_role;
