import { describe, expect, it } from 'vitest';
import {
  AnalyticsComparison,
  AnalyticsSpan,
  BookingPolicy,
  Role,
  Seat,
  SeatOutcome,
} from '@core/components';
import {
  AnalyticsErrorCode,
  RepositoryError,
  RepositoryErrorCode,
} from '@core/errors';
import type { Appointment } from '@core/entities';
import {
  AppointmentId,
  BarberId,
  BusyKey,
  LocalDate,
  LogEvent,
  Result,
  ScheduleExceptionId,
  SeatId,
  UserId,
  UtcEpochMs,
} from '@core/primitives';
import { ZonedTimeSystem } from '@core/systems';
import {
  FIXTURE_IDS,
  FIXTURE_NOW_UTC_MS,
  FIXTURE_TIME_ZONE,
  appointmentFixture,
  barberScheduleFixture,
  blockedUserFixture,
  localDate,
  locationFixture,
  memoryAnalyticsReadPorts,
  memoryClockPorts,
  memoryDefaultLocationPorts,
  memoryProfileLoadPorts,
  memoryShopDayReadPorts,
  minute,
  recordingTelemetry,
  registeredUserFixture,
  scheduleExceptionFixture,
  seatFixture,
  termsFixture,
  unwrapErr,
  unwrapOk,
} from '@core/testing';
import {
  type StaffAnalyticsCommand,
  type StaffAnalyticsPorts,
  staffAnalytics,
} from './staff-analytics.pipeline';

/* The clock: Monday 28 September 2026, 09:00 in Sofia (FIXTURE_NOW). The
 * period: September 2026 — the 1st to the 30th, running; the previous one
 * August. Two barbers, Ivan and Niko, both rostered Mon–Fri 09:00–18:00 at
 * the one shop. */

const IVAN = FIXTURE_IDS.barber;
const NIKO = BarberId.of('b-niko');
const SEPTEMBER = localDate('2026-09-01');
const stamp = FIXTURE_NOW_UTC_MS;

const ADMIN = registeredUserFixture({
  id: UserId.of('u-admin'),
  roles: [Role.Admin],
});
const ADMIN_BARBER = registeredUserFixture({
  id: UserId.of('u-owner'),
  roles: [Role.Admin, Role.Barber],
  linkedBarberId: NIKO,
});
const IVAN_USER = registeredUserFixture({
  id: UserId.of('u-ivan'),
  roles: [Role.Barber],
  linkedBarberId: IVAN,
});
const UNLINKED = registeredUserFixture({
  id: UserId.of('u-new-barber'),
  roles: [Role.Barber],
});
const BLOCKED = blockedUserFixture({
  id: UserId.of('u-blocked'),
  roles: [Role.Barber],
  linkedBarberId: IVAN,
});
const RECEPTIONIST = registeredUserFixture({
  id: UserId.of('u-desk'),
  roles: [Role.Receptionist],
});
const SYSADMIN = registeredUserFixture({
  id: UserId.of('u-support'),
  roles: [Role.Sysadmin],
});
const USERS = [
  ADMIN,
  ADMIN_BARBER,
  IVAN_USER,
  UNLINKED,
  BLOCKED,
  RECEPTIONIST,
  SYSADMIN,
];

let seatSeq = 0;
function workedSeat(barberId: BarberId, priceCents: number, hour = 10): Seat {
  return seatFixture({
    seatId: SeatId.of(`s-${++seatSeq}`),
    barberId,
    startMinutes: minute(hour * 60),
    terms: Seat.termsOf(termsFixture(priceCents, 30, 0, 0), null),
    outcome: SeatOutcome.worked(stamp),
  });
}

/** A visit on `day` with its seats, its barber list and busy keys derived from them. */
function visitOn(
  id: string,
  day: LocalDate,
  seats: readonly Seat[],
  extra: Partial<Appointment> = {},
): Appointment {
  const barbers = [...new Set(seats.map((seat) => seat.barberId))];
  const first = seats[0] as Seat;
  return appointmentFixture({
    id: AppointmentId.of(id),
    localDate: day,
    startMinutes: first.startMinutes,
    endMinutes: Seat.endMinutes(first),
    utcEpochMs: unwrapOk(
      ZonedTimeSystem.toUtc(day, first.startMinutes, FIXTURE_TIME_ZONE),
    ),
    seats,
    barberIds: barbers,
    busyKeys: barbers.map((barber) => BusyKey.of(barber, day)),
    ...extra,
  });
}

/** Ivan alone on Monday the 14th, 20,00 €. */
const SOLO = visitOn('v-solo', localDate('2026-09-14'), [
  workedSeat(IVAN, 2000),
]);
/** A party of two on Tuesday the 15th: Ivan 25,00 €, Niko 30,00 € — one visit, two barbers' keys. */
const PARTY = visitOn('v-party', localDate('2026-09-15'), [
  workedSeat(IVAN, 2500, 11),
  workedSeat(NIKO, 3000, 11),
]);
/** Booked from the solo visit the same day — a rebooking. */
const FOLLOW_UP = visitOn(
  'v-follow-up',
  localDate('2026-10-12'),
  [
    seatFixture({
      seatId: SeatId.of('s-follow'),
      barberId: IVAN,
      startMinutes: minute(600),
    }),
  ],
  {
    bookedFromAppointmentId: SOLO.id,
    bookedAtUtcMs: unwrapOk(
      ZonedTimeSystem.toUtc(
        localDate('2026-09-14'),
        minute(11 * 60),
        FIXTURE_TIME_ZONE,
      ),
    ),
  },
);

type World = {
  readonly ports: StaffAnalyticsPorts;
  readonly reads: ReturnType<typeof memoryAnalyticsReadPorts>['log'];
  readonly lines: ReturnType<typeof recordingTelemetry>['lines'];
};

function world(overrides: Partial<StaffAnalyticsPorts> = {}): World {
  const analytics = memoryAnalyticsReadPorts({
    visits: [SOLO, PARTY, FOLLOW_UP],
    departures: [],
    barberIds: [NIKO, IVAN],
    locations: [locationFixture()],
  });
  const telemetry = recordingTelemetry();
  return {
    ports: {
      ...analytics.ports,
      ...memoryProfileLoadPorts(USERS),
      ...memoryShopDayReadPorts([
        barberScheduleFixture({ id: IVAN }),
        barberScheduleFixture({ id: NIKO }),
      ]),
      loadPolicy: async () => Result.ok(BookingPolicy.DEFAULT),
      ...memoryDefaultLocationPorts(FIXTURE_IDS.location),
      ...memoryClockPorts(),
      log: telemetry.log,
      ...overrides,
    },
    reads: analytics.log,
    lines: telemetry.lines,
  };
}

function ask(
  caller: UserId,
  scopeBarberId: BarberId | null,
  fromLocalDate: LocalDate = SEPTEMBER,
  analyticsSpan: AnalyticsSpan = AnalyticsSpan.Month,
): StaffAnalyticsCommand {
  return {
    callerUserId: caller,
    scopeBarberId,
    fromLocalDate,
    analyticsSpan,
    analyticsComparison: AnalyticsComparison.Previous,
  };
}

describe('staffAnalytics — the visibility table on the STORED record', () => {
  it('refuses a blocked account, whatever it holds', async () => {
    const { ports } = world();
    const refused = unwrapErr(
      await staffAnalytics(ports)(ask(BLOCKED.id, IVAN)),
    );
    expect(refused).toEqual({ errorCode: AnalyticsErrorCode.Forbidden });
  });

  it('answers an admin the shop: every barber record, no seat rows', async () => {
    const { ports } = world();
    const report = unwrapOk(await staffAnalytics(ports)(ask(ADMIN.id, null)));
    expect(report.reportScopeBarberId).toBeNull();
    expect(report.reportBarbers.map((b) => b.barberId)).toEqual([IVAN, NIKO]);
    expect(report.reportSeatRows).toEqual([]);
  });

  it('answers an admin any barber record, with its rows', async () => {
    const { ports } = world();
    const report = unwrapOk(await staffAnalytics(ports)(ask(ADMIN.id, NIKO)));
    expect(report.reportScopeBarberId).toBe(NIKO);
    expect(report.reportBarbers).toEqual([]);
    expect(report.reportSeatRows.map((row) => row.appointmentId)).toEqual([
      PARTY.id,
    ]);
  });

  it('refuses an admin an id that names no barber record', async () => {
    const { ports } = world();
    const ghost = BarberId.of('b-ghost');
    const refused = unwrapErr(
      await staffAnalytics(ports)(ask(ADMIN.id, ghost)),
    );
    expect(refused).toEqual({
      errorCode: AnalyticsErrorCode.ScopeUnknown,
      barberId: ghost,
    });
  });

  it('judges an admin who also cuts hair as admin: the shop by default', async () => {
    const { ports } = world();
    const report = unwrapOk(
      await staffAnalytics(ports)(ask(ADMIN_BARBER.id, null)),
    );
    expect(report.reportScopeBarberId).toBeNull();
  });

  it('answers a linked barber their own record, asked by id or by default', async () => {
    const { ports } = world();
    for (const scope of [IVAN, null]) {
      const report = unwrapOk(
        await staffAnalytics(ports)(ask(IVAN_USER.id, scope)),
      );
      expect(report.reportScopeBarberId).toBe(IVAN);
      expect(report.reportBarbers).toEqual([]);
    }
  });

  it('refuses a linked barber another barber record', async () => {
    const { ports } = world();
    const refused = unwrapErr(
      await staffAnalytics(ports)(ask(IVAN_USER.id, NIKO)),
    );
    expect(refused).toEqual({ errorCode: AnalyticsErrorCode.Forbidden });
  });

  it('never answers a barber the shop: the shop request (null) is their own record', async () => {
    const { ports } = world();
    const report = unwrapOk(
      await staffAnalytics(ports)(ask(IVAN_USER.id, null)),
    );
    expect(report.reportScopeBarberId).toBe(IVAN);
    expect(report.reportBarbers).toEqual([]);
    expect(report.reportTakingsCents).toBe(2000 + 2500);
  });

  it('refuses a barber no admin has linked yet', async () => {
    const { ports } = world();
    const refused = unwrapErr(
      await staffAnalytics(ports)(ask(UNLINKED.id, null)),
    );
    expect(refused).toEqual({ errorCode: AnalyticsErrorCode.BarberNotLinked });
  });

  it('refuses the receptionist and the sysadmin, and an account with no record', async () => {
    const { ports } = world();
    for (const caller of [RECEPTIONIST.id, SYSADMIN.id, UserId.of('u-none')]) {
      const refused = unwrapErr(await staffAnalytics(ports)(ask(caller, null)));
      expect(refused).toEqual({ errorCode: AnalyticsErrorCode.Forbidden });
    }
  });
});

describe('staffAnalytics — the period', () => {
  it('accepts any day as a DAY', async () => {
    const { ports } = world();
    const report = unwrapOk(
      await staffAnalytics(ports)(
        ask(ADMIN.id, null, localDate('2026-09-02'), AnalyticsSpan.Day),
      ),
    );
    expect(report.reportFromLocalDate).toBe('2026-09-02');
    expect(report.reportToLocalDate).toBe('2026-09-02');
  });

  it('refuses a first day that is not the 1st of the month or a Monday', async () => {
    const { ports } = world();
    const monthFrom2nd = unwrapErr(
      await staffAnalytics(ports)(ask(ADMIN.id, null, localDate('2026-09-02'))),
    );
    expect(monthFrom2nd).toEqual({
      errorCode: AnalyticsErrorCode.InvalidInput,
      field: 'fromLocalDate',
    });
    const weekFromTuesday = unwrapErr(
      await staffAnalytics(ports)(
        ask(ADMIN.id, null, localDate('2026-09-22'), AnalyticsSpan.Week),
      ),
    );
    expect(weekFromTuesday.errorCode).toBe(AnalyticsErrorCode.InvalidInput);
  });

  it('refuses a period 13 months back or starting in the future', async () => {
    const { ports } = world();
    for (const from of ['2025-08-01', '2026-10-01']) {
      const refused = unwrapErr(
        await staffAnalytics(ports)(ask(ADMIN.id, null, localDate(from))),
      );
      expect(refused).toEqual({
        errorCode: AnalyticsErrorCode.PeriodOutOfRange,
        fromLocalDate: localDate(from),
      });
    }
    // 12 months back and this week are in range.
    unwrapOk(
      await staffAnalytics(ports)(ask(ADMIN.id, null, localDate('2025-09-01'))),
    );
    unwrapOk(
      await staffAnalytics(ports)(
        ask(ADMIN.id, null, localDate('2026-09-28'), AnalyticsSpan.Week),
      ),
    );
  });
});

describe('staffAnalytics — the reads', () => {
  it('reads busy keys in queries of at most 30, and counts a party read from two of them once', async () => {
    const { ports, reads } = world();
    const report = unwrapOk(await staffAnalytics(ports)(ask(ADMIN.id, null)));
    // September × 2 barbers = 60 keys: Ivan's 30 then Niko's 30; August's
    // 62 in three; the next 7 days' 14 in one.
    expect(reads.visitQueries.map((keys) => keys.length)).toEqual([
      30, 30, 30, 30, 2, 14,
    ]);
    const [ivanChunk = [], nikoChunk = []] = reads.visitQueries;
    expect(ivanChunk).toContain(BusyKey.of(IVAN, localDate('2026-09-15')));
    expect(nikoChunk).toContain(BusyKey.of(NIKO, localDate('2026-09-15')));
    // The party came back from both chunks; its money counts once.
    expect(report.reportTakingsCents).toBe(2000 + 2500 + 3000);
    const ivan = report.reportBarbers.find((b) => b.barberId === IVAN);
    const niko = report.reportBarbers.find((b) => b.barberId === NIKO);
    expect(ivan?.takingsCents).toBe(4500);
    expect(niko?.takingsCents).toBe(3000);
  });

  it('reads a DAY as the day, its counterpart a week earlier and the next 7 days — no follow-ups', async () => {
    const { ports, reads } = world();
    const tuesday = localDate('2026-09-15');
    const report = unwrapOk(
      await staffAnalytics(ports)(
        ask(ADMIN.id, null, tuesday, AnalyticsSpan.Day),
      ),
    );
    expect(reads.visitQueries).toEqual([
      [BusyKey.of(IVAN, tuesday), BusyKey.of(NIKO, tuesday)],
      [
        BusyKey.of(IVAN, localDate('2026-09-08')),
        BusyKey.of(NIKO, localDate('2026-09-08')),
      ],
      [IVAN, NIKO].flatMap((barber) =>
        LocalDate.range(localDate('2026-09-28'), localDate('2026-10-04')).map(
          (day) => BusyKey.of(barber, day),
        ),
      ),
    ]);
    expect(reads.followUpQueries).toEqual([]);
    expect(reads.bookedInQueries).toEqual([]);
    expect(reads.departureQueries).toEqual([
      [IVAN, '2026-09-15', '2026-09-15'],
      [NIKO, '2026-09-15', '2026-09-15'],
      [IVAN, '2026-09-28', '2026-10-04'],
      [NIKO, '2026-09-28', '2026-10-04'],
    ]);
    expect(report).toMatchObject({
      reportAnalyticsSpan: AnalyticsSpan.Day,
      reportFromLocalDate: tuesday,
      reportToLocalDate: tuesday,
      reportAnalyticsComparison: AnalyticsComparison.Previous,
      reportComparisonFromLocalDate: localDate('2026-09-08'),
      reportComparisonToLocalDate: localDate('2026-09-08'),
      reportTakingsCents: 2500 + 3000,
      reportRebookedCount: 0,
    });
    expect(report.reportSeries).toHaveLength(1);
    expect(report.reportTimeSeries).toHaveLength(1);

    // A barber's own day reads no follow-ups either.
    const own = world();
    unwrapOk(
      await staffAnalytics(own.ports)(
        ask(IVAN_USER.id, null, localDate('2026-09-14'), AnalyticsSpan.Day),
      ),
    );
    expect(own.reads.followUpQueries).toEqual([]);
    expect(own.reads.visitQueries.map((keys) => keys.length)).toEqual([
      1, 1, 7,
    ]);
  });

  it('skips the comparison read when the comparison period starts before the reach', async () => {
    // On 28 September 2026 the reach starts 1 September 2025: September
    // 2025 may be asked for, its comparison (August 2025) is not read.
    const { ports, reads } = world();
    const report = unwrapOk(
      await staffAnalytics(ports)(ask(ADMIN.id, null, localDate('2025-09-01'))),
    );
    // September 2025 × 2 barbers = 60 keys in two queries, no August, the next 7 days' 14.
    expect(reads.visitQueries.map((keys) => keys.length)).toEqual([30, 30, 14]);
    expect(report.reportComparisonFromLocalDate).toBeNull();
    expect(report.reportComparisonToLocalDate).toBeNull();
    expect(report.reportHeroPreviousCents).toBeNull();
    expect(
      report.reportSeries.every((p) => p.comparisonTakingsCents === null),
    ).toBe(true);
  });

  it('reads one barber’s follow-ups by the visits in their rebooking base', async () => {
    const { ports, reads } = world();
    const report = unwrapOk(
      await staffAnalytics(ports)(ask(IVAN_USER.id, null)),
    );
    expect(reads.followUpQueries).toEqual([[SOLO.id, PARTY.id]]);
    expect(reads.bookedInQueries).toEqual([]);
    expect(report.reportRebookedBase).toBe(2);
    expect(report.reportRebookedCount).toBe(1);
  });

  it('reads the shop’s follow-ups by one booking range: the period’s first instant to the end of the day after its last', async () => {
    const { ports, reads } = world();
    const report = unwrapOk(await staffAnalytics(ports)(ask(ADMIN.id, null)));
    expect(reads.followUpQueries).toEqual([]);
    expect(reads.bookedInQueries).toEqual([
      [
        ZonedTimeSystem.startOfLocalDay(SEPTEMBER, FIXTURE_TIME_ZONE),
        ZonedTimeSystem.startOfLocalDay(
          localDate('2026-10-02'),
          FIXTURE_TIME_ZONE,
        ),
      ],
    ]);
    expect(report.reportRebookedCount).toBe(1);
  });

  it('reads each barber’s departures over the period and over the next 7 days', async () => {
    const { ports, reads } = world();
    unwrapOk(await staffAnalytics(ports)(ask(ADMIN.id, null)));
    expect(reads.departureQueries).toEqual([
      [IVAN, '2026-09-01', '2026-09-30'],
      [NIKO, '2026-09-01', '2026-09-30'],
      [IVAN, '2026-09-28', '2026-10-04'],
      [NIKO, '2026-09-28', '2026-10-04'],
    ]);
  });

  it('builds every barber-day from the roster: a CLOSED day rosters nothing and keeps what it would have given', async () => {
    const closed = scheduleExceptionFixture({
      id: ScheduleExceptionId.of(BusyKey.of(IVAN, localDate('2026-09-16'))),
      localDate: localDate('2026-09-16'),
      utcEpochMs: ZonedTimeSystem.startOfLocalDay(
        localDate('2026-09-16'),
        FIXTURE_TIME_ZONE,
      ),
    });
    const analytics = memoryAnalyticsReadPorts({
      visits: [SOLO],
      departures: [closed],
      barberIds: [IVAN],
      locations: [locationFixture()],
    });
    const { ports } = world({ ...analytics.ports });
    const report = unwrapOk(
      await staffAnalytics(ports)(ask(IVAN_USER.id, null)),
    );
    const row = report.reportDayRows.find(
      (day) => day.localDate === localDate('2026-09-16'),
    );
    expect(row?.dayRosteredMinutes).toBe(0);
    expect(row?.dayClosedDayMinutes).toBe(9 * 60);
    const monday = report.reportDayRows.find(
      (day) => day.localDate === localDate('2026-09-14'),
    );
    expect(monday?.dayRosteredMinutes).toBe(9 * 60);
    expect(monday?.dayWorkedMinutes).toBe(30);
    // 22 weekdays in September, one of them closed.
    expect(report.reportRosteredMinutes).toBe(21 * 9 * 60);
    expect(report.reportClosedDayMinutes).toBe(9 * 60);
  });

  it('answers a failed read as its store failure, and logs no report', async () => {
    const failure = RepositoryError.readFailed('locations', 'unavailable');
    const { ports, lines } = world({
      listLocations: async () => Result.err(failure),
    });
    const refused = unwrapErr(await staffAnalytics(ports)(ask(ADMIN.id, null)));
    expect(refused).toEqual(failure);
    expect(lines).toEqual([]);
  });

  it('answers a store failure when no shop is stored to read today from', async () => {
    const { ports } = world({ listLocations: async () => Result.ok([]) });
    const refused = unwrapErr(await staffAnalytics(ports)(ask(ADMIN.id, null)));
    expect(refused.errorCode).toBe(RepositoryErrorCode.ReadFailed);
  });
});

describe('staffAnalytics — the log line', () => {
  it('logs the caller, scope, period, version, counts and minutes per part — and no money', async () => {
    const { ports, lines } = world();
    const report = unwrapOk(
      await staffAnalytics(ports)(ask(IVAN_USER.id, null)),
    );
    expect(lines).toHaveLength(1);
    const line = lines[0];
    expect(line?.level).toBe('info');
    expect(line?.msg).toBe(LogEvent.AnalyticsReported);
    expect(line?.fields).toEqual({
      uid: IVAN_USER.id,
      scope: IVAN,
      periodFrom: '2026-09-01',
      periodTo: '2026-09-30',
      definitionVersion: 2,
      visitCount: 2,
      durationMs: 0,
      rosteredMinutes: report.reportRosteredMinutes,
      workedMinutes: report.reportWorkedMinutes,
      noShowMinutes: report.reportNoShowMinutes,
      unmarkedMinutes: report.reportUnmarkedMinutes,
      bookedAheadMinutes: report.reportBookedAheadMinutes,
      heldMinutes: report.reportHeldMinutes,
      blockedMinutes: report.reportBlockedMinutes,
      breakMinutes: report.reportBreakMinutes,
      shortGapMinutes: report.reportShortGapMinutes,
      unsoldMinutes: report.reportUnsoldMinutes,
      openMinutes: report.reportOpenMinutes,
      closedDayMinutes: report.reportClosedDayMinutes,
    });
    for (const key of Object.keys(line?.fields ?? {})) {
      expect(key).not.toMatch(/cents|taking|tip|price|money/i);
    }
    expect(report.reportComputedAtUtcMs).toBe(
      UtcEpochMs.plusMs(FIXTURE_NOW_UTC_MS, 0),
    );
  });

  it('logs a refusal as nothing (the edge’s outcome line records it)', async () => {
    const { ports, lines } = world();
    unwrapErr(await staffAnalytics(ports)(ask(IVAN_USER.id, NIKO)));
    expect(lines).toEqual([]);
  });
});
