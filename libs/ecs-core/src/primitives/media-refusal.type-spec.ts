/**
 * The upload refusal dictionary (`media-refusal.data.ts`, pass C §2.8),
 * checked at compile time:
 *
 * 1. `Holds` — the dictionary's values are exactly its type, each value
 *    under one key only, and they are the listed SCREAMING literals —
 *    neutral, never an avatar or a photo code;
 * 2. the answer — `MediaSystem.check` answers the tag, or `null` when the
 *    file may go up.
 *
 * `tsc` failing IS the test; nothing here runs.
 */
import { MediaRefusal } from './media-refusal.data';
import type { MediaSystem } from '@core/systems';

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

dictionary(MediaRefusal satisfies Dictionary<MediaRefusal>);

// (1) Holds — exact values, one key per value, the listed literals.
export type MediaRefusalDictionaryHolds = [
  Expect<Holds<typeof MediaRefusal, MediaRefusal>>,
  Expect<Equals<MediaRefusal, 'NOT_AN_IMAGE' | 'TOO_LARGE'>>,
  Expect<Screaming<MediaRefusal>>,
];

// (2) The answer — the tag, or null when the file may go up.
export type MediaRefusalAnswer = [
  Expect<Equals<ReturnType<typeof MediaSystem.check>, MediaRefusal | null>>,
];
