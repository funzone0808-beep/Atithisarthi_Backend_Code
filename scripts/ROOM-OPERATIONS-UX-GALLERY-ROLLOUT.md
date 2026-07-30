# Room Operations UX and Gallery Rollout

This is an additive Room PMS upgrade. Existing `rooms.images_json` and `room_types.images_json` values remain readable as a public fallback. Do not remove those legacy values during the first rollout.

## Safe rollout order

1. Back up the database and confirm the existing Room PMS live verifier still passes.
2. Run the source-only gate from `backend`:
   `npm run verify:room-operations-ux-gallery`
3. Apply `scripts/upgrade-room-operations-ux-gallery.sql` in the same production Supabase project used by the backend.
4. Run the read-only live gate from `backend`:
   `npm run verify:room-operations-ux-gallery-live`
5. Deploy the backend and frontend source together.
6. Test with one Manager and one normal Staff account before uploading the full image catalogue.

The migration creates only the `room_images` table, indexes, constraints, trigger, and two service-role-only RPCs. It does not rewrite bookings, room prices, GST, bills, legacy image arrays, or food/KDS data.

## Required storage behavior

The existing public `hotel-assets` bucket is reused. Manager uploads are stored only under:

`<authenticated-hotel-slug>/room-images/<room-or-room-type-id>/...`

The backend validates JPG, PNG, or WebP bytes, dimensions, size, hotel ownership, and the trusted storage prefix. Transformed thumbnail/card/gallery URLs are generated through Supabase Storage. If image transformations are unavailable, the UI falls back to the original upload.

## Manager smoke test

- Open Staff Workspace → Room Operations → Inventory & Images.
- Confirm search, floor/type/status filters, pagination, and table/card layout.
- Open a room, upload two test images with meaningful alt text, choose a primary, reorder them, hide and republish the non-primary image, then delete it.
- Confirm a normal Staff login cannot see Inventory & Images or Configuration.
- Confirm direct requests to Manager inventory/media APIs return `403` for normal Staff.

## Public smoke test

- Open the public hotel home page and check Room availability.
- Confirm each room card loads only its primary image and shows the photo count.
- Open the gallery; test thumbnail selection, Left/Right arrows, swipe, Escape, fullscreen, and focus return.
- Choose “Request this room” and confirm the selected dates and guest counts are preserved.
- Confirm hidden images do not appear publicly and a broken transformed URL falls back to the original.

## Rollback

Use `scripts/rollback-room-operations-ux-gallery.sql` only after backing up `public.room_images`. The rollback deletes gallery metadata and functions; it does not remove storage objects. After the database rollback, remove only verified objects under each hotel’s exact `<hotel-slug>/room-images/` prefix. Never bulk-delete the `hotel-assets` bucket.

Legacy `images_json` values continue to serve public room images after rollback.

## Freeze gate

**Status: FROZEN — owner approved on 2026-07-24.**

The owner confirmed the target behavior after checking the completed Room Operations UX/gallery implementation. Future changes to the frozen scope require explicit owner approval to unfreeze, a documented reason, proportionate regression testing, and renewed owner confirmation before refreezing.