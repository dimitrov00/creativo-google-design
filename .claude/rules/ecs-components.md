---
paths:
  - '**/*.data.ts'
  - '**/*.entity.ts'
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
    from: BookingLifecycle.Confirmed,
    atUtcMs: UtcEpochMs,
    reason: CancellationReason,
  ): BookingLifecycle.Cancelled {
    return {
      bookingStatus: BookingStatus.Cancelled,
      confirmedAtUtcMs: from.confirmedAtUtcMs,
      cancelledAtUtcMs: atUtcMs,
      cancellationReason: reason,
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
    readonly confirmedAtUtcMs: UtcEpochMs; // history the next variant keeps, declared
    readonly cancelledAtUtcMs: UtcEpochMs;
    readonly cancellationReason: CancellationReason;
  };
  export type Completed = {
    readonly bookingStatus: typeof BookingStatus.Completed;
    readonly confirmedAtUtcMs: UtcEpochMs;
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
  plan sets every field of the new variant and deletes (`FieldValue.delete()`)
  every field of the old variant the new one does not declare. History worth
  keeping is declared on the later variant (as `confirmedAtUtcMs` above).

The type-alias + `as const` companion + type-only namespace triple merges, and
esbuild erases the namespace entirely. The namespace must stay type-only — a
value inside it would collide with the companion `const`.

## A slice without variants (`time-coordinate.data.ts`)

```ts
/** Where a booking sits on the shop's clock, and on the absolute timeline. */
export type TimeCoordinate = {
  readonly localDate: LocalDate; // the shop's wall-clock day, 'YYYY-MM-DD'
  readonly startMinutes: MinuteOfDay; // [0, 1440) from the shop's local midnight
  readonly endMinutes: MinuteOfDay; // [0, 1440)
  readonly utcEpochMs: UtcEpochMs; // absolute start — computed ONCE at ingestion, for indexes/crons/.ics only
};

export const TimeCoordinate = {
  durationMinutes(t: TimeCoordinate): DurationMinutes {
    return DurationMinutes.between(t.startMinutes, t.endMinutes);
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
import type { TimeCoordinate } from '../components/time-coordinate.data';
import type { BookingLifecycle } from '../components/booking-lifecycle.data';
import type { PaymentRecord } from '../components/payment-record.data';

/** Branded id; its smart constructor lives in primitives/ids.primitive.ts. */
import type {
  AppointmentId,
  TenantId,
  LocationId,
  BarberId,
  CustomerId,
} from '../primitives/ids.primitive';
import type { PriceCents } from '../primitives/price-cents.primitive';

/** The identity slice: the id and the plain 1-to-1 attributes. */
export type AppointmentMeta = {
  readonly id: AppointmentId;
  readonly tenantId: TenantId;
  readonly locationId: LocationId;
  readonly currency: Currency; // 'EUR' | 'BGN'
  readonly priceCents: PriceCents;
  readonly barberIds: readonly BarberId[]; // 1-to-N: an array is allowed
  readonly customerIds: readonly CustomerId[]; // 1-to-N: the people booked
  readonly seats: readonly Seat[]; // 1-to-N: an array of flat structs
};

/** The archetype — every 1-to-1 field at the root. The document is this minus `id`. */
export type Appointment = AppointmentMeta &
  TimeCoordinate &
  BookingLifecycle &
  PaymentRecord;
```

Ids are `Brand<string, '…'>` primitives (Law 7) — nominal per tag, zero
runtime cost. Do **not** add `assemble()`, `create()` that only spreads, or
`Object.freeze`; structural typing is the constructor. The entity type is the
archetype's noun (`Appointment`), with no `Entity` suffix.

Every entity ships a compile-only type-spec proving the intersection is not
`never` and that each discriminator narrows:

```ts
type IsNever<T> = [T] extends [never] ? true : false;
const notNever: IsNever<Appointment> = false;
declare const apt: Appointment;
if (apt.bookingStatus === BookingStatus.Cancelled) apt.cancellationReason; // ok
// @ts-expect-error — a confirmed booking has no cancellationReason
if (apt.bookingStatus === BookingStatus.Confirmed) apt.cancellationReason;
```

## Result and errors (`result.data.ts`, `*-errors.data.ts`)

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

/** Error codes — the ONLY source of these strings (`booking-errors.data.ts`). */
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

## Checklist before you save a `*.data.ts` / `*.entity.ts`

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
- [ ] Imports are other components' types, companions and tag dictionaries
      only; no system, port, adapter, Firebase or Angular import.
- [ ] Values are what systems compute on (local minutes, cents, epoch ms), never formatted strings.
