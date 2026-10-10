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

Law 5 of `CLAUDE.md`. The database is the archetype table, not a serialized
object graph.

## Document = component bag

```
/appointments/{appointmentId}
  timeInterval:   { startMs: 1760000000000, endMs: 1760002700000 }
  bookingStatus:  { kind: 'confirmed', atMs: 1759990000000, pendingSinceMs: 1759980000000 }
  serviceBundle:  { items: [{ serviceId, barberId, startMs, endMs, priceMinorUnits }], totalMinorUnits: 2800, currencyCode: 'EUR' }
  ownerUserId:    'u_…'             // flat query keys live beside the components
  busyKeys:       ['b_ivan|2026-10-07']
```

- Field names equal the component names; nested maps equal the component
  types. `snap.data()` is the entity body; `{ id, ...data }` is the entity.
- No mapper files. No `*Document`/`*Doc` interfaces that differ from the
  entity. If a stored shape and an in-memory shape disagree, change one so
  they agree.
- Store what systems compute on: epoch ms (`number`), minutes-of-day
  (`number`), money as integer minor units (`number`) beside a `currencyCode` — the repo's vocabulary is `*MinorUnits` + `currencyCode`, never `*Cents` — and `as const` tags (`string`). Never ISO strings
  for arithmetic fields, never `Timestamp` objects inside components
  (a server-set `updatedAt` Timestamp at the document root is fine).

## Index-explosion prevention

- **Forbidden:** maps keyed by ids or dates (`days: { '2026-10-07': {…} }`,
  `byBarber: { b_ivan: {…} }`). Every distinct key is a distinct indexed
  field path.
- **Allowed:** bounded maps with keys fixed at design time (`rates: { client,
staff }`, a component bag itself).
- **Sequences are arrays of plain structs**, scanned in memory:
  `blocks: Array<{ startMinutes, endMinutes, kind }>`.
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
  outside the entity type, beside the entity's own `*Ms` instant.

## Rules and seed

- A rules change that touches a document shape ships with the data change.
- `pnpm run seed:dev` (`tools/seed-dev-catalog.mjs`) writes the component-bag
  shapes directly; it is the executable example of the layout and must be
  updated with every archetype change.
