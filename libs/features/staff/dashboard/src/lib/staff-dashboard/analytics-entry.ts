import { Injectable, computed, effect, inject } from '@angular/core';
import { Router } from '@angular/router';
import { RouteCapabilities } from '@core/components';
import {
  AccessScope,
  type BarberId,
  type LocalDate,
  StaffCapability,
} from '@core/primitives';
import { EmploymentReminderSystem } from '@core/systems';
import { StaffAccessService } from '@creativo/features/client/account-state';
import { TeamCatalogService } from '@creativo/features/shared/catalog';
import { StaffDayStore } from '../staff-day.store';

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
 * - a reader of the shop's (the `ANALYTICS` capability at "everyone": the
 *   admin, and any level the owner has given it) viewing ONE chair opens
 *   that barber's;
 * - the same reader viewing every chair opens the shop's (no `barber`);
 * - a reader of their own opens their own, whatever chair the book shows:
 *   the callable reads their record off the stored user, and a colleague's
 *   id in the query would be refused `ACCESS_OWN_ONLY`.
 *
 * `readsShop` is `StaffAccessService`'s answer; while the cells have not
 * answered it is `false`, the narrower choice.
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
  readsShop: boolean,
  scope: BarberId | null,
  day: LocalDate,
): AnalyticsEntryQuery {
  return readsShop && scope !== null
    ? { span: 'DAY', from: day, barber: scope }
    : { span: 'DAY', from: day };
}

/**
 * THE SCHEDULE'S CHART BUTTON (staff permissions P8): whether it is there,
 * where it leads, and what waits behind it. It follows the `ANALYTICS`
 * capability, as the route's gate and the callable do: nobody hides it,
 * everyone opens the chair on screen, own opens the person's own. The
 * page's chunk is fetched ahead once the person is known to read
 * analytics, and never for a session the button is hidden from.
 *
 * Since the owner's ruling of 2026-11-25 (Q2) it is the shop's view: it
 * carries its word from 600px of bar, and a badge counting the decisions
 * «Анализи» opens with (`pending`).
 */
@Injectable()
export class AnalyticsEntry {
  private readonly access = inject(StaffAccessService);
  private readonly router = inject(Router);
  private readonly team = inject(TeamCatalogService);
  private readonly day = inject(StaffDayStore);

  private readonly scope = computed(() =>
    this.access.scopeOf(StaffCapability.Analytics),
  );

  /** The route would let the person in: the chart button is there. */
  readonly reads = computed(() =>
    this.access.opens(RouteCapabilities.Analytics),
  );

  /**
   * How many decisions «Анализи» opens with — the team's last days
   * (`EmploymentReminderSystem.remindersOf`), for whoever may extend them, exactly
   * as `lib-analytics-reminders` lists them on the page: the badge on the
   * chart button. From the team stream the schedule already holds; 0
   * until it and the shop's today are known, and for anyone else.
   */
  readonly pending = computed(() => {
    const today = this.day.todayKey();
    if (
      today === null ||
      !this.reads() ||
      !this.team.teamKnown() ||
      this.access.scopeOf(StaffCapability.TeamManage) === AccessScope.None
    ) {
      return 0;
    }
    return EmploymentReminderSystem.remindersOf(this.team.teamBarbers(), today)
      .length;
  });

  private prefetched = false;

  constructor() {
    effect(() => {
      if (this.prefetched || !this.reads()) return;
      this.prefetched = true;
      prefetchAnalytics();
    });
  }

  /**
   * Opens «Анализи» on `day`, for the chair the book shows (`chair`: every
   * chair when `null`). No day before the shop's zone is known: nothing to
   * open on.
   */
  open(chair: BarberId | null, day: LocalDate | null): void {
    if (day === null) return;
    void this.router.navigate(['/staff/analytics'], {
      queryParams: analyticsEntryQueryOf(
        this.scope() === AccessScope.All,
        chair,
        day,
      ),
    });
  }
}
