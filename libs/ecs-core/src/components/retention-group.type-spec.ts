/**
 * The retention group dictionary (`retention-group.data.ts`, pass C §2.10,
 * P-34), checked at compile time:
 *
 * 1. `Holds` — the dictionary's values are exactly its type, each value
 *    under one key only, and they are the listed SCREAMING literals (one
 *    per TTL group of `firestore-layout.md`);
 * 2. the pair line — `RetentionAnchor` is discriminated by the field
 *    `camelCase(Dictionary)` (Law 6), one variant per value, and narrowing on
 *    it exposes exactly that variant's anchor fields, every one flat.
 *
 * `tsc` failing IS the test; nothing here runs.
 */
import type { AllTrue, NoNested } from '@core/testing';
import { RetentionAnchor, RetentionGroup } from './retention-group.data';

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

/** A tag dictionary whose every value is a `T`. */
type Dictionary<T> = { readonly [key: string]: T };
/** The value-level `satisfies` runs at compile time only; nothing is called. */
declare function dictionary(checked: unknown): void;

dictionary(RetentionGroup satisfies Dictionary<RetentionGroup>);

/** Every member of `T` flat — distributive, so each variant is checked alone. */
type EveryVariantFlat<T> = T extends unknown ? AllTrue<NoNested<T>> : never;

/** The variant of `RetentionAnchor` a group narrows to. */
type AnchorOf<G extends RetentionGroup> = Extract<
  RetentionAnchor,
  { readonly retentionGroup: G }
>;

// (1) Holds — exact values, one key per value, the listed literals.
export type RetentionGroupDictionaryHolds = [
  Expect<Holds<typeof RetentionGroup, RetentionGroup>>,
  Expect<
    Equals<
      RetentionGroup,
      | 'BARBER_BUSY'
      | 'CAPACITY'
      | 'WAITLIST_REQUESTS'
      | 'NOTIFICATIONS'
      | 'LEAD_TIME_SAMPLES'
      | 'OTPS'
      | 'IMPERSONATION_SESSIONS'
    >
  >,
  Expect<Screaming<RetentionGroup>>,
];

// (2) The pair line — the anchor's discriminator is camelCase(Dictionary),
// every value has its variant, and each variant is flat.
export type RetentionAnchorPairs = [
  Expect<Equals<RetentionAnchor['retentionGroup'], RetentionGroup>>,
  Expect<
    Equals<
      keyof AnchorOf<typeof RetentionGroup.BarberBusy>,
      'retentionGroup' | 'localDate'
    >
  >,
  Expect<
    Equals<
      keyof AnchorOf<typeof RetentionGroup.Capacity>,
      'retentionGroup' | 'monthFirstDay'
    >
  >,
  Expect<
    Equals<
      keyof AnchorOf<typeof RetentionGroup.WaitlistRequests>,
      'retentionGroup' | 'localDates'
    >
  >,
  Expect<
    Equals<
      keyof AnchorOf<typeof RetentionGroup.Notifications>,
      'retentionGroup' | 'sentAtUtcMs'
    >
  >,
  Expect<
    Equals<
      keyof AnchorOf<typeof RetentionGroup.LeadTimeSamples>,
      'retentionGroup' | 'localDate'
    >
  >,
  Expect<
    Equals<
      keyof AnchorOf<typeof RetentionGroup.Otps>,
      'retentionGroup' | 'expiresAtUtcMs'
    >
  >,
  Expect<
    Equals<
      keyof AnchorOf<typeof RetentionGroup.ImpersonationSessions>,
      'retentionGroup' | 'endedAtUtcMs' | 'expiresAtUtcMs'
    >
  >,
  Expect<EveryVariantFlat<RetentionAnchor>>,
];

// The companion builds each variant under its own group.
export type RetentionAnchorFactories = [
  Expect<
    Equals<
      ReturnType<typeof RetentionAnchor.capacity>['retentionGroup'],
      typeof RetentionGroup.Capacity
    >
  >,
  Expect<
    Equals<
      ReturnType<
        typeof RetentionAnchor.impersonationSessions
      >['retentionGroup'],
      typeof RetentionGroup.ImpersonationSessions
    >
  >,
];
