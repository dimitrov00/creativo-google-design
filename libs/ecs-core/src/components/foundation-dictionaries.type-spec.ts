/**
 * Compile-time-only checks of the foundation's `as const` tag dictionaries
 * (flatten-spec §7, §8.1: the foundation's share of the old
 * `dictionaries.type-spec.ts`, split per group) — no runtime
 * `expect()`/`it()`; `nx typecheck` runs it through `tsconfig.spec.json`.
 *
 * 1. **`satisfies`** — each dictionary's values are of its type.
 * 2. **Holds** — the type is EXACTLY the dictionary's values, and no two
 *    keys share a value.
 * 3. **SCREAMING** — every value is upper-snake (N7/N8, §0.4).
 * 4. **N15 pair lines** (L8, read by `tools/lint-rules/dictionary-fields
 *    .spec.mjs`) — each discriminator and plain tag field is named
 *    `camelCase(Dictionary)`, and its type is exactly the dictionary;
 *    `errorCode` is the law's own field name for every error dictionary
 *    (Law 7.5), so those lines are N15-exempt.
 */
import { MoneyErrorCode, type MoneyError } from './money-errors.data';
import { RoundingMode } from './money.data';
import { PipelineErrorCode, type PipelineError } from './pipeline-errors.data';
import {
  RepositoryErrorCode,
  type RepositoryError,
} from './repository-errors.data';
import {
  DateTimeInvalidReason,
  TimeErrorCode,
  type TimeError,
} from './time-errors.data';
import { WriteAction, type WriteOp } from './write-op.data';
import {
  PrimitiveErrorCode,
  type PrimitiveError,
} from '../primitives/primitive-errors.data';

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
dictionary(WriteAction satisfies Dictionary<WriteAction>);
dictionary(RoundingMode satisfies Dictionary<RoundingMode>);
dictionary(MoneyErrorCode satisfies Dictionary<MoneyErrorCode>);
dictionary(PipelineErrorCode satisfies Dictionary<PipelineErrorCode>);
dictionary(RepositoryErrorCode satisfies Dictionary<RepositoryErrorCode>);
dictionary(TimeErrorCode satisfies Dictionary<TimeErrorCode>);
dictionary(DateTimeInvalidReason satisfies Dictionary<DateTimeInvalidReason>);
dictionary(PrimitiveErrorCode satisfies Dictionary<PrimitiveErrorCode>);

// (2) Holds — exactly the dictionary's values, one key per value.
export type FoundationDictionariesHold = [
  Expect<Holds<typeof WriteAction, WriteAction>>, // write-op.data.ts
  Expect<Holds<typeof RoundingMode, RoundingMode>>, // money.data.ts
  Expect<Holds<typeof MoneyErrorCode, MoneyErrorCode>>, // money-errors.data.ts
  Expect<Holds<typeof PipelineErrorCode, PipelineErrorCode>>, // pipeline-errors.data.ts
  Expect<Holds<typeof RepositoryErrorCode, RepositoryErrorCode>>, // repository-errors.data.ts
  Expect<Holds<typeof TimeErrorCode, TimeErrorCode>>, // time-errors.data.ts
  Expect<Holds<typeof DateTimeInvalidReason, DateTimeInvalidReason>>, // time-errors.data.ts
  Expect<Holds<typeof PrimitiveErrorCode, PrimitiveErrorCode>>, // primitive-errors.data.ts
];

// (3) SCREAMING values.
export type FoundationDictionariesScream = [
  Expect<Screaming<WriteAction>>,
  Expect<Screaming<RoundingMode>>,
  Expect<Screaming<MoneyErrorCode>>,
  Expect<Screaming<PipelineErrorCode>>,
  Expect<Screaming<RepositoryErrorCode>>,
  Expect<Screaming<TimeErrorCode>>,
  Expect<Screaming<DateTimeInvalidReason>>,
  Expect<Screaming<PrimitiveErrorCode>>,
];

// (4) N15 pair lines.
export type FoundationDictionaryFields = [
  Expect<Equals<WriteOp['writeAction'], WriteAction>>, // write-op.data.ts
  Expect<
    Equals<
      TimeError.InvalidDateTime['dateTimeInvalidReason'],
      DateTimeInvalidReason
    >
  >, // time-errors.data.ts
  Expect<Equals<TimeError['errorCode'], TimeErrorCode>>, // N15-exempt: `errorCode` is the law's error field (Law 7.5)
  Expect<Equals<MoneyError['errorCode'], MoneyErrorCode>>, // N15-exempt: `errorCode` is the law's error field (Law 7.5)
  Expect<Equals<PipelineError['errorCode'], PipelineErrorCode>>, // N15-exempt: `errorCode` is the law's error field (Law 7.5)
  Expect<Equals<RepositoryError['errorCode'], RepositoryErrorCode>>, // N15-exempt: `errorCode` is the law's error field (Law 7.5)
  Expect<Equals<PrimitiveError['errorCode'], PrimitiveErrorCode>>, // N15-exempt: `errorCode` is the law's error field (Law 7.5)
];
