/**
 * The purity contract's freezer (`ecs-systems.md` spec contract), in a file
 * of its own so the fixture modules beside it (`loyalty.fixtures.ts`) can
 * freeze what they export without importing the `testing/index.ts` barrel
 * that re-exports them. Reached through `@core/testing`; test support only.
 */

/**
 * Freezes a fixture all the way down — arrays and plain objects — and
 * returns it, so a system that writes into an input throws in strict mode
 * instead of passing. Test-only: Law 1 forbids `Object.freeze` in
 * production code.
 *
 * It ALWAYS recurses, even into a value that is already frozen: a fixture
 * shallow-frozen first (`Object.freeze(x)`) still has mutable children, and
 * an `isFrozen` short-cut would leave them so. Cycles are cut by the set of
 * objects already visited in this call.
 */
export function deepFreeze<T>(value: T): T {
  freezeAll(value, new WeakSet<object>());
  return value;
}

function freezeAll(value: unknown, seen: WeakSet<object>): void {
  if (typeof value !== 'object' || value === null || seen.has(value)) return;
  seen.add(value);
  Object.freeze(value);
  for (const inner of Object.values(value)) freezeAll(inner, seen);
}
