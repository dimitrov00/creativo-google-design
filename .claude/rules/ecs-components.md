---
paths:
  - '**/*.data.ts'
  - '**/*.entity.ts'
---

# Components and entities — the exact shape

Law 1 and Law 2 of `CLAUDE.md`, as code. Copy these shapes; do not improvise.

## A component with variants (`booking-status.data.ts`)

```ts
/** State tags — the ONLY source of these strings. */
export const BookingState = {
  Pending: 'pending',
  Confirmed: 'confirmed',
  Cancelled: 'cancelled',
} as const;
export type BookingState = (typeof BookingState)[keyof typeof BookingState];

/** 1. Root type: the discriminated union. */
export type BookingStatus =
  BookingStatus.Pending | BookingStatus.Confirmed | BookingStatus.Cancelled;

/** 2. Companion object: pure factories, guards, helper math. */
export const BookingStatus = {
  pending(atMs: number): BookingStatus.Pending {
    return { kind: BookingState.Pending, atMs };
  },
  confirm(s: BookingStatus.Pending, atMs: number): BookingStatus.Confirmed {
    return { kind: BookingState.Confirmed, atMs, pendingSinceMs: s.atMs };
  },
  isTerminal(s: BookingStatus): s is BookingStatus.Cancelled {
    return s.kind === BookingState.Cancelled;
  },
} as const;

/** 3. ONE type-only namespace; each variant declared exactly once. */
export namespace BookingStatus {
  export type Pending = {
    readonly kind: typeof BookingState.Pending;
    readonly atMs: number;
  };
  export type Confirmed = {
    readonly kind: typeof BookingState.Confirmed;
    readonly atMs: number;
    readonly pendingSinceMs: number;
  };
  export type Cancelled = {
    readonly kind: typeof BookingState.Cancelled;
    readonly atMs: number;
    readonly reason: string;
  };
}
```

Verified 2026-10-07 on the repo's strict tsconfig (TS 6.0.3): the
type-alias + `as const` companion + type-only namespace triple merges, and
esbuild erases the namespace entirely. The namespace must stay type-only — a
value inside it would collide with the companion `const`. The discriminant key is always `kind` — the repo's existing unions and composite indexes (`status.kind`, `effect.kind`) already use it, so no index path is renamed.

## A component without variants (`time-interval.data.ts`)

```ts
/** Half-open `[startMs, endMs)` in epoch milliseconds. */
export type TimeInterval = { readonly startMs: number; readonly endMs: number };

export const TimeInterval = {
  of(startMs: number, endMs: number): TimeInterval {
    return { startMs, endMs };
  },
  overlaps(a: TimeInterval, b: TimeInterval): boolean {
    return a.startMs < b.endMs && b.startMs < a.endMs;
  },
  durationMinutes(i: TimeInterval): number {
    return (i.endMs - i.startMs) / 60_000;
  },
} as const;
```

No namespace when there is nothing to put in it.

## An entity (`appointment.entity.ts`)

```ts
import type { TimeInterval } from '../components/time-interval.data';
import type { BookingStatus } from '../components/booking-status.data';
import type { ServiceBundle } from '../components/service-bundle.data';

export type AppointmentId = string & { readonly __brand: unique symbol };
export const AppointmentId = {
  /** The only cast site. Validate the raw string at the edge, not here. */
  of: (raw: string): AppointmentId => raw as AppointmentId,
} as const;

/** The archetype. The Firestore document body is this type minus `id`. */
export type AppointmentEntity = {
  readonly id: AppointmentId;
  readonly timeInterval: TimeInterval;
  readonly bookingStatus: BookingStatus;
  readonly serviceBundle: ServiceBundle;
};
```

`readonly` on the brand property is required (TS1330 otherwise). Two ids
declared this way are nominal — not assignable to each other — with zero
runtime cost. Do **not** add `assemble()`, `create()` that only spreads, or
`Object.freeze`; structural typing is the constructor.

## Result and errors (`result.data.ts`, `*.errors.data.ts`)

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

export type BookingError =
  | { readonly code: 'booking.slot_unavailable'; readonly seatIndex: number }
  | { readonly code: 'booking.outside_window' };
```

Error `code`s are stable, dotted, language-neutral keys — the UI resolves
them through i18n. Never a class, never thrown for an expected outcome.

## Checklist before you save a `*.data.ts` / `*.entity.ts`

- [ ] No `class`, `new`, `this`, getters, methods on data, `Object.freeze`.
- [ ] Every string tag is read from an `as const` dictionary.
- [ ] Variants exist only inside the one namespace; the root union lists them.
- [ ] The name does not end in `Component`; the suffix is `.data.ts`/`.entity.ts`.
- [ ] No optional property (`?:`) and no `| undefined` — absent is `null`,
      so every value of a type shares one hidden class.
- [ ] Imports are other components' types, companions and tag dictionaries
      only; no system, port, adapter, Firebase or Angular import.
- [ ] Numbers are what systems compute on (epoch ms, minutes), not formatted strings.
