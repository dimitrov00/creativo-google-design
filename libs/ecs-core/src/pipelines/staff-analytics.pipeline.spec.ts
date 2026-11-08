import { describe, expect, it } from 'vitest';
import {
  ANALYTICS_DEFINITION_VERSION,
  AnalyticsComparison,
  AnalyticsPeriod,
  AnalyticsSpan,
  BookingPolicy,
  DayFigures,
  FlagName,
  Role,
  Seat,
  SeatOutcome,
} from '@core/components';
import {
  AnalyticsErrorCode,
  RepositoryError,
  RepositoryErrorCode,
} from '@core/errors';
import type { Appointment, BarberAnalyticsDay } from '@core/entities';
import {
  AppointmentId,
  BarberAnalyticsDayId,
  BarberId,
  BusyKey,
  LocalDate,
  LogEvent,
  MinuteCount,
  PriceCents,
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
  memoryAnalyticsDayPorts,
  memoryAnalyticsReadPorts,
  memoryClockPorts,
  memoryDefaultLocationPorts,
  memoryFlagsPorts,
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
 * the one shop. The 1st to the 26th are PAST (two days back), the 27th to
 * the 30th live. */

const IVAN = FIXTURE_IDS.barber;
const NIKO = BarberId.of('b-niko');
const SEPTEMBER = localDate('2026-09-01');
const stamp = FIXTURE_NOW_UTC_MS;
const STORED = [FlagName.AnalyticsStoredDays] as const;
const m = (raw: number): MinuteCount => raw as MinuteCount;
const cents = (raw: number): PriceCents => raw as PriceCents;

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

/** A stored day of `barberId` on `day` — zeros unless overridden, of this definition. */
function storedDay(
  barberId: BarberId,
  day: LocalDate,
  overrides: Partial<DayFigures> = {},
): BarberAnalyticsDay {
  return {
    id: BarberAnalyticsDayId.of(BusyKey.of(barberId, day)),
    ...DayFigures.empty(barberId, day, stamp),
    ...overrides,
  };
}

/** Ivan's Monday the 14th as the writer would have stored it: 9 h rostered, the solo cut worked, rebooked. */
const STORED_SOLO_DAY = storedDay(IVAN, localDate('2026-09-14'), {
  dayRosteredMinutes: m(9 * 60),
  dayWorkedMinutes: m(30),
  dayUnsoldMinutes: m(9 * 60 - 30),
  dayTakingsCents: cents(2000),
  dayWorkedSeatCount: 1,
  dayNoShowBase: 1,
  dayRebookedBase: 1,
  dayRebookedCount: 1,
  dayStaffVisitCount: 1,
});

type WorldState = {
  readonly storedDays?: readonly BarberAnalyticsDay[];
  readonly flagsOn?: readonly FlagName[];
};

type World = {
  readonly ports: StaffAnalyticsPorts;
  readonly reads: ReturnType<typeof memoryAnalyticsReadPorts>['log'];
  readonly dayReads: ReturnType<typeof memoryAnalyticsDayPorts>['log'];
  readonly lines: ReturnType<typeof recordingTelemetry>['lines'];
};

function world(
  overrides: Partial<StaffAnalyticsPorts> = {},
  state: WorldState = {},
): World {
  const analytics = memoryAnalyticsReadPorts({
    visits: [SOLO, PARTY, FOLLOW_UP],
    departures: [],
    barberIds: [NIKO, IVAN],
    locations: [locationFixture()],
  });
  const days = memoryAnalyticsDayPorts({ days: state.storedDays ?? [] });
  const telemetry = recordingTelemetry();
  return {
    ports: {
      ...analytics.ports,
      ...days.ports,
      ...memoryFlagsPorts(state.flagsOn ?? []),
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
    dayReads: days.log,
    lines: telemetry.lines,
  };
}

function ask(
  caller: UserId,
  scopeBarberId: BarberId | null,
  fromLocalDate: LocalDate = SEPTEMBER,
  analyticsSpan: AnalyticsSpan = AnalyticsSpan.Month,
  toLocalDate: LocalDate | null = null,
): StaffAnalyticsCommand {
  return {
    callerUserId: caller,
    scopeBarberId,
    fromLocalDate,
    toLocalDate,
    analyticsSpan,
    analyticsComparison: AnalyticsComparison.Previous,
  };
}

const keysOf = (barberId: BarberId, from: string, to: string) =>
  LocalDate.range(localDate(from), localDate(to)).map((day) =>
    BusyKey.of(barberId, day),
  );

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

  it('accepts a YEAR from 1 January and a CUSTOM range with its last day (v2)', async () => {
    const { ports } = world();
    const year = unwrapOk(
      await staffAnalytics(ports)(
        ask(ADMIN.id, null, localDate('2026-01-01'), AnalyticsSpan.Year),
      ),
    );
    expect(year).toMatchObject({
      reportAnalyticsSpan: AnalyticsSpan.Year,
      reportFromLocalDate: '2026-01-01',
      reportToLocalDate: '2026-12-31',
      // Last year starts before the reach: no comparison.
      reportComparisonFromLocalDate: null,
      reportHeroPreviousCents: null,
    });
    expect(year.reportSeries.map((p) => p.localDate)).toEqual(
      LocalDate.range(localDate('2026-01-01'), localDate('2026-12-01')).filter(
        (day) => day.endsWith('-01'),
      ),
    );
    const custom = unwrapOk(
      await staffAnalytics(ports)(
        ask(
          ADMIN.id,
          null,
          localDate('2026-09-07'),
          AnalyticsSpan.Custom,
          localDate('2026-09-20'),
        ),
      ),
    );
    expect(custom).toMatchObject({
      reportAnalyticsSpan: AnalyticsSpan.Custom,
      reportFromLocalDate: '2026-09-07',
      reportToLocalDate: '2026-09-20',
      reportComparisonFromLocalDate: '2026-08-24',
      reportComparisonToLocalDate: '2026-09-06',
      reportTakingsCents: 2000 + 2500 + 3000,
    });
  });

  it('refuses a `to` off CUSTOM, none on CUSTOM, and a CUSTOM range over the cap (v2)', async () => {
    const { ports } = world();
    const to = unwrapErr(
      await staffAnalytics(ports)(
        ask(
          ADMIN.id,
          null,
          SEPTEMBER,
          AnalyticsSpan.Month,
          localDate('2026-09-30'),
        ),
      ),
    );
    expect(to).toEqual({
      errorCode: AnalyticsErrorCode.InvalidInput,
      field: 'toLocalDate',
    });
    const none = unwrapErr(
      await staffAnalytics(ports)(
        ask(ADMIN.id, null, SEPTEMBER, AnalyticsSpan.Custom, null),
      ),
    );
    expect(none).toEqual({
      errorCode: AnalyticsErrorCode.InvalidInput,
      field: 'toLocalDate',
    });
    const over = unwrapErr(
      await staffAnalytics(ports)(
        ask(
          ADMIN.id,
          null,
          localDate('2025-09-01'),
          AnalyticsSpan.Custom,
          localDate('2026-09-02'),
        ),
      ),
    );
    expect(over).toEqual({
      errorCode: AnalyticsErrorCode.PeriodOutOfRange,
      fromLocalDate: localDate('2025-09-01'),
    });
    // 366 days is the cap, not over it.
    unwrapOk(
      await staffAnalytics(ports)(
        ask(
          ADMIN.id,
          null,
          localDate('2025-09-01'),
          AnalyticsSpan.Custom,
          localDate('2026-09-01'),
        ),
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
      // Two past barber-days, no document for either.
      reportMissingDays: 2,
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
    const { ports, reads, dayReads } = world({}, { flagsOn: STORED });
    const report = unwrapOk(
      await staffAnalytics(ports)(ask(ADMIN.id, null, localDate('2025-09-01'))),
    );
    // September 2025 × 2 barbers = 60 keys in two queries, no August, the next 7 days' 14.
    expect(reads.visitQueries.map((keys) => keys.length)).toEqual([30, 30, 14]);
    // Nor its day documents — one range, the period's.
    expect(dayReads.rangeQueries).toEqual([
      [[IVAN, NIKO], '2025-09-01', '2025-09-30'],
    ]);
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

describe('staffAnalytics — the stored days (v2, `analytics.storedDays`)', () => {
  it('with the flag off never reads a day document: every past day is computed live and counted missing', async () => {
    const { ports, reads, dayReads } = world(
      {},
      { storedDays: [STORED_SOLO_DAY] },
    );
    const report = unwrapOk(await staffAnalytics(ports)(ask(ADMIN.id, null)));
    expect(dayReads.rangeQueries).toEqual([]);
    expect(reads.visitQueries.map((keys) => keys.length)).toEqual([
      30, 30, 30, 30, 2, 14,
    ]);
    // The 1st to the 26th are past, two days back: 26 × 2 barbers.
    expect(report.reportMissingDays).toBe(26 * 2);
  });

  it('with the flag on reads the period’s and the comparison’s documents in one range each, and the visits of the other barber-days only', async () => {
    const { ports, reads, dayReads } = world(
      {},
      { storedDays: [STORED_SOLO_DAY], flagsOn: STORED },
    );
    const report = unwrapOk(await staffAnalytics(ports)(ask(ADMIN.id, null)));
    expect(dayReads.rangeQueries).toEqual([
      [[IVAN, NIKO], '2026-09-01', '2026-09-30'],
      [[IVAN, NIKO], '2026-08-01', '2026-08-31'],
    ]);
    // Ivan's 14th is held: 59 period keys (30 + 29), August's 62, the 14 ahead.
    expect(reads.visitQueries.map((keys) => keys.length)).toEqual([
      30, 29, 30, 30, 2, 14,
    ]);
    const periodKeys = reads.visitQueries.slice(0, 2).flat();
    expect(periodKeys).not.toContain(BusyKey.of(IVAN, localDate('2026-09-14')));
    expect(periodKeys).toContain(BusyKey.of(NIKO, localDate('2026-09-14')));
    // The stored day's figures stand in for its visits: the same takings.
    expect(report.reportTakingsCents).toBe(2000 + 2500 + 3000);
    expect(report.reportMissingDays).toBe(26 * 2 - 1);
    const monday = report.reportDayRows.find(
      (row) => row.barberId === IVAN && row.localDate === '2026-09-14',
    );
    expect(monday).toEqual(DayFigures.rowOf(STORED_SOLO_DAY));
  });

  it('reads follow-ups only for the past days computed live — a stored day’s rebooking is final', async () => {
    const { ports, reads } = world(
      {},
      { storedDays: [STORED_SOLO_DAY], flagsOn: STORED },
    );
    const report = unwrapOk(
      await staffAnalytics(ports)(ask(IVAN_USER.id, null)),
    );
    // The solo cut's day is stored (rebooked 1 of 1); the party's is live.
    expect(reads.followUpQueries).toEqual([[PARTY.id]]);
    expect(report.reportRebookedBase).toBe(2);
    expect(report.reportRebookedCount).toBe(1);
  });

  it('reads no follow-ups at all when every past day in scope is stored', async () => {
    const stored = LocalDate.range(SEPTEMBER, localDate('2026-09-26')).map(
      (day) =>
        day === '2026-09-14'
          ? STORED_SOLO_DAY
          : storedDay(IVAN, day, {
              dayRosteredMinutes:
                LocalDate.weekday(day) <= 5 ? m(9 * 60) : MinuteCount.ZERO,
            }),
    );
    const { ports, reads } = world({}, { storedDays: stored, flagsOn: STORED });
    const report = unwrapOk(
      await staffAnalytics(ports)(ask(IVAN_USER.id, null)),
    );
    expect(reads.followUpQueries).toEqual([]);
    expect(reads.bookedInQueries).toEqual([]);
    // Only the 27th to the 30th are read live: 4 keys, then August's 31, the 7 ahead.
    expect(reads.visitQueries.map((keys) => keys.length)).toEqual([
      4, 30, 1, 7,
    ]);
    expect(report.reportMissingDays).toBe(0);
    // The party on the 15th sits in a zero document now: its money is not read.
    expect(report.reportTakingsCents).toBe(2000);
  });

  it('computes a version-stale document’s day live, and counts it missing', async () => {
    const stale = {
      ...STORED_SOLO_DAY,
      dayDefinitionVersion: ANALYTICS_DEFINITION_VERSION - 1,
      dayTakingsCents: cents(99_999),
    };
    const { ports, reads } = world(
      {},
      { storedDays: [stale], flagsOn: STORED },
    );
    const report = unwrapOk(
      await staffAnalytics(ports)(ask(IVAN_USER.id, null)),
    );
    expect(reads.visitQueries[0]).toContain(
      BusyKey.of(IVAN, localDate('2026-09-14')),
    );
    expect(report.reportTakingsCents).toBe(2000 + 2500);
    expect(report.reportMissingDays).toBe(26);
  });

  it('reads the counterpart day’s visits for the hero even when a document holds it', async () => {
    const counterpart = storedDay(IVAN, localDate('2026-08-28'), {
      dayTakingsCents: cents(7000),
      dayWorkedSeatCount: 1,
    });
    const { ports, reads } = world(
      {},
      { storedDays: [counterpart], flagsOn: STORED },
    );
    const report = unwrapOk(
      await staffAnalytics(ports)(ask(IVAN_USER.id, null)),
    );
    // August's 31 keys minus the 28th, plus the 28th again as the counterpart: 31.
    const august = reads.visitQueries.slice(1, 3).flat();
    expect(august).toHaveLength(31);
    expect(august).toContain(BusyKey.of(IVAN, localDate('2026-08-28')));
    // The counterpart is cut at 09:00 from its (absent) visits: nothing
    // before 09:00 — the document's 70,00 € is not the hero's.
    expect(report.reportHeroPreviousCents).toBe(0);
    // The line, though, charts the document.
    expect(
      report.reportSeries.find((p) => p.localDate === '2026-09-28')
        ?.comparisonTakingsCents,
    ).toBe(7000);
  });

  it('answers the day read’s bound as the refusal — never a truncated report', async () => {
    const refusal = RepositoryError.readFailed(
      'analyticsDays',
      'resource-exhausted',
    );
    const { ports, lines } = world(
      { loadAnalyticsDays: async () => Result.err(refusal) },
      { flagsOn: STORED },
    );
    const refused = unwrapErr(await staffAnalytics(ports)(ask(ADMIN.id, null)));
    expect(refused).toEqual(refusal);
    expect(lines).toEqual([]);
    // And so a live fallback over the visit caps.
    const exhausted = RepositoryError.readFailed(
      'appointments',
      'resource-exhausted',
    );
    const over = world({
      loadVisitsByBusyKeys: async () => Result.err(exhausted),
    });
    expect(
      unwrapErr(await staffAnalytics(over.ports)(ask(ADMIN.id, null))),
    ).toEqual(exhausted);
  });

  it('reads a YEAR as one range of at most 366 documents per barber, its live days’ visits, and no comparison', async () => {
    const stored: BarberAnalyticsDay[] = [];
    for (const day of LocalDate.range(
      localDate('2026-01-01'),
      localDate('2026-09-26'),
    )) {
      stored.push(storedDay(IVAN, day), storedDay(NIKO, day));
    }
    const { ports, reads, dayReads } = world(
      {},
      { storedDays: stored, flagsOn: STORED },
    );
    const report = unwrapOk(
      await staffAnalytics(ports)(
        ask(ADMIN.id, null, localDate('2026-01-01'), AnalyticsSpan.Year),
      ),
    );
    expect(dayReads.rangeQueries).toEqual([
      [[IVAN, NIKO], '2026-01-01', '2026-12-31'],
    ]);
    expect(AnalyticsPeriod.length(AnalyticsPeriod.yearOf(SEPTEMBER))).toBe(365);
    // The 27th of September to 31 December, both barbers: 96 × 2 keys; the 14 ahead.
    const liveKeys = keysOf(IVAN, '2026-09-27', '2026-12-31').concat(
      keysOf(NIKO, '2026-09-27', '2026-12-31'),
    );
    expect(reads.visitQueries.slice(0, -1).flat()).toEqual(liveKeys);
    expect(reads.visitQueries[reads.visitQueries.length - 1]).toHaveLength(14);
    expect(report.reportMissingDays).toBe(0);
    expect(report.reportSeries).toHaveLength(12);
    expect(report.reportDayRows.map((row) => row.localDate)).toEqual(
      LocalDate.range(localDate('2026-01-01'), localDate('2026-12-01'))
        .filter((day) => day.endsWith('-01'))
        .flatMap((day) => [day, day]),
    );
  });
});

describe('staffAnalytics — the log line', () => {
  it('logs the caller, scope, period, span, comparison, version, counts and minutes per part — and no money', async () => {
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
      span: AnalyticsSpan.Month,
      periodFrom: '2026-09-01',
      periodTo: '2026-09-30',
      comparison: AnalyticsComparison.Previous,
      definitionVersion: 2,
      visitCount: 2,
      missingDays: 26,
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
