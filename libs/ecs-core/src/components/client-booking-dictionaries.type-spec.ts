/**
 * Compile-time-only checks of the client-booking group's `as const` tag
 * dictionaries that pass C homed in components (pass-c-ui-decisions.md
 * D-7: `ShopCoverage` moved from the booking schedule step, the NEW
 * `SeatArrangement` and `ClientMove`) — no runtime `expect()`/`it()`; `nx
 * typecheck` runs it through `tsconfig.spec.json`.
 *
 * 1. **`satisfies`** — each dictionary's values are of its type.
 * 2. **Holds** — the type is EXACTLY the dictionary's values, and no two
 *    keys share a value.
 * 3. **SCREAMING** — every value is upper-snake.
 * 4. **N15 pair lines** (read by `tools/lint-rules/dictionary-fields
 *    .spec.mjs`) — each tag field is named `camelCase(Dictionary)`, and its
 *    type is exactly the dictionary. `SeatArrangement` is answered bare
 *    (`BookingCartSystem.arrangementOf`), with no field to pair.
 */
import type { ClientMoveAnswer, ShopCoverageAnswer } from '@core/systems';
import { ClientMove } from './client-move.data';
import { SeatArrangement } from './seat-arrangement.data';
import { ShopCoverage } from './shop-coverage.data';

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
dictionary(ShopCoverage satisfies Dictionary<ShopCoverage>);
dictionary(SeatArrangement satisfies Dictionary<SeatArrangement>);
dictionary(ClientMove satisfies Dictionary<ClientMove>);

// (2) Holds — each type is exactly its dictionary's values, one key each.
export type ClientBookingDictionariesHold = [
  Expect<Holds<typeof ShopCoverage, ShopCoverage>>, // components/shop-coverage.data.ts
  Expect<Holds<typeof SeatArrangement, SeatArrangement>>, // components/seat-arrangement.data.ts
  Expect<Holds<typeof ClientMove, ClientMove>>, // components/client-move.data.ts
];

// (3) SCREAMING values.
export type ClientBookingScreamingChecks = [
  Expect<Screaming<ShopCoverage>>,
  Expect<Screaming<SeatArrangement>>,
  Expect<Screaming<ClientMove>>,
];

// (4) N15 — a dictionary's field is camelCase(Dictionary), typed exactly by it.
export type ClientBookingDictionaryFields = [
  Expect<Equals<ShopCoverageAnswer['shopCoverage'], ShopCoverage>>, // systems/booking-cart.system.ts
  Expect<Equals<ClientMoveAnswer['clientMove'], ClientMove>>, // systems/move.system.ts
];

// The values are the ones the moved dictionary always held.
export type ClientBookingValues = [
  Expect<Equals<ShopCoverage, 'SERVED' | 'ELSEWHERE' | 'NOWHERE'>>,
  Expect<Equals<SeatArrangement, 'PARALLEL' | 'SEQUENTIAL'>>,
  Expect<Equals<ClientMove, 'MOVABLE' | 'SHOP_ONLY' | 'NONE'>>,
];
