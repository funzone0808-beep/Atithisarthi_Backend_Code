-- Destructive rollback for the additive Room UX/gallery schema.
-- Back up public.room_images before running if uploaded-image metadata must be retained.

begin;

revoke all on function public.reorder_room_images(text,text,bigint,bigint[],text,text) from public,anon,authenticated,service_role;
revoke all on function public.delete_room_image(text,bigint,text,text) from public,anon,authenticated,service_role;
drop function if exists public.reorder_room_images(text,text,bigint,bigint[],text,text);
drop function if exists public.delete_room_image(text,bigint,text,text);
drop trigger if exists trg_protect_room_image_scope on public.room_images;
drop function if exists public.protect_room_image_scope();
drop table if exists public.room_images;

notify pgrst,'reload schema';
commit;
