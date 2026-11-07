import { describe, expect, it } from 'vitest';
import { PipelineErrorCode } from '@core/errors';
import { AppointmentId, BarberId, MinuteCount, SeatId } from '@core/primitives';
import { type AnalyticsDay, StaffAnalyticsSystem } from '@core/systems';
import {
  FIXTURE_NOW,
  FIXTURE_NOW_UTC_MS,
  FIXTURE_TODAY,
  appointmentFixture,
  localDate,
  minute,
  seatFixture,
  termsFixture,
} from '@core/testing';
import { AnalyticsCall } from './analytics-call.data';
import { AnalyticsPeriod } from './analytics-period.data';
import type { AnalyticsReport } from './analytics-report.data';
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
    scopeBarberId,
    barberIds: scopeBarberId === null ? [ivan, niko] : [scopeBarberId],
    period: AnalyticsPeriod.monthOf(FIXTURE_TODAY),
    days: [dayOf(ivan, 540), dayOf(niko, 480)],
    aheadDays: [],
    visits: [visit],
    previousVisits: [],
    followUps: [],
    policy: ClientStatsPolicy.DEFAULT,
    now: FIXTURE_NOW,
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
    expect(AnalyticsCall.decodeReport(wire(report))).toEqual({
      ok: true,
      value: report,
    });
  });

  it('reads a shop report back, its barbers and its empty seat rows', () => {
    const report = reportOf(null);
    expect(report.reportBarbers).toHaveLength(2);
    expect(report.reportSeatRows).toEqual([]);
    expect(AnalyticsCall.decodeReport(wire(report))).toEqual({
      ok: true,
      value: report,
    });
  });

  it('accepts a cached entry: no seat rows', () => {
    const cached = { ...wire(reportOf(ivan)), reportSeatRows: [] };
    const decoded = AnalyticsCall.decodeReport(cached);
    expect(decoded.ok && decoded.value.reportSeatRows).toEqual([]);
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
      { ...good, reportAnalyticsSpan: 'YEAR' },
      { ...good, reportFromLocalDate: '2026-13-01' },
      { ...good, reportScopeBarberId: 7 },
      { ...good, reportComputedAtUtcMs: 'now' },
      { ...good, reportDefinitionVersion: 0 },
      { ...good, reportEmptiestLocalDate: undefined },
      { ...good, reportDayRows: 'none' },
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
        ...shop,
        reportBarbers: [{ ...first(shop['reportBarbers']), tipsCents: -5 }],
      },
      { ...good, reportDayRows: [null] },
    ]) {
      expect(AnalyticsCall.decodeReport(broken)).toEqual(UNUSABLE);
    }
  });
});
