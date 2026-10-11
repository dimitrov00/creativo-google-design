/**
 * Compile-time-only checks of the staff-ui group's `as const` tag
 * dictionaries (flatten-spec §7, §8.8: the group owns no component file, so
 * its dictionaries all live in its systems) — no runtime `expect()`/`it()`;
 * `nx typecheck` runs it through `tsconfig.spec.json`.
 *
 * 1. **`satisfies`** — each dictionary's values are of its type.
 * 2. **Holds** — the type is EXACTLY the dictionary's values, and no two
 *    keys share a value.
 * 3. **SCREAMING** — every value is upper-snake (N7/N8); none of the
 *    group's dictionaries is an external contract of §0.4.
 * 4. **N15 pair lines** (L8, read by `tools/lint-rules/dictionary-fields
 *    .spec.mjs`) — each discriminator is named `camelCase(Dictionary)`, and
 *    its type is exactly the dictionary. The other fields typed by these
 *    dictionaries keep the names §3.9 gives them (`SubjectStory.outcome`,
 *    `FilterRow.outcome`, the role `cancelledBy`), and the rest are
 *    parameters, not fields.
 */
import { SeatSubject } from './seat.data';
import {
  ClientQueryShape,
  type ParsedClientQuery,
  GridEvent,
  type RunEvent,
  type PageKey,
  PageStep,
  type PageStepResult,
  RepeatPreset,
  VisitFilter,
  VisitGrain,
  VisitPerspective,
  VisitRowOutcome,
  CancelledSide,
  type PersonSubject,
} from '@core/systems';

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

/** Any page step, whatever its rows and its opaque key. */
type AnyPageStep = PageStepResult<unknown, PageKey>;

/** The value-level `satisfies` runs at compile time only; nothing is called. */
declare function dictionary(checked: unknown): void;

// (1) satisfies — every dictionary's values are of its type.
dictionary(PageStep satisfies Dictionary<PageStep>);
dictionary(ClientQueryShape satisfies Dictionary<ClientQueryShape>);
dictionary(GridEvent satisfies Dictionary<GridEvent>);
dictionary(RepeatPreset satisfies Dictionary<RepeatPreset>);
dictionary(VisitGrain satisfies Dictionary<VisitGrain>);
dictionary(VisitRowOutcome satisfies Dictionary<VisitRowOutcome>);
dictionary(VisitFilter satisfies Dictionary<VisitFilter>);
dictionary(VisitPerspective satisfies Dictionary<VisitPerspective>);
dictionary(CancelledSide satisfies Dictionary<CancelledSide>);

// (2) Holds — each type is exactly its dictionary's values, one key each.
export type StaffUiDictionariesHold = [
  Expect<Holds<typeof PageStep, PageStep>>, // systems/paging.system.ts
  Expect<Holds<typeof ClientQueryShape, ClientQueryShape>>, // systems/client-query.system.ts
  Expect<Holds<typeof GridEvent, GridEvent>>, // systems/grid-layout.system.ts
  Expect<Holds<typeof RepeatPreset, RepeatPreset>>, // systems/visit-draft.system.ts
  Expect<Holds<typeof VisitGrain, VisitGrain>>, // systems/visit-list.system.ts
  Expect<Holds<typeof VisitRowOutcome, VisitRowOutcome>>, // systems/visit-list.system.ts
  Expect<Holds<typeof VisitFilter, VisitFilter>>, // systems/visit-list.system.ts
  Expect<Holds<typeof VisitPerspective, VisitPerspective>>, // systems/visit-list.system.ts
  Expect<Holds<typeof CancelledSide, CancelledSide>>, // systems/visit-story.system.ts
];

// (3) SCREAMING values — no exemption in this group.
export type StaffUiScreamingChecks = [
  Expect<Screaming<PageStep>>,
  Expect<Screaming<ClientQueryShape>>,
  Expect<Screaming<GridEvent>>,
  Expect<Screaming<RepeatPreset>>,
  Expect<Screaming<VisitGrain>>,
  Expect<Screaming<VisitRowOutcome>>,
  Expect<Screaming<VisitFilter>>,
  Expect<Screaming<VisitPerspective>>,
  Expect<Screaming<CancelledSide>>,
];

// (4) N15 — a dictionary's field is camelCase(Dictionary), typed exactly by it.
export type StaffUiDictionaryFields = [
  Expect<Equals<AnyPageStep['pageStep'], PageStep>>, // systems/paging.system.ts (`PageStepResult` is the union)
  Expect<Equals<ParsedClientQuery['clientQueryShape'], ClientQueryShape>>, // systems/client-query.system.ts
  Expect<Equals<RunEvent['gridEvent'], GridEvent>>, // systems/grid-layout.system.ts
  Expect<Equals<PersonSubject['seatSubject'], SeatSubject>>, // systems/visit-story.system.ts
];

// The checks are not vacuous.
export type StaffUiProbeNotScreaming = Expect<
  // @ts-expect-error — a lower-case value fails the SCREAMING check.
  Screaming<'no_show'>
>;
