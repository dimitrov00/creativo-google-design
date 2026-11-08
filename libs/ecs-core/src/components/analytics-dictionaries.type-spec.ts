/**
 * Compile-time-only checks of the staff-analytics group's `as const` tag
 * dictionaries (checklist cd-2-18) — no runtime `expect()`/`it()`; `nx
 * typecheck` runs it through `tsconfig.spec.json`.
 *
 * 1. **`satisfies`** — each dictionary's values are of its type.
 * 2. **Holds** — the type is EXACTLY the dictionary's values, and no two
 *    keys share a value.
 * 3. **SCREAMING** — every value is upper-snake.
 * 4. **N15 pair lines** (read by `tools/lint-rules/dictionary-fields
 *    .spec.mjs`) — each tag field is named `camelCase(Dictionary)`, and its
 *    type is exactly the dictionary. `AnalyticsFigure` names a drill-down's
 *    figure in the screen's state (`AnalyticsDrill.analyticsFigure`, in
 *    `libs/features/staff/analytics`), outside ecs-core, so it has no pair
 *    here; the report's own span is prefixed like every report field.
 */
import type { HourOfDay, Weekday } from '@core/primitives';
import {
  type AnalyticsBarSegment,
  type AnalyticsHeroChange,
  type HourPeak,
  MoneyAllocation,
  type VisitNets,
} from '@core/systems';
import type { AnalyticsCall } from './analytics-call.data';
import { type AnalyticsPeriod, AnalyticsSpan } from './analytics-period.data';
import {
  AnalyticsBarPart,
  AnalyticsFigure,
  type AnalyticsReport,
  BookingOrigin,
  HeroChange,
} from './analytics-report.data';

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
dictionary(AnalyticsSpan satisfies Dictionary<AnalyticsSpan>);
dictionary(BookingOrigin satisfies Dictionary<BookingOrigin>);
dictionary(AnalyticsFigure satisfies Dictionary<AnalyticsFigure>);
dictionary(AnalyticsBarPart satisfies Dictionary<AnalyticsBarPart>);
dictionary(HeroChange satisfies Dictionary<HeroChange>);
dictionary(MoneyAllocation satisfies Dictionary<MoneyAllocation>);

// (2) Holds — each type is exactly its dictionary's values, one key each.
export type AnalyticsDictionariesHold = [
  Expect<Holds<typeof AnalyticsSpan, AnalyticsSpan>>, // components/analytics-period.data.ts
  Expect<Holds<typeof BookingOrigin, BookingOrigin>>, // components/analytics-report.data.ts
  Expect<Holds<typeof AnalyticsFigure, AnalyticsFigure>>, // components/analytics-report.data.ts
  Expect<Holds<typeof AnalyticsBarPart, AnalyticsBarPart>>, // components/analytics-report.data.ts
  Expect<Holds<typeof HeroChange, HeroChange>>, // components/analytics-report.data.ts
  Expect<Holds<typeof MoneyAllocation, MoneyAllocation>>, // systems/money-allocation.system.ts
];

// (3) SCREAMING values.
export type AnalyticsScreamingChecks = [
  Expect<Screaming<AnalyticsSpan>>,
  Expect<Screaming<BookingOrigin>>,
  Expect<Screaming<AnalyticsFigure>>,
  Expect<Screaming<AnalyticsBarPart>>,
  Expect<Screaming<HeroChange>>,
  Expect<Screaming<MoneyAllocation>>,
];

// (4) N15 — a dictionary's field is camelCase(Dictionary), typed exactly by it.
export type AnalyticsDictionaryFields = [
  Expect<Equals<AnalyticsPeriod['analyticsSpan'], AnalyticsSpan>>, // components/analytics-period.data.ts
  Expect<Equals<AnalyticsCall['analyticsSpan'], AnalyticsSpan>>, // components/analytics-call.data.ts
  Expect<Equals<AnalyticsReport['reportAnalyticsSpan'], AnalyticsSpan>>, // N15-exempt: the report's fields all carry the `report` prefix
  Expect<Equals<AnalyticsReport.OriginShare['bookingOrigin'], BookingOrigin>>, // components/analytics-report.data.ts
  Expect<Equals<AnalyticsBarSegment['analyticsBarPart'], AnalyticsBarPart>>, // systems/staff-analytics.system.ts
  Expect<Equals<AnalyticsHeroChange['heroChange'], HeroChange>>, // systems/staff-analytics.system.ts
  Expect<Equals<VisitNets['moneyAllocation'], MoneyAllocation>>, // systems/money-allocation.system.ts
  Expect<Equals<AnalyticsReport.HourCell['weekday'], Weekday>>, // components/analytics-report.data.ts
  Expect<Equals<HourPeak['weekday'], Weekday>>, // systems/analytics-hour.system.ts
  Expect<Equals<AnalyticsReport['reportBusiestWeekday'], Weekday | null>>, // N15-exempt: the report's fields all carry the `report` prefix
  Expect<Equals<AnalyticsReport['reportEmptiestWeekday'], Weekday | null>>, // N15-exempt: the report's fields all carry the `report` prefix
];

// The hour grid's hour is the `HourOfDay` tag — a plain number like `Weekday`, never a bare `number`.
export type AnalyticsHourFields = [
  Expect<Equals<AnalyticsReport.HourCell['hour'], HourOfDay>>, // N15-exempt: the design's row names the hour `hour`
  Expect<Equals<HourPeak['hour'], HourOfDay>>, // N15-exempt: the design's row names the hour `hour`
  Expect<Equals<AnalyticsReport['reportBusiestHour'], HourOfDay | null>>, // N15-exempt: the report's fields all carry the `report` prefix
  Expect<Equals<AnalyticsReport['reportEmptiestHour'], HourOfDay | null>>, // N15-exempt: the report's fields all carry the `report` prefix
];
