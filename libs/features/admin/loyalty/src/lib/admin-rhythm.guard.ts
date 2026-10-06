import type { CanDeactivateFn } from '@angular/router';

/**
 * What the guard asks of the page it guards: `AdminRhythm` implements it
 * (client-card revision 3 §3.17). The guard names the CONTRACT and not the
 * component, so the route's guard and the page's store stand without the
 * page's file, and the page cannot drift from what the route calls.
 */
export interface AdminRhythmLeaving {
  /**
   * May the admin leave? With a draft the page asks first («Отхвърли
   * промените?») and answers what the admin chose; without one it answers
   * `true` at once.
   */
  confirmLeave(): Promise<boolean>;
}

/**
 * `/admin/loyalty/rhythm`'s `canDeactivate` (§2.6.4): leaving with a draft
 * asks first, whichever way the admin leaves (the back chip, the menu, the
 * browser's back).
 *
 * The question is the page's, because the draft is: the guard only hands
 * the router its answer. The router passes `null` for a route whose
 * component never came to be; such a route has no draft to lose, so the
 * admin is let go rather than held on a broken page.
 */
export const adminRhythmCanDeactivate: CanDeactivateFn<
  AdminRhythmLeaving | null
> = (component) => component?.confirmLeave() ?? true;
