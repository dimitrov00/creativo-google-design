import type { ObserveDayAvailabilityInput } from '@creativo/application/booking';

type Query = ObserveDayAvailabilityInput;

/**
 * One comparer per field of the query, EVERY field, optional ones included
 * (`-?`), each reading the field it is keyed by. A field added to
 * `ObserveDayAvailabilityInput` fails the type check here until it says how
 * it is compared: ignored by the comparator, a new field leaves a stale grid
 * that never re-subscribes when only that field changes.
 *
 * References suffice for the cart, the services, the policy, a move's
 * riders and its release, and the declared windows: each changes identity
 * only on a real change. The rest are values minted fresh on every
 * recompute, so they are compared by what they say.
 */
const SAME: {
  readonly [K in keyof Query]-?: (a: Query, b: Query) => boolean;
} = {
  cart: (a, b) => a.cart === b.cart,
  services: (a, b) => a.services === b.services,
  barberIds: (a, b) =>
    a.barberIds.length === b.barberIds.length &&
    a.barberIds.every((id, index) => b.barberIds.at(index)?.equals(id)),
  locationId: (a, b) =>
    (a.locationId?.value ?? null) === (b.locationId?.value ?? null),
  day: (a, b) => a.day.key() === b.day.key() && a.day.zone === b.day.zone,
  policy: (a, b) => a.policy === b.policy,
  now: (a, b) => a.now.toMillis() === b.now.toMillis(),
  maxOptions: (a, b) => a.maxOptions === b.maxOptions,
  withinMs: (a, b) => a.withinMs === b.withinMs,
  riders: (a, b) => a.riders === b.riders,
  release: (a, b) => a.release === b.release,
};

const COMPARERS: readonly ((a: Query, b: Query) => boolean)[] =
  Object.values(SAME);

/**
 * Do two day queries ask the same question?
 *
 * STRUCTURAL, not identity. The step and its time sheet build each query in
 * a computed, which mints a fresh literal on every recompute, and a stream
 * that re-subscribed on a no-op recompute re-billed that day's whole read
 * (1 + 2×barbers listeners). `null` (not ready) equals only `null`, so a
 * readiness transition always passes.
 *
 * One comparator for every day query of the flow, driven by a table that
 * must name every field of the query (`SAME`), so a field added to the
 * query can be neither compared in one stream and forgotten in the other
 * nor forgotten in both.
 */
export function sameDayQuery(a: Query | null, b: Query | null): boolean {
  if (a === null || b === null) return a === b;
  return COMPARERS.every((same) => same(a, b));
}
