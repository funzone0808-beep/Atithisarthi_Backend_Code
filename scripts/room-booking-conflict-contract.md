# Room Booking Conflict Contract

Use this contract when handling room booking conflicts in public, owner/staff, and platform-admin clients.

## Scope

This contract applies to overlapping active bookings for the same room and date range.

Protected booking statuses:

- `pending`
- `confirmed`
- `checked_in`

Date overlap rule:

```text
existing_check_in < requested_check_out
AND
existing_check_out > requested_check_in
```

Check-in is inclusive. Check-out is exclusive, so same-day checkout/check-in can be allowed when dates do not overlap.

## Routes

The same conflict code is returned from:

- `POST /api/public/rooms/:slug/bookings`
- `POST /api/admin/room-booking/bookings`
- `POST /api/staff/room-booking/bookings`

Availability endpoints may exclude blocked rooms before submit, but final booking creation still revalidates availability on the backend.

## Response Shape

All room double-booking conflicts must use HTTP `409 Conflict`.

```json
{
  "success": false,
  "code": "ROOM_ALREADY_BOOKED",
  "message": "This room is already booked for selected dates. Please choose another room or date."
}
```

Frontend code must check `code === "ROOM_ALREADY_BOOKED"` before falling back to message text.

## Privacy

Public responses must not expose:

- guest name
- guest phone
- guest email
- internal booking id
- booking source
- staff/admin identity

Owner/staff clients may show extra internal context only after backend authorization and tenant scoping are verified.

## Backend Guarantees

Backend booking creation must:

- derive tenant scope from the route/auth context
- validate room belongs to the same hotel
- recheck availability immediately before insert
- rely on the database overlap constraint as the final race-condition guard
- return `ROOM_ALREADY_BOOKED` for both pre-insert conflict checks and database exclusion-constraint conflicts

Do not implement separate online and offline room inventory.