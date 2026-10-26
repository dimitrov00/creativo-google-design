import type { StoredGuardOf } from '@core/systems';

/**
 * The stored-document registry that guards NOTHING — `null` for every
 * collection, so every document reads as stored, unchecked. Test support
 * only (OR-33, DEP-F24): a mechanics spec whose partial bodies exercise an
 * adapter's SDK plumbing, not its guard, passes it explicitly — production
 * holds only `StoredDocumentSystem.guardOf`, which every guarded adapter
 * takes as a required parameter, and the root ESLint config bans the name
 * outside specs, `testing/` and `test-support/`.
 */
export const unguarded: StoredGuardOf = () => null;
