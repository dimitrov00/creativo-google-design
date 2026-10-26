import type { ReadGuard } from '../lib/observe';

/**
 * No guard, no report — the shared reads' registry that guards NOTHING,
 * every document read as stored, unchecked. Test support only (OR-33,
 * DEP-F24): a mechanics spec whose partial bodies exercise an adapter's
 * SDK plumbing, not its guard, passes it explicitly; production binds
 * `guardedReads` (the composition root's), and the root ESLint config bans
 * the name outside specs, `testing/` and `test-support/`. The web twin of
 * `@core/testing`'s `unguarded`, restated rather than imported: this lib's
 * lint lets only a spec import a testing entry point.
 */
export const UNGUARDED: ReadGuard = {
  guardOf: () => null,
  log: () => undefined,
};
