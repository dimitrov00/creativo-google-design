---
paths:
  - '**/*.data.ts'
  - '**/*.entity.ts'
  - '**/*.error.ts'
---

# Components and entities — the exact shape

Laws 1, 2, 6 and 7 of `CLAUDE.md`, as code. Every coordinate, amount and
id below is a branded primitive from `primitives/` (Law 7; templates in
`ecs-primitives.md`). Copy these shapes; do not improvise.
Every shape below was compiled on the repo's strict tsconfig (TS 6.0.3) on
2026-10-10: the intersection is never `never`, narrowing on each
discriminator exposes exactly its variant's fields, a system typed on a slice
accepts the whole entity, and a slice that reuses another slice's
discriminator collapses the entity to `never` (so the type-spec catches it).

## A component with variants (`booking-lifecycle.data.ts`)

```ts
/** Discriminator values — the ONLY source of these strings. Named after the field. */
export const BookingStatus = {
  Confirmed: 'CONFIRMED',
  Cancelled: 'CANCELLED',
  Completed: 'COMPLETED',
} as const;
export type BookingStatus = (typeof BookingStatus)[keyof typeof BookingStatus];

/** 1. Root type: a union of FLAT variant slices. */
export type BookingLifecycle =
  | BookingLifecycle.Confirmed
  | BookingLifecycle.Cancelled
  | BookingLifecycle.Completed;

/** 2. Companion object: pure factories, guards, helper math. */
export const BookingLifecycle = {
  confirm(atUtcMs: UtcEpochMs): BookingLifecycle.Confirmed {
    return {
      bookingStatus: BookingStatus.Confirmed,
      confirmedAtUtcMs: atUtcMs,
    };
  },
  cancel(
    atUtcMs: UtcEpochMs,
    reasons: CancellationReasonSet,
  ): BookingLifecycle.Cancelled {
    return {
      bookingStatus: BookingStatus.Cancelled,
      cancelledAtUtcMs: atUtcMs,
      cancellationReason: reasons,
    };
  },
  isTerminal(l: BookingLifecycle): boolean {
    return l.bookingStatus !== BookingStatus.Confirmed;
  },
} as const;

/** 3. ONE type-only namespace; each variant declared exactly once. */
export namespace BookingLifecycle {
  export type Confirmed = {
    readonly bookingStatus: typeof BookingStatus.Confirmed;
    readonly confirmedAtUtcMs: UtcEpochMs;
  };
  export type Cancelled = {
    readonly bookingStatus: typeof BookingStatus.Cancelled;
    readonly cancelledAtUtcMs: UtcEpochMs; // the entering stamp only (F-20)
    readonly cancellationReason: CancellationReasonSet; // a party's 1-to-N reasons, one stored string (F-24)
  };
  export type Completed = {
    readonly bookingStatus: typeof BookingStatus.Completed;
    readonly completedAtUtcMs: UtcEpochMs;
  };
}
```

- The discriminator is **domain-prefixed** (`bookingStatus`, `paymentMethod`,
  `attendanceState`) — never `type`, `kind` or `status`.
- Its values are SCREAMING_SNAKE, declared once in the dictionary named after
  the field (`BookingStatus.Cancelled` → `'CANCELLED'`).
- Variant-only fields carry their own prefix (`cancelledAtUtcMs`,
  `cancellationReason`) so slices never collide.
- **Transitions keep the document equal to exactly one variant:** the write
  plan is `WriteOp.transition(path, fields, WriteOp.variantFieldsToDelete(
before, after))` — it sets every field of the new variant and deletes
  (`FieldValue.delete()`) every field of the old variant the new one does
  not declare; never hand-list the stale fields. Each variant carries only
  its entering stamp (F-20: today's data has no history to declare); a
  history worth keeping would be declared on the later variant.

The type-alias + `as const` companion + type-only namespace triple merges, and
esbuild erases the namespace entirely. The namespace must stay type-only — a
value inside it would collide with the companion `const`.

## A slice without variants (`time-coordinate.data.ts`)

`TimeCoordinate` — the owner's name (Law 6) — is the time slice every
temporal entity uses, flat at its root.

```ts
/** Where a booking sits on the shop's clock, and on the absolute timeline. */
export type TimeCoordinate = {
  readonly localDate: LocalDate; // the shop's wall-clock day, 'YYYY-MM-DD'
  readonly startMinutes: MinuteOfDay; // [0, 1440) from the shop's local midnight
  readonly endMinutes: EndMinute; // (0, 1440] — an exclusive end (F-1)
  readonly utcEpochMs: UtcEpochMs; // absolute start — computed ONCE at ingestion; indexes, crons, .ics, lifecycle stamps, elapsed-time checks — never placement math
};

export const TimeCoordinate = {
  durationMinutes(t: TimeCoordinate): MinuteCount {
    return MinuteCount.span(t.startMinutes, t.endMinutes);
  },
  overlaps(a: TimeCoordinate, b: TimeCoordinate): boolean {
    return (
      a.localDate === b.localDate &&
      a.startMinutes < b.endMinutes &&
      b.startMinutes < a.endMinutes
    );
  },
} as const;
```

No namespace when there is nothing to put in it. No time-zone field: the zone
is the location's (Law 7). Zone math (wall clock ↔ instant, DST) never lives
here — `ZonedTimeSystem` does it once, at the ingestion boundary, on native
`Intl`; collision math uses only `localDate` + `*Minutes`.

## An entity (`appointment.entity.ts`)

```ts
import type {
  TimeCoordinate,
  BookingLifecycle,
  PaymentRecord,
} from '@core/components'; // PaymentRecord illustrative, see below

/** Branded ids; their smart constructors live in primitives/ids.primitive.ts. */
import type {
  AppointmentId,
  TenantId,
  LocationId,
  BarberId,
  UserId,
  Currency,
  PriceCents,
} from '@core/primitives'; // Law 8: cross-tier imports name the tier alias

/** The identity slice: the id and the plain 1-to-1 attributes. */
export type AppointmentMeta = {
  readonly id: AppointmentId;
  readonly tenantId: TenantId;
  readonly locationId: LocationId;
  readonly currency: Currency; // 'EUR' | 'BGN' | 'USD' | 'GBP'
  readonly priceCents: PriceCents;
  readonly barberIds: readonly BarberId[]; // 1-to-N: an array is allowed
  readonly subjectUserIds: readonly UserId[]; // 1-to-N; the D29 subjectCustomerIds sit beside it (AppointmentClientRefs)
  readonly seats: readonly Seat[]; // 1-to-N: an array of flat structs
};

/** The archetype — every 1-to-1 field at the root. The document is this minus `id`. */
export type Appointment = AppointmentMeta &
  TimeCoordinate &
  BookingLifecycle &
  PaymentRecord;
```

**`PaymentRecord` is the owner's illustrative payment slice** (`paymentMethod:
'UNPAID' | 'CASH' | 'CARD'`, variant fields such as `paidCents` and
`stripePaymentIntentId`). No payment data is stored yet, so today's stored
`Appointment` in `libs/ecs-core` intersects eight slices and no payment slice:
`AppointmentMeta & AppointmentClientRefs & TimeCoordinate & BookingLifecycle &
BookingContact & AppointmentStamps & StoodSeatPairs & WriteProvenance` (the
last writing call's `writeOperationId`, audit-hardening WS-4.3). Its `AppointmentMeta`
stores no `tenantId` and no root price — the money lives on each seat
(`priceCents` + `currency`) — and holds the query mirrors, the placement, the
discount and voucher lines and the staff-edit ledger beside the seats.
`PaymentRecord` joins the intersection — unchanged in shape — the day payments
are recorded.

Ids are `Brand<string, '…'>` primitives (Law 7) — nominal per tag, zero
runtime cost. Do **not** add `assemble()`, `create()` that only spreads, or
`Object.freeze`; structural typing is the constructor. The entity type is the
archetype's noun (`Appointment`), with no `Entity` suffix.

Every entity ships a compile-only type-spec proving the intersection is not
`never`, that each discriminator narrows, that every variant is flat and that
its slices share no field name — with the helpers of
`@core/testing` (`NoNested`, `AllTrue`, `KeysOfUnion`,
`Disjoint`), never re-typed:

```ts
type IsNever<T> = [T] extends [never] ? true : false;
const notNever: IsNever<Appointment> = false;
type EveryVariantFlat = Appointment extends unknown
  ? AllTrue<NoNested<Appointment>>
  : never;
const flat: EveryVariantFlat = true;
const disjoint: Disjoint<AppointmentMeta, TimeCoordinate> = true;
declare const apt: Appointment;
if (apt.bookingStatus === BookingStatus.Cancelled) apt.cancellationReason; // ok
// @ts-expect-error — a confirmed booking has no cancellationReason
if (apt.bookingStatus === BookingStatus.Confirmed) apt.cancellationReason;
```

## Result and errors (`primitives/result.data.ts`, `errors/*.error.ts`)

```ts
export type Result<T, E> = Result.Ok<T> | Result.Err<E>;
export const Result = {
  ok: <T>(value: T): Result.Ok<T> => ({ ok: true, value }),
  err: <E>(error: E): Result.Err<E> => ({ ok: false, error }),
} as const;
export namespace Result {
  export type Ok<T> = { readonly ok: true; readonly value: T };
  export type Err<E> = { readonly ok: false; readonly error: E };
}

/** Error codes — the ONLY source of these strings (`booking.error.ts`). */
export const BookingErrorCode = {
  SlotUnavailable: 'BOOKING_SLOT_UNAVAILABLE',
  OutsideWindow: 'BOOKING_OUTSIDE_WINDOW',
} as const;

/** Flat, zero-prototype, serialisable — discriminated by errorCode (Law 7). */
export type BookingError =
  | {
      readonly errorCode: typeof BookingErrorCode.SlotUnavailable;
      readonly seatIndex: number;
    }
  | {
      readonly errorCode: typeof BookingErrorCode.OutsideWindow;
      readonly localDate: LocalDate;
    };
```

`errorCode` values are SCREAMING_SNAKE, prefixed with their domain, stable
and language-neutral — the UI resolves `errors.<errorCode>` through i18n.
Never a class, never a stack trace, never thrown for an expected outcome;
`throw` is only for a programmer defect.

**Where errors live (the Error file kind, owner ruling 2026-10-23).** The
dictionary, its struct union and the factory companion of one domain sit in
ONE `*.error.ts` file of the `@core/errors` tier —
`libs/ecs-core/src/errors/booking.error.ts`, exported through
`@core/errors` — never in a `*.data.ts`, a system or a pipeline
(`creativo/error-dictionary-home`). The tier imports only primitives, so an
error's context fields are scalars, branded primitives and the base tag
dictionaries of primitives (`readonly bookingStatus: BookingStatus`), never
a component type. `Result` stays in `primitives/result.data.ts`;
`PrimitiveError`, the brands' own refusals, stays in
`primitives/primitive.error.ts`. A component companion that refuses
answers an error from `@core/errors` (components sit above it).

## Checklist before you save a `*.data.ts` / `*.entity.ts` / `*.error.ts`

- [ ] No `class`, `new`, `this`, getters, methods on data, `Object.freeze`.
- [ ] Every discriminator is domain-prefixed (never `type`, `kind`, `status`)
      and its SCREAMING_SNAKE values come from an `as const` dictionary.
- [ ] Every 1-to-1 field is at the root; sub-objects and arrays only for
      true 1-to-N relationships or third-party audit blobs.
- [ ] Every coordinate, amount and id is a branded primitive (Law 7):
      `UtcEpochMs` (`*UtcMs`), `LocalDate`, `MinuteOfDay` (`*Minutes`),
      `DurationMinutes`, `PriceCents` (`*Cents`) with a `currency`, `*Id`.
- [ ] No time-zone field on a temporal slice — the zone is the location's.
- [ ] Errors are flat `{ errorCode, … }` structs; no `Error`, no `throw`.
- [ ] Variants exist only inside the one namespace; the root union lists them.
- [ ] The name does not end in `Component`; the suffix is `.data.ts`/`.entity.ts`.
- [ ] No optional property (`?:`) and no `| undefined` — absent is `null`,
      so every value of a type shares one hidden class.
- [ ] Imports: a `*.data.ts` / `*.entity.ts` imports other components'
      types and companions, `@core/errors` and `@core/primitives` (brands,
      `Result`, base tag dictionaries); a `*.error.ts` imports only
      `@core/primitives`, never a component type. None imports a system,
      port, adapter, Firebase or Angular.
- [ ] A `*.error.ts` sits in `libs/ecs-core/src/errors/` (the one exception:
      `primitives/primitive.error.ts`) and holds one domain's
      `*ErrorCode`/`*RefusalCode` dictionary, its flat struct union and a
      factory companion — no `throw`.
- [ ] Values are what systems compute on (local minutes, cents, epoch ms), never formatted strings.
- [ ] No member that only forwards to another function, or copies its
      argument field by field into its own type (`creativo/no-identity-mapper`).
      A projection declares the wider value it cuts from
      (`<T extends X>(value: T): X`), and its doc says what it keeps.
