/**
 * Compile-time-only proof that `PersonKey` is its own brand (OR-49) — no
 * runtime `expect()`/`it()`; the spec tsconfig compiles it.
 *
 * 1. **Not the cart's seat key** — a `SeatKeyText` (`self`, `guest-…`,
 *    `companion-<uid>`) is never a `PersonKey`, and back: the two families
 *    share only the `self` spelling, never the type.
 * 2. **Not a draft key, not an account** — neither a `DraftPersonKey` nor a
 *    `UserId` stands in for a `PersonKey`, in either direction.
 * 3. **No bare string** — a raw `string` is no `PersonKey`; a `PersonKey`
 *    still reads as a `string`.
 * 4. **The way in** — every constructor answers the brand.
 *
 * `tsc` failing IS the test; nothing here runs.
 */
import type { DraftPersonKey, SeatKeyText, UserId } from './ids.primitive';
import { PersonKey } from './person-key.primitive';

type Expect<T extends true> = T;
/** Assignability, undistributed. */
type Assignable<A, B> = [A] extends [B] ? true : false;
/** Exact type equality (not mere mutual assignability). */
type Equals<X, Y> =
  (<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2
    ? true
    : false;

// (1) The cart's seat key is not a person key — either direction.
export type SeatKeyTextIsNotPersonKey = Expect<
  Equals<Assignable<SeatKeyText, PersonKey>, false>
>;
export type PersonKeyIsNotSeatKeyText = Expect<
  Equals<Assignable<PersonKey, SeatKeyText>, false>
>;

// (2) Nor a staff draft's key, nor an account id.
export type PersonKeyIsNoDraftKey = [
  Expect<Equals<Assignable<DraftPersonKey, PersonKey>, false>>,
  Expect<Equals<Assignable<PersonKey, DraftPersonKey>, false>>,
  Expect<Equals<Assignable<UserId, PersonKey>, false>>,
  Expect<Equals<Assignable<PersonKey, UserId>, false>>,
];

// (3) No bare string in; still a string out.
export type PersonKeyIsNominal = [
  Expect<Equals<Assignable<string, PersonKey>, false>>,
  Expect<Equals<Assignable<PersonKey, string>, true>>,
];

// (4) Every constructor answers the brand.
export type PersonKeyConstructors = [
  Expect<Equals<ReturnType<typeof PersonKey.self>, PersonKey>>,
  Expect<Equals<ReturnType<typeof PersonKey.account>, PersonKey>>,
  Expect<Equals<ReturnType<typeof PersonKey.guest>, PersonKey>>,
];

/** A value-level probe, so the checks above are not vacuous. */
declare const seatKey: SeatKeyText;
// @ts-expect-error — a cart seat key is no person key (OR-49)
export const crossed: PersonKey = seatKey;
