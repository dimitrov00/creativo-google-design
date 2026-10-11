---
paths:
  - '**/*.primitive.ts'
  - 'libs/ecs-core/src/primitives/**'
---

# Branded primitives — Law 7 of `CLAUDE.md`

Never a raw `number` or `string` for a coordinate, an amount of money or an
id. Every primitive is a branded alias with JSDoc and a companion whose
smart constructor returns `Result`. Verified on the repo's TS 6.0.3
(2026-10-10): one shared `BrandSymbol` stays nominal per tag, a raw literal is
rejected, and the brand leaves nothing in the compiled output.

## The one helper (`primitives/brand.ts`)

```ts
declare const BrandSymbol: unique symbol;
/** Nominal type over a JavaScript primitive — zero runtime cost. */
export type Brand<T, B extends string> = T & { readonly [BrandSymbol]: B };
```

## A primitive (`primitives/minute-of-day.primitive.ts`)

```ts
import type { Brand } from './brand';
import type { MinuteCount } from './duration-minutes.primitive';
import { Result } from '../components/result.data';
import {
  PrimitiveErrorCode,
  type PrimitiveError,
} from './primitive-errors.data';

/**
 * Minutes from the shop's local midnight on its wall clock — an integer in
 * `[0, 1440)`. All collision, packing and availability math runs on it, which
 * keeps that math immune to DST. Never an instant; never carries a zone.
 */
export type MinuteOfDay = Brand<number, 'MinuteOfDay'>;

export const MinuteOfDay = {
  /** The smart constructor — the ONLY way foreign input becomes a MinuteOfDay. */
  of(raw: number): Result<MinuteOfDay, PrimitiveError> {
    return Number.isInteger(raw) && raw >= 0 && raw < 1440
      ? Result.ok(raw as MinuteOfDay)
      : Result.err({ errorCode: PrimitiveErrorCode.MinuteOutOfRange, raw });
  },
  /** Invariant-preserving math returns the brand; it never re-validates. */
  addClamped(m: MinuteOfDay, d: MinuteCount): MinuteOfDay {
    return Math.min(m + d, 1439) as MinuteOfDay;
  },
} as const;
```

## The core set

| Primitive                                                                                                                    | Base     | Meaning                                                                                                  | Smart constructor checks           |
| ---------------------------------------------------------------------------------------------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| `LocalDate`                                                                                                                  | `string` | the shop's wall-clock day, `YYYY-MM-DD`                                                                  | format and a real calendar date    |
| `MinuteOfDay`                                                                                                                | `number` | minutes from local midnight, `[0, 1440)`                                                                 | integer, range                     |
| `DurationMinutes`                                                                                                            | `number` | a positive whole number of minutes                                                                       | integer, `> 0`                     |
| `UtcEpochMs`                                                                                                                 | `number` | an absolute instant — indexes, crons, `.ics`, lifecycle stamps, elapsed-time rules; never placement math | safe integer                       |
| `PriceCents`                                                                                                                 | `number` | money in minor units (cents, stotinki), always beside a currency                                         | safe integer, `>= 0` unless signed |
| `TimeZone`                                                                                                                   | `string` | an IANA zone, configuration of a location only                                                           | accepted by `Intl.DateTimeFormat`  |
| `TenantId`, `LocationId`, `BarberId`, `CustomerId` (client record), `UserId` (auth account), `ServiceId`, `AppointmentId`, … | `string` | entity ids — `CustomerId` and `UserId` are never interchangeable                                         | non-empty, no `/`                  |

## Rules

- One file per primitive (or one `ids.primitive.ts` for the id family), each
  type with JSDoc saying what it is, its unit and its range.
- The `as Brand` cast appears **only** inside the primitive's own file — in
  its smart constructor and its invariant-preserving helpers.
- Smart constructors return `Result<X, PrimitiveError>`; errors are flat
  `{ errorCode: 'PRIMITIVE_…', raw }` structs. No `throw`, no `Error`.
- Every time primitive and conversion is time-zone-blind except `ZonedTimeSystem` at the ingestion boundary: a spring-forward gap time returns `DST_GAP_INVALID_TIME`, a fall-back repeat resolves to the earlier offset, and systems receive `ShopNow = { localDate, currentMinute, utcEpochMs }` (compute with the first two; stamp lifecycle instants with the third).
- No `Date`, no Luxon, no date library. `TimeZone` validation and every
  instant ↔ wall-clock conversion go through `ZonedTimeSystem` (native
  `Intl`), called at the ingestion boundary only.
