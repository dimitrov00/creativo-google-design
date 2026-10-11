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
import type { WaitlistRequest } from '../entities/waitlist-request.entity';
import type { ScheduleException } from '../entities/schedule-exception.entity';
import {
  type BookingFlowEvent,
  BookingFlowEventKind,
} from '../systems/booking-flow.system';
import {
  type CommitSubject,
  CommitSubjectRole,
  PrefillCompanions,
} from '../systems/booking-cart.system';
import { BookingFlowErrorCode } from './booking-flow-errors.data';
import {
  type BookingFlowState,
  BookingFlowStep,
  type MoveRefusal,
  MoveRefusalReason,
  ShopReach,
} from './booking-flow.data';
import { type SeatKey, SeatKeyRole } from './cart-line.data';
import { Daypart } from './daypart.data';
import { type ExceptionDetail, ExceptionReason } from './exception-detail.data';
import {
  ExceptionEffect,
  type ExceptionEffectRule,
} from './exception-effect.data';
import { type PartyMember, PartyRole } from './party.data';
import {
  MonthlyAnchor,
  RecurrenceEnd,
  type RecurrenceEndRule,
  RecurrenceFrequency,
  type RecurrencePattern,
  type RecurrenceRule,
  WeekOfMonth,
} from './recurrence-rule.data';
import { SchedulingErrorCode } from './scheduling-errors.data';
import { WaitlistErrorCode } from './waitlist-errors.data';
import { type WaitlistLifecycle, WaitlistStatus } from './waitlist-status.data';

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
dictionary(MoveRefusalReason satisfies Dictionary<MoveRefusalReason>);
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
dictionary(CommitSubjectRole satisfies Dictionary<CommitSubjectRole>);
dictionary(PrefillCompanions satisfies Dictionary<PrefillCompanions>);

// (2) Holds — each type is exactly its dictionary's values, one key each.
export type BookingFlowDictionariesHold = [
  Expect<Holds<typeof BookingFlowErrorCode, BookingFlowErrorCode>>, // components/booking-flow-errors.data.ts
  Expect<Holds<typeof SchedulingErrorCode, SchedulingErrorCode>>, // components/scheduling-errors.data.ts
  Expect<Holds<typeof WaitlistErrorCode, WaitlistErrorCode>>, // components/waitlist-errors.data.ts
  Expect<Holds<typeof BookingFlowStep, BookingFlowStep>>, // components/booking-flow.data.ts
  Expect<Holds<typeof MoveRefusalReason, MoveRefusalReason>>, // components/booking-flow.data.ts
  Expect<Holds<Pick<typeof ShopReach, 'Call' | 'Contact'>, ShopReach>>, // components/booking-flow.data.ts
  Expect<Holds<typeof SeatKeyRole, SeatKeyRole>>, // components/cart-line.data.ts
  Expect<
    Holds<Pick<typeof Daypart, 'Morning' | 'Afternoon' | 'Evening'>, Daypart>
  >, // components/daypart.data.ts
  Expect<Holds<typeof ExceptionReason, ExceptionReason>>, // components/exception-detail.data.ts
  Expect<Holds<typeof ExceptionEffect, ExceptionEffect>>, // components/exception-effect.data.ts
  Expect<Holds<typeof PartyRole, PartyRole>>, // components/party.data.ts
  Expect<Holds<typeof RecurrenceFrequency, RecurrenceFrequency>>, // components/recurrence-rule.data.ts
  Expect<Holds<typeof WeekOfMonth, WeekOfMonth>>, // components/recurrence-rule.data.ts
  Expect<Holds<typeof MonthlyAnchor, MonthlyAnchor>>, // components/recurrence-rule.data.ts
  Expect<Holds<typeof RecurrenceEnd, RecurrenceEnd>>, // components/recurrence-rule.data.ts
  Expect<Holds<typeof WaitlistStatus, WaitlistStatus>>, // components/waitlist-status.data.ts
  Expect<Holds<typeof BookingFlowEventKind, BookingFlowEventKind>>, // systems/booking-flow.system.ts
  Expect<Holds<typeof CommitSubjectRole, CommitSubjectRole>>, // systems/booking-cart.system.ts
  Expect<Holds<typeof PrefillCompanions, PrefillCompanions>>, // systems/booking-cart.system.ts
];

// (3) SCREAMING values (`ShopReach` and `WeekOfMonth` are exempt, §0.4).
export type BookingFlowScreamingChecks = [
  Expect<Screaming<BookingFlowErrorCode>>,
  Expect<Screaming<SchedulingErrorCode>>,
  Expect<Screaming<WaitlistErrorCode>>,
  Expect<Screaming<BookingFlowStep>>,
  Expect<Screaming<MoveRefusalReason>>,
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
  Expect<Screaming<CommitSubjectRole>>,
  Expect<Screaming<PrefillCompanions>>,
];

// (4) N15 — a dictionary's field is camelCase(Dictionary), typed exactly by it.
export type BookingFlowDictionaryFields = [
  Expect<Equals<BookingFlowState['bookingFlowStep'], BookingFlowStep>>, // components/booking-flow.data.ts
  Expect<Equals<MoveRefusal['moveRefusalReason'], MoveRefusalReason>>, // components/booking-flow.data.ts
  Expect<Equals<SeatKey['seatKeyRole'], SeatKeyRole>>, // components/cart-line.data.ts
  Expect<Equals<ExceptionDetail['exceptionReason'], ExceptionReason>>, // components/exception-detail.data.ts
  Expect<Equals<ExceptionEffectRule['exceptionEffect'], ExceptionEffect>>, // components/exception-effect.data.ts
  Expect<Equals<ScheduleException['exceptionEffect'], ExceptionEffect>>, // entities/schedule-exception.entity.ts
  Expect<Equals<PartyMember['partyRole'], PartyRole>>, // components/party.data.ts
  Expect<Equals<RecurrencePattern['recurrenceFrequency'], RecurrenceFrequency>>, // components/recurrence-rule.data.ts
  Expect<Equals<RecurrenceRule['recurrenceFrequency'], RecurrenceFrequency>>, // components/recurrence-rule.data.ts
  Expect<Equals<RecurrencePattern.Monthly['monthlyAnchor'], MonthlyAnchor>>, // components/recurrence-rule.data.ts
  Expect<Equals<RecurrenceEndRule['recurrenceEnd'], RecurrenceEnd>>, // components/recurrence-rule.data.ts
  Expect<Equals<RecurrenceRule['recurrenceEnd'], RecurrenceEnd>>, // components/recurrence-rule.data.ts
  Expect<Equals<WaitlistLifecycle['waitlistStatus'], WaitlistStatus>>, // components/waitlist-status.data.ts
  Expect<Equals<WaitlistRequest['waitlistStatus'], WaitlistStatus>>, // entities/waitlist-request.entity.ts
  Expect<
    Equals<BookingFlowEvent['bookingFlowEventKind'], BookingFlowEventKind>
  >, // systems/booking-flow.system.ts (N15: `BookingFlowEvent` is the union)
  Expect<Equals<CommitSubject['commitSubjectRole'], CommitSubjectRole>>, // systems/booking-cart.system.ts
];

// The checks are not vacuous.
export type ProbeNotScreaming = Expect<
  // @ts-expect-error — a lower-case value fails the SCREAMING check.
  Screaming<'booking.flow.party_full'>
>;
