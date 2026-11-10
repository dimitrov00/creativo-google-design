import { describe, expect, it } from 'vitest';
import { PipelineErrorCode } from '@core/errors';
import {
  AppointmentId,
  BarberId,
  LocationId,
  MinuteCount,
  type PriceCents,
  SeatId,
} from '@core/primitives';
import { MinuteRange } from './minute-range.data';
import {
  AnalyticsCarouselSystem,
  type AnalyticsDay,
  StaffAnalyticsSystem,
} from '@core/systems';
import {
  FIXTURE_NOW,
  FIXTURE_NOW_UTC_MS,
  FIXTURE_TODAY,
  appointmentFixture,
  endMinute,
  localDate,
  minute,
  seatFixture,
  shopReportFixture,
  termsFixture,
} from '@core/testing';
import { AnalyticsCall } from './analytics-call.data';
import { AnalyticsComparison, AnalyticsPeriod } from './analytics-period.data';
import {
  type AnalyticsReport,
  GoalPaceTag,
  RadarBase,
} from './analytics-report.data';
import { ClientStatsPolicy } from './client-stats-policy.data';
import { Seat } from './seat.data';
import { SeatOutcome } from './seat-outcome.data';

const ivan = BarberId.of('ivan');
const niko = BarberId.of('niko');
const zero = MinuteCount.ZERO;

function dayOf(barberId: BarberId, rostered: number): AnalyticsDay {
  return {
    barberId,
    localDate: localDate('2026-09-14'),
    rosteredMinutes: rostered as MinuteCount,
    workedMinutes: 30 as MinuteCount,
    noShowMinutes: zero,
    unmarkedMinutes: zero,
    bookedAheadMinutes: zero,
    heldMinutes: zero,
    blockedMinutes: zero,
    breakMinutes: zero,
    shortGapMinutes: zero,
    unsoldMinutes: (rostered - 30) as MinuteCount,
    openMinutes: zero,
    pastBlockedMinutes: zero,
    pastHeldMinutes: zero,
    pastShortGapMinutes: zero,
    outsideHoursMinutes: zero,
    outsideHoursSeatCount: 0,
    closedDayMinutes: zero,
    locationIds: [],
    // 09:00 on, for `rostered` minutes — the hour grid's stretch.
    stretches: [MinuteRange.of(minute(540), endMinute(540 + rostered))],
    pastDay: true,
  };
}

/** A report with every row kind: the barber scope's seat rows, or the shop's barbers. */
function reportOf(scopeBarberId: BarberId | null): AnalyticsReport {
  const seats = [ivan, niko].map((barberId, i) =>
    seatFixture({
      seatId: SeatId.of(`s-${i}`),
      barberId,
      startMinutes: minute(600),
      tipCents: 200 as Seat['tipCents'],
      terms: Seat.termsOf(termsFixture(2500, 30), null),
      outcome: SeatOutcome.worked(FIXTURE_NOW_UTC_MS),
    }),
  );
  const visit = appointmentFixture({
    id: AppointmentId.of('a-1'),
    localDate: localDate('2026-09-14'),
    seats,
  });
  return StaffAnalyticsSystem.report({
    scopeBarberIds: scopeBarberId === null ? [] : [scopeBarberId],
    scopeLocationIds: [],
    barberIds: scopeBarberId === null ? [ivan, niko] : [scopeBarberId],
    period: AnalyticsPeriod.monthOf(FIXTURE_TODAY),
    analyticsComparison: AnalyticsComparison.Previous,
    days: [dayOf(ivan, 540), dayOf(niko, 480)],
    pastDays: [],
    aheadDays: [],
    visits: [visit],
    previousVisits: [],
    previousPastDays: [],
    followUps: [],
    firstSeen: [],
    policy: ClientStatsPolicy.DEFAULT,
    now: FIXTURE_NOW,
    goal: null,
    locationFigures: [],
  });
}

/** The report as the wire carries it — plain JSON. */
function wire(report: AnalyticsReport): Record<string, unknown> {
  return JSON.parse(JSON.stringify(report)) as Record<string, unknown>;
}

const UNUSABLE = {
  ok: false,
  error: expect.objectContaining({ errorCode: PipelineErrorCode.Unknown }),
};

describe('AnalyticsCall.decodeReport — the staffAnalytics answer', () => {
  it('reads a barber report back as it was sent, every row kind included', () => {
    const report = reportOf(ivan);
    expect(report.reportSeatRows.length).toBeGreaterThan(0);
    expect(report.reportServices.length).toBeGreaterThan(0);
    expect(report.reportWeekdayFill.length).toBeGreaterThan(0);
    expect(report.reportOrigins.length).toBeGreaterThan(0);
    expect(report.reportDayRows.length).toBeGreaterThan(0);
    expect(report.reportSeries.length).toBeGreaterThan(0);
    expect(report.reportTimeSeries.length).toBeGreaterThan(0);
    expect(report.reportHourGrid.length).toBeGreaterThan(0);
    expect(report.reportAheadDays).toHaveLength(7);
    expect(AnalyticsCall.decodeReport(wire(report))).toEqual({
      ok: true,
      value: report,
    });
  });

  it('reads a shop report back, its barbers, its radars and its empty seat rows', () => {
    const report = reportOf(null);
    expect(report.reportBarbers).toHaveLength(2);
    expect(report.reportSeatRows).toEqual([]);
    // Two barbers of one seat each: a radar row apiece, every axis under its floor.
    expect(report.reportRadarBase).toBe(RadarBase.BestOfShop);
    expect(report.reportRadars.map((row) => row.barberId)).toEqual([
      ivan,
      niko,
    ]);
    expect(report.reportRadars[0]?.takingsPerHour).toBeNull();
    expect(AnalyticsCall.decodeReport(wire(report))).toEqual({
      ok: true,
      value: report,
    });
  });

  it('reads the shop’s locations back — each one’s row from its own report — and refuses a malformed one', () => {
    const shop = reportOf(null);
    const centre = AnalyticsCarouselSystem.locationFiguresOf(
      LocationId.of('loc-center'),
      shop,
    );
    const report = { ...shop, reportLocations: [centre, centre] };
    expect(centre.seriesCents).toHaveLength(shop.reportSeries.length);
    expect(centre.servedCount).toBe(AnalyticsCarouselSystem.servedOf(shop));
    expect(AnalyticsCall.decodeReport(wire(report))).toEqual({
      ok: true,
      value: report,
    });
    const broken = wire(report);
    broken['reportLocations'] = [{ ...centre, seriesCents: [-1] }];
    expect(AnalyticsCall.decodeReport(broken)).toEqual(UNUSABLE);
    const missing = wire(shop);
    delete missing['reportLocations'];
    expect(AnalyticsCall.decodeReport(missing)).toEqual(UNUSABLE);
  });

  it('reads the radars with values, the comparison barbers and the barber figures’ new fields back (v2 PR 5)', () => {
    const report = shopReportFixture();
    expect(report.reportRadars).toHaveLength(2);
    expect(report.reportComparisonBarbers).toHaveLength(1);
    expect(report.reportRadars[0]?.takingsPerHour).toBe(100);
    // A comparison axis on this period's base may pass 100; a null axis stays null.
    expect(report.reportRadars[1]?.comparisonFill).toBeNull();
    const wired = wire({
      ...report,
      reportRadars: [
        {
          ...(report.reportRadars[0] as AnalyticsReport.RadarRow),
          comparisonFill: 112.5,
        },
        report.reportRadars[1] as AnalyticsReport.RadarRow,
      ],
    });
    const decoded = AnalyticsCall.decodeReport(wired);
    expect(decoded.ok && decoded.value.reportRadars[0]?.comparisonFill).toBe(
      112.5,
    );
    expect(decoded.ok && decoded.value.reportBarbers).toEqual(
      report.reportBarbers,
    );
    expect(decoded.ok && decoded.value.reportComparisonBarbers).toEqual(
      report.reportComparisonBarbers,
    );
    expect(decoded.ok && decoded.value.reportRadarBase).toBe(
      RadarBase.BestOfShop,
    );
    expect(report.reportBarbers[0]).toMatchObject({
      serviceMinutes: 240,
      workedSeatCount: 24,
      rosteredDayCount: 8,
    });
  });

  it('reads the month goal’s fields back (v2 PR 6): the range, the pace and the two day counts, and their absence', () => {
    const report = reportOf(ivan);
    expect(report).toMatchObject({
      reportGoalLowCents: null,
      reportGoalHighCents: null,
      reportGoalPaceTag: GoalPaceTag.None,
    });
    const withGoal = wire({
      ...report,
      reportGoalLowCents: 180_000 as PriceCents,
      reportGoalHighCents: 220_000 as PriceCents,
      reportGoalPaceTag: GoalPaceTag.OnTrack,
      reportGoalDaysSoFar: 12,
      reportGoalDaysInMonth: 22,
    });
    const decoded = AnalyticsCall.decodeReport(withGoal);
    expect(decoded.ok && decoded.value).toMatchObject({
      reportGoalLowCents: 180_000,
      reportGoalHighCents: 220_000,
      reportGoalPaceTag: GoalPaceTag.OnTrack,
      reportGoalDaysSoFar: 12,
      reportGoalDaysInMonth: 22,
    });
  });

  it('reads a barber report’s empty radar: no rows, no comparison barbers, the base TOO_FEW_BARBERS', () => {
    const decoded = AnalyticsCall.decodeReport(wire(reportOf(ivan)));
    expect(decoded.ok && decoded.value).toMatchObject({
      reportComparisonBarbers: [],
      reportRadars: [],
      reportRadarBase: RadarBase.TooFewBarbers,
    });
  });

  it('accepts a cached entry: no seat rows', () => {
    const cached = { ...wire(reportOf(ivan)), reportSeatRows: [] };
    const decoded = AnalyticsCall.decodeReport(cached);
    expect(decoded.ok && decoded.value.reportSeatRows).toEqual([]);
  });

  it('reads the peaks when the report names them, and their absence', () => {
    const named = {
      ...wire(reportOf(ivan)),
      reportBusiestWeekday: 2,
      reportBusiestHour: 10,
      reportEmptiestWeekday: 5,
      reportEmptiestHour: 0,
    };
    const decoded = AnalyticsCall.decodeReport(named);
    expect(decoded.ok && decoded.value).toMatchObject({
      reportBusiestWeekday: 2,
      reportBusiestHour: 10,
      reportEmptiestWeekday: 5,
      reportEmptiestHour: 0,
    });
    const unnamed = AnalyticsCall.decodeReport(wire(reportOf(ivan)));
    expect(unnamed.ok && unnamed.value).toMatchObject({
      reportBusiestWeekday: null,
      reportBusiestHour: null,
    });
  });

  it('reads a report that is not comparable: its comparison range and hero previous null', () => {
    const report = reportOf(ivan);
    expect(report.reportComparisonFromLocalDate).toBe('2026-08-01');
    expect(report.reportComparisonToLocalDate).toBe('2026-08-31');
    const uncomparable = {
      ...wire(report),
      reportComparisonFromLocalDate: null,
      reportComparisonToLocalDate: null,
      reportHeroPreviousCents: null,
    };
    const decoded = AnalyticsCall.decodeReport(uncomparable);
    expect(decoded.ok && decoded.value).toMatchObject({
      reportAnalyticsComparison: AnalyticsComparison.Previous,
      reportComparisonFromLocalDate: null,
      reportComparisonToLocalDate: null,
      reportHeroPreviousCents: null,
    });
  });

  it('refuses an answer that is no object', () => {
    for (const raw of [null, 'report', 42, []]) {
      expect(AnalyticsCall.decodeReport(raw)).toEqual(UNUSABLE);
    }
  });

  it('refuses a missing or malformed root field', () => {
    const good = wire(reportOf(ivan));
    for (const broken of [
      { ...good, reportTakingsCents: undefined },
      { ...good, reportTakingsCents: -1 },
      { ...good, reportWorkedMinutes: 1.5 },
      { ...good, reportNoShowRate: 1.2 },
      { ...good, reportAnalyticsSpan: 'QUARTER' },
      { ...good, reportAnalyticsComparison: 'YEARLY' },
      // v2 PR 4b: the missing-days count, absent (a PR 4a cached entry) or malformed.
      { ...good, reportMissingDays: undefined },
      { ...good, reportMissingDays: -1 },
      { ...good, reportMissingDays: 1.5 },
      { ...good, reportAnalyticsComparison: undefined },
      { ...good, reportComparisonFromLocalDate: undefined },
      { ...good, reportComparisonToLocalDate: '2026-13-01' },
      { ...good, reportFromLocalDate: '2026-13-01' },
      { ...good, reportScopeBarberId: 7 },
      { ...good, reportComputedAtUtcMs: 'now' },
      { ...good, reportDefinitionVersion: 0 },
      { ...good, reportEmptiestLocalDate: undefined },
      { ...good, reportDayRows: 'none' },
      // v2's chart fields: absent (a v1 cached entry), or malformed.
      { ...good, reportSeries: undefined },
      { ...good, reportTimeSeries: undefined },
      { ...good, reportHourGrid: undefined },
      { ...good, reportAheadDays: undefined },
      { ...good, reportBusiestWeekday: undefined },
      { ...good, reportBusiestWeekday: 0 },
      { ...good, reportBusiestHour: 24 },
      { ...good, reportEmptiestWeekday: '2' },
      { ...good, reportEmptiestHour: 9.5 },
      // v2 PR 5: the radar fields, absent (a PR 4b cached entry) or malformed.
      { ...good, reportComparisonBarbers: undefined },
      { ...good, reportRadars: undefined },
      { ...good, reportRadarBase: undefined },
      { ...good, reportRadarBase: 'BEST_OF_SELF' },
      // v2 PR 6: the goal fields, absent (a PR 5 cached entry) or malformed.
      { ...good, reportGoalPaceTag: undefined },
      { ...good, reportGoalPaceTag: 'BEHIND_SCHEDULE' },
      { ...good, reportGoalLowCents: undefined },
      { ...good, reportGoalLowCents: -1 },
      { ...good, reportGoalHighCents: 1.5 },
      { ...good, reportGoalDaysSoFar: undefined },
      { ...good, reportGoalDaysSoFar: -1 },
      { ...good, reportGoalDaysInMonth: 2.5 },
    ]) {
      expect(AnalyticsCall.decodeReport(broken)).toEqual(UNUSABLE);
    }
  });

  it('refuses a malformed row of any list', () => {
    const good = wire(reportOf(ivan));
    const shop = wire(reportOf(null));
    const first = (list: unknown) => (list as Record<string, unknown>[])[0];
    for (const broken of [
      {
        ...good,
        reportSeatRows: [{ ...first(good['reportSeatRows']), seatId: '' }],
      },
      {
        ...good,
        reportSeatRows: [
          { ...first(good['reportSeatRows']), attendanceState: 'GONE' },
        ],
      },
      {
        ...good,
        reportServices: [{ ...first(good['reportServices']), serviceId: 3 }],
      },
      {
        ...good,
        reportWeekdayFill: [
          { ...first(good['reportWeekdayFill']), weekday: 8 },
        ],
      },
      {
        ...good,
        reportOrigins: [
          { ...first(good['reportOrigins']), bookingOrigin: 'PHONE' },
        ],
      },
      {
        ...good,
        reportDayRows: [{ ...first(good['reportDayRows']), barberId: null }],
      },
      {
        ...good,
        reportSeries: [
          { ...first(good['reportSeries']), comparisonTakingsCents: -1 },
        ],
      },
      {
        ...good,
        reportSeries: [{ ...first(good['reportSeries']), localDate: 'today' }],
      },
      {
        ...good,
        reportTimeSeries: [
          { ...first(good['reportTimeSeries']), otherMinutes: undefined },
        ],
      },
      {
        ...good,
        reportHourGrid: [{ ...first(good['reportHourGrid']), hour: 24 }],
      },
      {
        ...good,
        reportHourGrid: [{ ...first(good['reportHourGrid']), weekday: 8 }],
      },
      {
        ...good,
        reportAheadDays: [
          { ...first(good['reportAheadDays']), openMinutes: -5 },
        ],
      },
      {
        ...shop,
        reportBarbers: [{ ...first(shop['reportBarbers']), tipsCents: -5 }],
      },
      // v2 PR 5: the barber figures' new fields, the comparison barbers, the radar rows.
      {
        ...shop,
        reportBarbers: [
          { ...first(shop['reportBarbers']), serviceMinutes: undefined },
        ],
      },
      {
        ...shop,
        reportBarbers: [
          { ...first(shop['reportBarbers']), workedSeatCount: -1 },
        ],
      },
      {
        ...shop,
        reportBarbers: [
          { ...first(shop['reportBarbers']), rosteredDayCount: 1.5 },
        ],
      },
      {
        ...shop,
        reportComparisonBarbers: [
          { ...first(shop['reportBarbers']), barberId: 3 },
        ],
      },
      {
        ...shop,
        reportRadars: [{ ...first(shop['reportRadars']), barberId: '' }],
      },
      {
        ...shop,
        reportRadars: [{ ...first(shop['reportRadars']), fill: -1 }],
      },
      {
        ...shop,
        reportRadars: [
          {
            ...first(shop['reportRadars']),
            comparisonAverageTicket: undefined,
          },
        ],
      },
      {
        ...shop,
        reportRadars: [
          { ...first(shop['reportRadars']), averageTicket: 'high' },
        ],
      },
      { ...good, reportDayRows: [null] },
    ]) {
      expect(AnalyticsCall.decodeReport(broken)).toEqual(UNUSABLE);
    }
  });
});
