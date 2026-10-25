/**
 * Compile-time-only checks of the booking-flow group's `as const` tag
 * dictionaries (flatten-spec §7, §8.1: the group's own split of
 * `dictionaries.type-spec.ts`) — no runtime `expect()`/`it()`; `nx
 * typecheck` runs it through `tsconfig.spec.json`.
 *
 * 1. **`satisfies`** — each dictionary's values are of its type.
 * 2. **Holds** — the type is EXACTLY the dictionary's values, and no two
 *    keys share a value.
 * 3. **SCREAMING** — every value is upper-snake (N7/N8), except the two
 *    external contracts of §0.4 the group owns: `ShopReach` (i18n keys) and
 *    `WeekOfMonth` (ordinals the walk computes with, not tags).
 * 4. **N15 pair lines** (L8, read by `tools/lint-rules/dictionary-fields
 *    .spec.mjs`) — each discriminator and plain tag field is named
 *    `camelCase(Dictionary)`, and its type is exactly the dictionary.
 */
import type { WaitlistRequest, ScheduleException } from '@core/entities';
import { ExceptionEffect, WaitlistStatus } from '@core/primitives';
import {
  BookingFlowErrorCode,
  type MoveErrorCode,
  type MoveRefusal,
  SchedulingErrorCode,
  WaitlistErrorCode,
} from '@core/errors';
import { type BookingFlowState, BookingFlowStep } from './booking-flow.data';
import {
  type BookingFlowEvent,
  BookingFlowEventKind,
} from './booking-flow-event.data';
import { Daypart } from './daypart.data';
import { type ExceptionDetail, ExceptionReason } from './exception-detail.data';
import type { ExceptionEffectRule } from './exception-effect-rule.data';
import { type PartyMember, PartyRole } from './party-member.data';
import { PrefillCompanions } from './prefill-companions.data';
import {
  RecurrenceEnd,
  type RecurrenceEndRule,
} from './recurrence-end-rule.data';
import {
  MonthlyAnchor,
  RecurrenceFrequency,
  type RecurrencePattern,
  WeekOfMonth,
} from './recurrence-pattern.data';
import type { RecurrenceRule } from './recurrence-rule.data';
import { type SeatKey, SeatKeyRole } from './seat-key.data';
import { ShopReach } from './shop-reach.data';
import type { WaitlistLifecycle } from './waitlist-lifecycle.data';

/** A tag dictionary whose every value is a `T`. */
type Dictionary<T> = { readonly [key: string]: T };
type Expect<T extends true> = T;
type IsNever<T> = [T] extends [never] ? true : false;
/** Exact type equality (not mere mutual assignability). */
type Equals<X, Y> =
  (<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2
    ? true
    : false;
/** The keys of `D` whose value another key also has. */
type SharedValueKeys<D> = {
  [K in keyof D]: D[K] extends D[Exclude<keyof D, K>] ? K : never;
}[keyof D];
/** `D`'s values are exactly `T`, each value under one key only. */
type Holds<D, T> =
  Equals<D[keyof D], T> extends true ? IsNever<SharedValueKeys<D>> : false;
type Screaming<V extends string> = [V] extends [Uppercase<V>] ? true : false;

/** The value-level `satisfies` runs at compile time only; nothing is called. */
declare function dictionary(checked: unknown): void;

// (1) satisfies — every dictionary's values are of its type.
dictionary(BookingFlowErrorCode satisfies Dictionary<BookingFlowErrorCode>);
dictionary(SchedulingErrorCode satisfies Dictionary<SchedulingErrorCode>);
dictionary(WaitlistErrorCode satisfies Dictionary<WaitlistErrorCode>);
dictionary(BookingFlowStep satisfies Dictionary<BookingFlowStep>);
dictionary(ShopReach satisfies Readonly<Record<'Call' | 'Contact', ShopReach>>);
dictionary(SeatKeyRole satisfies Dictionary<SeatKeyRole>);
dictionary(
  Daypart satisfies Readonly<
    Record<'Morning' | 'Afternoon' | 'Evening', Daypart>
  >,
);
dictionary(ExceptionReason satisfies Dictionary<ExceptionReason>);
dictionary(ExceptionEffect satisfies Dictionary<ExceptionEffect>);
dictionary(PartyRole satisfies Dictionary<PartyRole>);
dictionary(RecurrenceFrequency satisfies Dictionary<RecurrenceFrequency>);
dictionary(WeekOfMonth satisfies Dictionary<WeekOfMonth>);
dictionary(MonthlyAnchor satisfies Dictionary<MonthlyAnchor>);
dictionary(RecurrenceEnd satisfies Dictionary<RecurrenceEnd>);
dictionary(WaitlistStatus satisfies Dictionary<WaitlistStatus>);
dictionary(BookingFlowEventKind satisfies Dictionary<BookingFlowEventKind>);
dictionary(PrefillCompanions satisfies Dictionary<PrefillCompanions>);

// (2) Holds — each type is exactly its dictionary's values, one key each.
export type BookingFlowDictionariesHold = [
  Expect<Holds<typeof BookingFlowErrorCode, BookingFlowErrorCode>>, // errors/booking-flow.error.ts
  Expect<Holds<typeof SchedulingErrorCode, SchedulingErrorCode>>, // errors/scheduling.error.ts
  Expect<Holds<typeof WaitlistErrorCode, WaitlistErrorCode>>, // errors/waitlist.error.ts
  Expect<Holds<typeof BookingFlowStep, BookingFlowStep>>, // components/booking-flow.data.ts
  Expect<Holds<Pick<typeof ShopReach, 'Call' | 'Contact'>, ShopReach>>, // components/shop-reach.data.ts
  Expect<Holds<typeof SeatKeyRole, SeatKeyRole>>, // components/seat-key.data.ts
  Expect<
    Holds<Pick<typeof Daypart, 'Morning' | 'Afternoon' | 'Evening'>, Daypart>
  >, // components/daypart.data.ts
  Expect<Holds<typeof ExceptionReason, ExceptionReason>>, // components/exception-detail.data.ts
  Expect<Holds<typeof ExceptionEffect, ExceptionEffect>>, // primitives/exception-effect.data.ts
  Expect<Holds<typeof PartyRole, PartyRole>>, // components/party-member.data.ts
  Expect<Holds<typeof RecurrenceFrequency, RecurrenceFrequency>>, // components/recurrence-pattern.data.ts
  Expect<Holds<typeof WeekOfMonth, WeekOfMonth>>, // components/recurrence-pattern.data.ts
  Expect<Holds<typeof MonthlyAnchor, MonthlyAnchor>>, // components/recurrence-pattern.data.ts
  Expect<Holds<typeof RecurrenceEnd, RecurrenceEnd>>, // components/recurrence-end-rule.data.ts
  Expect<Holds<typeof WaitlistStatus, WaitlistStatus>>, // primitives/waitlist-status.data.ts
  Expect<Holds<typeof BookingFlowEventKind, BookingFlowEventKind>>, // components/booking-flow-event.data.ts
  Expect<Holds<typeof PrefillCompanions, PrefillCompanions>>, // components/prefill-companions.data.ts
];

// (3) SCREAMING values (`ShopReach` and `WeekOfMonth` are exempt, §0.4).
export type BookingFlowScreamingChecks = [
  Expect<Screaming<BookingFlowErrorCode>>,
  Expect<Screaming<SchedulingErrorCode>>,
  Expect<Screaming<WaitlistErrorCode>>,
  Expect<Screaming<BookingFlowStep>>,
  Expect<Screaming<SeatKeyRole>>,
  Expect<Screaming<Daypart>>,
  Expect<Screaming<ExceptionReason>>,
  Expect<Screaming<ExceptionEffect>>,
  Expect<Screaming<PartyRole>>,
  Expect<Screaming<RecurrenceFrequency>>,
  Expect<Screaming<MonthlyAnchor>>,
  Expect<Screaming<RecurrenceEnd>>,
  Expect<Screaming<WaitlistStatus>>,
  Expect<Screaming<BookingFlowEventKind>>,
  Expect<Screaming<PrefillCompanions>>,
];

// (4) N15 — a dictionary's field is camelCase(Dictionary), typed exactly by it.
export type BookingFlowDictionaryFields = [
  Expect<Equals<BookingFlowState['bookingFlowStep'], BookingFlowStep>>, // components/booking-flow.data.ts
  Expect<Equals<SeatKey['seatKeyRole'], SeatKeyRole>>, // components/seat-key.data.ts
  Expect<Equals<ExceptionDetail['exceptionReason'], ExceptionReason>>, // components/exception-detail.data.ts
  Expect<Equals<ExceptionEffectRule['exceptionEffect'], ExceptionEffect>>, // primitives/exception-effect.data.ts
  Expect<Equals<ScheduleException['exceptionEffect'], ExceptionEffect>>, // entities/schedule-exception.entity.ts
  Expect<Equals<PartyMember['partyRole'], PartyRole>>, // components/party-member.data.ts
  Expect<Equals<RecurrencePattern['recurrenceFrequency'], RecurrenceFrequency>>, // components/recurrence-pattern.data.ts
  Expect<Equals<RecurrenceRule['recurrenceFrequency'], RecurrenceFrequency>>, // components/recurrence-rule.data.ts
  Expect<Equals<RecurrencePattern.Monthly['monthlyAnchor'], MonthlyAnchor>>, // components/recurrence-pattern.data.ts
  Expect<Equals<RecurrenceEndRule['recurrenceEnd'], RecurrenceEnd>>, // components/recurrence-end-rule.data.ts
  Expect<Equals<RecurrenceRule['recurrenceEnd'], RecurrenceEnd>>, // components/recurrence-rule.data.ts
  Expect<Equals<WaitlistLifecycle['waitlistStatus'], WaitlistStatus>>, // primitives/waitlist-status.data.ts
  Expect<Equals<WaitlistRequest['waitlistStatus'], WaitlistStatus>>, // entities/waitlist-request.entity.ts
  Expect<
    Equals<BookingFlowEvent['bookingFlowEventKind'], BookingFlowEventKind>
  >, // components/booking-flow-event.data.ts (N15: `BookingFlowEvent` is the union)
];

// The move refusal (pass D, D-9.2): its code is exactly the three client-side
// members of the move family's ONE dictionary (`MoveErrorCode`, held and
// SCREAMING-checked in appointment-dictionaries.type-spec.ts).
type MoveRefusalCode = MoveRefusal['errorCode'];
export type MoveRefusalCodes = Expect<
  Equals<
    MoveRefusalCode,
    | typeof MoveErrorCode.CompanionsOnly
    | typeof MoveErrorCode.Unavailable
    | typeof MoveErrorCode.CarriedOutOfReach
  >
>;

// The checks are not vacuous.
export type ProbeNotScreaming = Expect<
  // @ts-expect-error — a lower-case value fails the SCREAMING check.
  Screaming<'booking.flow.party_full'>
>;
