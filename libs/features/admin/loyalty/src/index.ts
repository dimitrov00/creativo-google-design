/**
 * `@creativo/features/admin/loyalty`: the admin's loyalty rules. Its first
 * page is «Ритъм» (`/admin/loyalty/rhythm`), where the rhythm rule is managed.
 *
 * What this barrel exports, and nothing else (design record:
 * `docs/design-research/client-card-revision-3.md` §3.17):
 *
 * - `AdminRhythm` (`lib-admin-rhythm`), the routed page;
 * - `adminRhythmCanDeactivate`, the route's guard over the page's draft
 *   (and `AdminRhythmLeaving`, the contract it names).
 *
 * The store, the preview and the sheets stay private to the lib: the page
 * provides and mounts them.
 */
export { AdminRhythm } from './lib/admin-rhythm/admin-rhythm';
export {
  type AdminRhythmLeaving,
  adminRhythmCanDeactivate,
} from './lib/admin-rhythm.guard';
