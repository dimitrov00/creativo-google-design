import {
  type Principal as PrincipalType,
  Principal,
  Roles,
} from '@core/components';
import type { BarberId, LocalDate } from '@core/primitives';

/** The query the chart button opens «Анализи» with. */
export type AnalyticsEntryQuery = {
  readonly span: 'DAY';
  readonly from: LocalDate;
  readonly barber?: BarberId;
};

/**
 * THE SCHEDULE'S WAY INTO «АНАЛИЗИ» (staff-analytics-v2, «Entry from the
 * schedule», PR 1; the `DAY` span since PR 3): the day on screen, and whose
 * figures:
 *
 * - an admin (`Roles.ANALYTICS_SHOP`) viewing ONE chair opens that barber's;
 * - an admin viewing every chair opens the shop's (no `barber`);
 * - a barber opens their own, whatever chair the book shows: the callable
 *   reads their record off the stored user, and a colleague's id in the
 *   query would be refused `ANALYTICS_FORBIDDEN`.
 *
 * `principal` is the settled one the route guard resolved; `undefined`
 * (not yet known) reads as a barber, the narrower choice.
 */
/**
 * «Анализи» FETCHED while the book is idle, so the chart button's navigation
 * lands on a chunk the device already holds and the router's transition
 * snapshots a page, not a spinner. The same dynamic module as the route's
 * `loadComponent`, so esbuild emits one chunk for both. A plain import on
 * idle rather than a `@defer (when false; prefetch on idle)` block: the
 * block would put the analytics page in the dashboard's template, and the
 * dashboard's specs render every deferred block up front — the page's own
 * ports would then have to be provided to test the schedule.
 */
export function prefetchAnalytics(): void {
  const load = (): void => {
    void import('@creativo/features/staff/analytics');
  };
  if (typeof requestIdleCallback === 'function') {
    requestIdleCallback(load);
  } else {
    setTimeout(load, 2_000);
  }
}

export function analyticsEntryQueryOf(
  principal: PrincipalType | undefined,
  scope: BarberId | null,
  day: LocalDate,
): AnalyticsEntryQuery {
  const readsShop =
    principal !== undefined &&
    Principal.hasAnyRole(principal, Roles.ANALYTICS_SHOP);
  return readsShop && scope !== null
    ? { span: 'DAY', from: day, barber: scope }
    : { span: 'DAY', from: day };
}
