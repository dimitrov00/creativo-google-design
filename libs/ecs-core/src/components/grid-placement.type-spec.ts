/**
 * The grid placement dictionary (`grid-placement.data.ts`, pass C §2.4),
 * checked at compile time:
 *
 * 1. `Holds` — the dictionary's values are exactly its type, each value
 *    under one key only, and they are the listed SCREAMING literals (the
 *    values `grid-gesture.ts` declared, unchanged);
 * 2. the pair line — the field `GridLayoutSystem.placementVerdict` answers
 *    the tag under is `camelCase(Dictionary)` (Law 6), `null` when the draft
 *    stands.
 *
 * `tsc` failing IS the test; nothing here runs.
 */
import { PlacementVerdict } from './grid-placement.data';
import type { GridPlacement } from '@core/systems';

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

dictionary(PlacementVerdict satisfies Dictionary<PlacementVerdict>);

// (1) Holds — exact values, one key per value, the listed literals.
export type GridPlacementDictionaryHolds = [
  Expect<Holds<typeof PlacementVerdict, PlacementVerdict>>,
  Expect<Equals<PlacementVerdict, 'SHORT' | 'OVERLAP' | 'OUTSIDE'>>,
  Expect<Screaming<PlacementVerdict>>,
];

// (2) The pair line — the answer's field is camelCase(Dictionary), or null.
export type GridPlacementFieldPairs = [
  Expect<Equals<GridPlacement['placementVerdict'], PlacementVerdict | null>>,
];
