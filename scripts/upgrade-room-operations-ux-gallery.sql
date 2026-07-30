-- Additive Room Operations UX and hotel-scoped public room-image gallery storage.
-- Apply after create-room-booking-tables.sql and upgrade-professional-room-operations.sql.

begin;

create table if not exists public.room_images (
  id bigserial primary key,
  hotel_slug text not null,
  room_id bigint references public.rooms(id) on delete cascade,
  room_type_id bigint references public.room_types(id) on delete cascade,
  storage_path text not null,
  original_url text not null,
  card_url text not null default '',
  optimized_url text not null default '',
  thumbnail_url text not null default '',
  mime_type text not null check (mime_type in ('image/jpeg','image/png','image/webp')),
  alt_text text not null check (length(trim(alt_text)) between 2 and 240),
  caption text not null default '' check (length(caption) <= 500),
  display_order integer not null default 0,
  is_primary boolean not null default false,
  is_active boolean not null default true,
  width integer not null check (width between 320 and 8000),
  height integer not null check (height between 240 and 8000),
  file_size integer not null check (file_size between 1 and 8388608),
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint room_images_exactly_one_target check (
    (room_id is not null and room_type_id is null) or
    (room_id is null and room_type_id is not null)
  ),
  constraint room_images_storage_path_unique unique (storage_path),
  constraint room_images_primary_active check (not is_primary or is_active)
);

create index if not exists idx_room_images_hotel_room
  on public.room_images (hotel_slug,room_id,is_active,display_order,id)
  where room_id is not null;
create index if not exists idx_room_images_hotel_type
  on public.room_images (hotel_slug,room_type_id,is_active,display_order,id)
  where room_type_id is not null;
create unique index if not exists uq_room_images_room_order
  on public.room_images (hotel_slug,room_id,display_order)
  where room_id is not null;
create unique index if not exists uq_room_images_type_order
  on public.room_images (hotel_slug,room_type_id,display_order)
  where room_type_id is not null;
create unique index if not exists uq_room_images_room_primary
  on public.room_images (hotel_slug,room_id)
  where room_id is not null and is_primary;
create unique index if not exists uq_room_images_type_primary
  on public.room_images (hotel_slug,room_type_id)
  where room_type_id is not null and is_primary;

create or replace function public.protect_room_image_scope()
returns trigger language plpgsql set search_path=public,pg_temp as $$
declare v_owner_slug text; v_target text;
begin
  if new.room_id is not null then
    select hotel_slug into v_owner_slug from public.rooms where id=new.room_id;
    v_target:='room:'||new.room_id;
  else
    select hotel_slug into v_owner_slug from public.room_types where id=new.room_type_id;
    v_target:='room-type:'||new.room_type_id;
  end if;
  if v_owner_slug is null or v_owner_slug<>new.hotel_slug then
    raise exception using errcode='P0001',message='ROOM_IMAGE_HOTEL_SCOPE_MISMATCH';
  end if;
  if new.storage_path not like new.hotel_slug||'/room-images/%' or position('..' in new.storage_path)>0 then
    raise exception using errcode='P0001',message='ROOM_IMAGE_STORAGE_SCOPE_MISMATCH';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('room-image:'||new.hotel_slug||':'||v_target,0));
  if new.is_primary then
    update public.room_images set is_primary=false,updated_at=now()
      where hotel_slug=new.hotel_slug
        and id<>coalesce(new.id,0)
        and room_id is not distinct from new.room_id
        and room_type_id is not distinct from new.room_type_id
        and is_primary;
  end if;
  new.updated_at:=now();
  return new;
end $$;

drop trigger if exists trg_protect_room_image_scope on public.room_images;
create trigger trg_protect_room_image_scope
before insert or update on public.room_images
for each row execute function public.protect_room_image_scope();

create or replace function public.reorder_room_images(
  p_hotel_slug text,p_target_type text,p_target_id bigint,p_image_ids bigint[],p_actor_id text,p_actor_role text
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_room_id bigint; v_room_type_id bigint; v_count integer; v_distinct integer;
  v_index integer; v_image_id bigint;
begin
  if coalesce(cardinality(p_image_ids),0)=0 or cardinality(p_image_ids)>50 then
    raise exception using errcode='P0001',message='ROOM_IMAGE_REORDER_SET_INVALID';
  end if;
  if p_target_type='room' then
    select id into v_room_id from public.rooms where id=p_target_id and hotel_slug=p_hotel_slug;
    if not found then raise exception using errcode='P0001',message='ROOM_IMAGE_TARGET_NOT_FOUND'; end if;
  elsif p_target_type='room_type' then
    select id into v_room_type_id from public.room_types where id=p_target_id and hotel_slug=p_hotel_slug;
    if not found then raise exception using errcode='P0001',message='ROOM_IMAGE_TARGET_NOT_FOUND'; end if;
  else
    raise exception using errcode='P0001',message='ROOM_IMAGE_TARGET_INVALID';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('room-image:'||p_hotel_slug||':'||p_target_type||':'||p_target_id,0));
  select count(*) into v_count from public.room_images
    where hotel_slug=p_hotel_slug
      and room_id is not distinct from v_room_id
      and room_type_id is not distinct from v_room_type_id;
  select count(distinct value) into v_distinct from unnest(p_image_ids) as ids(value);
  if cardinality(p_image_ids)<>v_count or v_distinct<>v_count then
    raise exception using errcode='P0001',message='ROOM_IMAGE_REORDER_SET_MISMATCH';
  end if;
  if exists (
    select 1 from unnest(p_image_ids) as ids(value)
    where not exists (
      select 1 from public.room_images i
      where i.id=ids.value and i.hotel_slug=p_hotel_slug
        and i.room_id is not distinct from v_room_id
        and i.room_type_id is not distinct from v_room_type_id
    )
  ) then raise exception using errcode='P0001',message='ROOM_IMAGE_HOTEL_SCOPE_MISMATCH'; end if;
  for v_index in 1..cardinality(p_image_ids) loop
    v_image_id:=p_image_ids[v_index];
    update public.room_images set display_order=-(1000+v_index),updated_at=now()
      where id=v_image_id and hotel_slug=p_hotel_slug;
  end loop;
  for v_index in 1..cardinality(p_image_ids) loop
    v_image_id:=p_image_ids[v_index];
    update public.room_images set display_order=v_index-1,updated_at=now()
      where id=v_image_id and hotel_slug=p_hotel_slug;
  end loop;
  insert into public.room_operation_audit(
    hotel_slug,actor_id,actor_role,action,target_type,target_id,new_value
  ) values (
    p_hotel_slug,p_actor_id,coalesce(nullif(p_actor_role,''),'manager'),'room_images_reordered',p_target_type,p_target_id::text,
    jsonb_build_object('imageIds',p_image_ids)
  );
  return jsonb_build_object('imageIds',p_image_ids);
end $$;

create or replace function public.delete_room_image(
  p_hotel_slug text,p_image_id bigint,p_actor_id text,p_actor_role text
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_image public.room_images%rowtype; v_next_id bigint;
begin
  select * into v_image from public.room_images
    where id=p_image_id and hotel_slug=p_hotel_slug for update;
  if not found then raise exception using errcode='P0001',message='ROOM_IMAGE_NOT_FOUND'; end if;
  perform pg_advisory_xact_lock(hashtextextended(
    'room-image:'||p_hotel_slug||':'||
    case when v_image.room_id is not null then 'room:'||v_image.room_id else 'room-type:'||v_image.room_type_id end,0
  ));
  delete from public.room_images where id=p_image_id and hotel_slug=p_hotel_slug;
  if v_image.is_primary then
    select id into v_next_id from public.room_images
      where hotel_slug=p_hotel_slug
        and room_id is not distinct from v_image.room_id
        and room_type_id is not distinct from v_image.room_type_id
        and is_active
      order by display_order,id limit 1 for update;
    if v_next_id is not null then
      update public.room_images set is_primary=true,updated_at=now()
        where id=v_next_id and hotel_slug=p_hotel_slug;
    end if;
  end if;
  insert into public.room_operation_audit(
    hotel_slug,actor_id,actor_role,action,target_type,target_id,old_value
  ) values (
    p_hotel_slug,p_actor_id,coalesce(nullif(p_actor_role,''),'manager'),'room_image_deleted','room_image',p_image_id::text,to_jsonb(v_image)
  );
  return to_jsonb(v_image);
end $$;

revoke all on function public.reorder_room_images(text,text,bigint,bigint[],text,text) from public,anon,authenticated;
revoke all on function public.delete_room_image(text,bigint,text,text) from public,anon,authenticated;
grant execute on function public.reorder_room_images(text,text,bigint,bigint[],text,text) to service_role;
grant execute on function public.delete_room_image(text,bigint,text,text) to service_role;

alter table public.room_images enable row level security;
revoke all on public.room_images from anon,authenticated;
grant select,insert,update,delete on public.room_images to service_role;
grant usage,select on sequence public.room_images_id_seq to service_role;

notify pgrst,'reload schema';
commit;
