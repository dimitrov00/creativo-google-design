import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { afterEach, describe, expect, it } from 'vitest';
import {
  AnalyticsComparison,
  AnalyticsPeriod,
  AnalyticsSpan,
  type AnalyticsReport,
} from '@core/components';
import { type BarberId, BusyKey, Result } from '@core/primitives';
import { staffAnalytics } from '@core/pipelines';
import { GridLayoutSystem } from '@core/systems';
import {
  ANALYTICS_FIXTURE_BARBERS,
  ANALYTICS_FIXTURE_DEPARTURES,
  ANALYTICS_FIXTURE_LOCATIONS,
  ANALYTICS_FIXTURE_MONTH,
  ANALYTICS_FIXTURE_ROSTERS,
  ANALYTICS_FIXTURE_SHOPS,
  ANALYTICS_FIXTURE_USERS,
  ANALYTICS_FIXTURE_VISITS,
  analyticsFixtureBusyDays,
  analyticsFixturePorts,
  barberFixture,
  unwrapOk,
} from '@core/testing';
import {
  buildStaffDayStore,
  settleStaffDayStore,
} from './staff-day-store.spec-support';

/*
 * G5, THROUGH THE SCHEDULE'S OWN PATH (docs/designs/staff-analytics.md,
 * plan item 49): `StaffDayStore` over the analytics fixture month — its
 * roster, departures, busy projection and visits through the in-memory
 * ports — and, for every barber-day of September, the lane's free minutes
 * (`GridLayoutSystem.totalMinutes` over `lane.gaps`, the gaps `dayCells`
 * cut with `sellableAt`) equal the staffAnalytics report's unsold + open.
 * The dashboard's `daySummary` sums the lane's gap rows, and `gapRowVm`
 * carries each gap's `minutes` as they are, so the lane's sum IS the
 * summary at one chair. Ecs-core's agreement spec reproduces this chain
 * without Angular; this one runs it.
 */

const { ivan, niko, maria } = ANALYTICS_FIXTURE_BARBERS;
const BARBERS: readonly BarberId[] = [ivan, niko, maria];
const USER_OF = new Map<BarberId, (typeof ANALYTICS_FIXTURE_USERS)['ivan']>([
  [ivan, ANALYTICS_FIXTURE_USERS.ivan],
  [niko, ANALYTICS_FIXTURE_USERS.niko],
  [maria, ANALYTICS_FIXTURE_USERS.maria],
]);

async function reportOf(barberId: BarberId): Promise<AnalyticsReport> {
  const caller = USER_OF.get(barberId);
  if (caller === undefined) throw new Error(`no account for ${barberId}`);
  return unwrapOk(
    await staffAnalytics(analyticsFixturePorts())({
      callerUserId: caller.id,
      scopeBarberId: barberId,
      analyticsSpan: AnalyticsSpan.Month,
      fromLocalDate: ANALYTICS_FIXTURE_MONTH,
      toLocalDate: null,
      analyticsComparison: AnalyticsComparison.Previous,
    }),
  );
}

afterEach(() => {
  TestBed.resetTestingModule();
  localStorage.clear();
});

describe('G5 — the schedule’s day-summary free time is the report’s unsold + open', () => {
  it('agrees on every barber-day of the fixture month, read through StaffDayStore', async () => {
    const expected = new Map<string, number>();
    // The same figure through the v2 chart series (staff-analytics-v2 PR 2,
    // plan item 38): a barber's month is one time point per day, whose
    // `unsoldMinutes` is the day row's, so unsold (the series) + open (the
    // row) is the same free time.
    const viaSeries = new Map<string, number>();
    for (const barberId of BARBERS) {
      const report = await reportOf(barberId);
      const openByDay = new Map<string, number>();
      for (const row of report.reportDayRows) {
        expected.set(
          BusyKey.of(barberId, row.localDate),
          row.dayUnsoldMinutes + row.dayOpenMinutes,
        );
        openByDay.set(row.localDate, row.dayOpenMinutes);
      }
      expect(report.reportTimeSeries).toHaveLength(report.reportDayRows.length);
      for (const point of report.reportTimeSeries) {
        viaSeries.set(
          BusyKey.of(barberId, point.localDate),
          point.unsoldMinutes + (openByDay.get(point.localDate) ?? 0),
        );
      }
    }
    expect(expected.size).toBe(90);
    expect(viaSeries).toEqual(expected);

    const { store } = await buildStaffDayStore({
      nowIso: '2026-09-28T09:00:00.000+03:00',
      shops: ANALYTICS_FIXTURE_LOCATIONS,
      barbers: [
        barberFixture({
          id: ivan,
          locationIds: [
            ANALYTICS_FIXTURE_SHOPS.centre,
            ANALYTICS_FIXTURE_SHOPS.mladost,
          ],
        }),
        barberFixture({
          id: niko,
          handle: 'niko',
          locationIds: [ANALYTICS_FIXTURE_SHOPS.mladost],
          sortOrder: 1,
        }),
        barberFixture({
          id: maria,
          handle: 'maria',
          locationIds: [
            ANALYTICS_FIXTURE_SHOPS.centre,
            ANALYTICS_FIXTURE_SHOPS.old,
          ],
          sortOrder: 2,
        }),
      ],
      schedules: ANALYTICS_FIXTURE_ROSTERS,
      exceptions: ANALYTICS_FIXTURE_DEPARTURES,
      busyDays: analyticsFixtureBusyDays(),
      barberDay: (key) =>
        of(
          Result.ok({
            appointments: ANALYTICS_FIXTURE_VISITS.filter((visit) =>
              visit.busyKeys.includes(key),
            ),
            unreadableCount: 0,
          }),
        ),
    });

    const period = unwrapOk(
      AnalyticsPeriod.of(AnalyticsSpan.Month, ANALYTICS_FIXTURE_MONTH, null),
    );
    const seen = new Map<string, number>();
    for (const day of AnalyticsPeriod.days(period)) {
      store.applyRouteDay(day);
      await settleStaffDayStore();
      expect(store.dayKey()).toBe(day);
      expect(store.settled()).toBe(true);
      const lanes = store.lanes();
      expect(lanes.map((lane) => lane.barberId).sort()).toEqual(
        [...BARBERS].sort(),
      );
      for (const lane of lanes) {
        expect(lane.failed).toBe(false);
        seen.set(
          BusyKey.of(lane.barberId, day),
          GridLayoutSystem.totalMinutes(lane.gaps),
        );
      }
    }
    expect(seen).toEqual(expected);
    expect([...seen.values()].some((free) => free > 0)).toBe(true);
  });
});
