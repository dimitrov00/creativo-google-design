---
paths:
  - 'firestore.rules'
  - 'firestore.indexes.json'
  - 'storage.rules'
  - '**/*.adapter.ts'
  - 'libs/infrastructure/**'
  - 'apps/functions/src/**'
  - 'apps/api/src/**'
  - 'tools/seed/**'
  - 'tools/seed-dev-catalog.mjs'
---

# Firestore — the data-oriented layout

Laws 5 and 6 of `CLAUDE.md`. The database is the archetype table — flat
rows of root fields — not a serialized object graph.

## Document = flat archetype (Law 6)

```
/appointments/{appointmentId}
  tenantId:          'creativo'
  locationId:        'loc_center'
  barberIds:         ['b_ivan']                 // 1-to-N: array
  subjectUserIds:    ['u_42']                   // 1-to-N: array (query key); D29: flip (1) adds subjectCustomerIds beside it
  localDate:         '2026-10-07'               // TimeCoordinate, flat at the root
  startMinutes:      600
  endMinutes:        645
  utcEpochMs:        1759820400000
  bookingStatus:     'CONFIRMED'                // BookingLifecycle, flat at the root
  confirmedAtUtcMs:  1759780000000
  paymentMethod:     'UNPAID'                   // PaymentRecord, flat at the root
  priceCents:        2800
  currency:          'EUR'
  seats:             [{ seatId, barberId, serviceId, startMinutes, durationMinutes, priceCents }]  // 1-to-N
  busyKeys:          ['b_ivan__2026-10-07']
```

- Every 1-to-1 field is a root key; the document, the wire JSON and the
  TypeScript entity are the same flat layout. `snap.data()` is the entity
  body; `{ id, ...data }` is the entity. Sub-objects and arrays appear only
  for true 1-to-N relationships (`seats`, `barberIds`) or a third-party
  audit blob.
- No mapper files. No `*Document`/`*Doc` interfaces that differ from the
  entity. If a stored shape and an in-memory shape disagree, change one so
  they agree.
- **Writes target root fields, never dot paths:**
  `update(ref, { bookingStatus: 'CANCELLED', cancelledAtUtcMs, cancellationReason: 'ILLNESS' })`.
  A transition also deletes (`FieldValue.delete()`) every field of the old
  variant that the new variant does not declare, so the stored document is
  always exactly one variant.
- **No time-zone field on a temporal document (Law 7).** The IANA zone lives
  only on `locations/{id}.timeZone`; appointments, exceptions, busy days and
  waitlist requests store `localDate` + `*Minutes` (the shop wall clock) and
  `utcEpochMs` (computed once at ingestion).
- Rules and composite indexes test top-level keys only (`bookingStatus`,
  `startMinutes`, `utcEpochMs`, `localDate`).
- Store what systems compute on: instants as `*UtcMs` epoch milliseconds,
  shop days as `localDate` (`YYYY-MM-DD`), times of day as `*Minutes`, money
  as integer `*Cents` with a `currency` (`'EUR' | 'BGN'`), tags as
  SCREAMING_SNAKE strings. Never ISO strings for arithmetic fields, never
  `Timestamp` objects in the entity (the TTL `purgeAt` Timestamp is the one
  adapter-stamped root field outside the entity type).

## Index-explosion prevention

- **Forbidden:** maps keyed by ids or dates (`days: { '2026-10-07': {…} }`,
  `byBarber: { b_ivan: {…} }`). Every distinct key is a distinct indexed
  field path.
- **Allowed:** bounded maps with keys fixed at design time (`rates: { client,
staff }`, a component bag itself).
- **Sequences are arrays of plain structs**, scanned in memory:
  `blocks: Array<{ startMinutes, endMinutes, blockKind }>` — array elements
  are flat structs with domain-prefixed discriminators too.
- **Arrays that are never queried** (operation logs, seat pairs, photo
  references, write plans) get a `fieldOverrides` entry with `"indexes": []`
  in `firestore.indexes.json` — the file already does this for
  `appointments.appliedOperations` and `appointments.stoodSeatPairs`; follow
  that precedent.
- **Every composite query declares its index** in the same change. The
  emulator does not enforce composite indexes, so a missing one is
  emulator-green and production-dead.

## Collections

- Unbounded entities are top-level: `appointments`, `users`,
  `appointmentPhotos`, `clientJournal`, `waitlistRequests`, `otps`, `barberBusy`, `capacity`, `scheduleExceptions`. Never embed a
  growing list inside `locations/*`, `barbers/*` or `settings/*`. The one
  owner-scoped exception is `users/{uid}/notifications` — a subcollection,
  owner-read, TTL-purged, never queried across users.
- Projections (`barberBusy`, `capacity/{YYYY-MM}`) are rebuilt by triggers
  from the source collection; they are caches with a TTL, not truth.
- Invariants that must not regress (2026-08 audit): appointments are
  callable-only in rules for everyone including staff; `capacity/{YYYY-MM}` is a month document holding a sorted `entries[]` array of `{ dayKey, barberId, locationId, freeMinutes }` (D7) — rebuilt inside one transaction by dropping every entry in the plan's scope and writing the full sorted array, never `arrayUnion`, never `set({ merge: true })`, never one barber's plan alone; TTL on `purgeAt` for `otps`, `notifications`,
  `waitlistRequests`, `barberBusy`, `capacity`, `impersonationSessions`,
  `barberLeadTimeSamples`. `purgeAt` is the one Firestore `Timestamp` in a
  document (the TTL service requires it): an adapter-stamped root field
  outside the entity type, beside the entity's own `*UtcMs` instant.

## Rules and seed

- A rules change that touches a document shape ships with the data change.
- `pnpm run seed:dev` (`tools/seed-dev-catalog.mjs`) writes the component-bag
  shapes directly; it is the executable example of the layout and must be
  updated with every archetype change.
