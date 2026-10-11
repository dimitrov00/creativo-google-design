/**
 * Compile-only proofs over the booking-flow group's archetypes (Laws 2 and
 * 6, flatten-spec §7 notes): each entity is the intersection of FLAT slices
 * that share no field name, the intersection is never `never`, every field
 * of every variant is a primitive, a brand or a 1-to-N array (`NoNested`),
 * and each discriminator narrows. `tsc` failing — on a `false` constant or
 * an unused `@ts-expect-error` — IS the test; nothing here runs.
 */
import type { BookingCart } from '../components/cart-line.data';
import {
  ExceptionEffect,
  type ExceptionEffectRule,
} from '../components/exception-effect.data';
import type { FlexibleWhen } from '../components/flexible-when.data';
import {
  type WaitlistLifecycle,
  WaitlistStatus,
} from '../components/waitlist-status.data';
import type { AllTrue, Disjoint, NoNested } from '../testing';
import type {
  ScheduleException,
  ScheduleExceptionMeta,
} from './schedule-exception.entity';
import type {
  WaitlistRequest,
  WaitlistRequestMeta,
} from './waitlist-request.entity';

type IsNever<T> = [T] extends [never] ? true : false;
/** `true` when EVERY variant of the union is flat (distributes over `E`). */
type EveryVariantFlat<E> = E extends unknown ? AllTrue<NoNested<E>> : never;

/* ── ScheduleException = ScheduleExceptionMeta & ExceptionEffectRule ── */

export const scheduleExceptionNotNever: IsNever<ScheduleException> = false;
export const scheduleExceptionFlat: EveryVariantFlat<ScheduleException> = true;
export const scheduleExceptionDisjoint: Disjoint<
  ScheduleExceptionMeta,
  ExceptionEffectRule
> = true;

declare const exception: ScheduleException;
// The effect sits at the root and narrows on its own discriminator.
export const exceptionRanges: unknown =
  exception.exceptionEffect === ExceptionEffect.Hours
    ? exception.exceptionRanges
    : null;
export const closedHasNoRanges: unknown =
  exception.exceptionEffect === ExceptionEffect.Closed
    ? // @ts-expect-error — a closed day has no ranges
      exception.exceptionRanges
    : null;
// @ts-expect-error — the effect is flat, never nested under `effect`
export const noEffect: unknown = exception.effect;
// @ts-expect-error — no zone on a temporal entity (Law 7.2)
export const noZone: unknown = exception.zone;

/* ── WaitlistRequest = Meta & BookingCart & FlexibleWhen & WaitlistLifecycle ── */

export const waitlistRequestNotNever: IsNever<WaitlistRequest> = false;
export const waitlistRequestFlat: EveryVariantFlat<WaitlistRequest> = true;
export const waitlistRequestDisjoint: [
  Disjoint<WaitlistRequestMeta, BookingCart>,
  Disjoint<WaitlistRequestMeta, FlexibleWhen>,
  Disjoint<WaitlistRequestMeta, WaitlistLifecycle>,
  Disjoint<BookingCart, FlexibleWhen>,
  Disjoint<BookingCart, WaitlistLifecycle>,
  Disjoint<FlexibleWhen, WaitlistLifecycle>,
] = [true, true, true, true, true, true];

declare const request: WaitlistRequest;
// Every 1-to-1 component is a root field: no `cart`, `when` or `status`
// wrapper is left (Law 6.1).
export const requestRoot: readonly unknown[] = [
  request.cartSeats,
  request.cartNextSequence,
  request.flexibleDays,
  request.localDates,
  request.utcEpochMs,
  request.waitlistStatus,
  request.waitlistStatusAtUtcMs,
  request.createdAtUtcMs,
];
export const isMatched: boolean =
  request.waitlistStatus === WaitlistStatus.Matched;
// @ts-expect-error — the cart is flat (`cartSeats`), never nested
export const noCart: unknown = request.cart;
// @ts-expect-error — the lifecycle is flat (`waitlistStatus`), never `status`
export const noStatus: unknown = request.status;
// @ts-expect-error — no zone on a temporal entity (Law 7.2)
export const noRequestZone: unknown = request.zone;
