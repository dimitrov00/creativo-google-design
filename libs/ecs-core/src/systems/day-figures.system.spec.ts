import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  ANALYTICS_DEFINITION_VERSION,
  AnalyticsComparison,
  AnalyticsPeriod,
  BookingOrigin,
  CancellationReason,
  CancelledBy,
  ClientStatsPolicy,
  DayFigures,
  MinuteRange,
  Placement,
  Seat,
  SeatOutcome,
  type ShopNow,
} from '@core/components';
import {
  AppointmentId,
  BarberId,
  Currency,
  LocalDate,
  type MinuteCount,
  SeatId,
  ServiceId,
  UtcEpochMs,
} from '@core/primitives';
import {
  FIXTURE_NOW_UTC_MS,
  appointmentFixture,
  deepFreeze,
  endMinute,
  hourCount,
  localDate,
  minute,
  seatFixture,
  termsFixture,
} from '@core/testing';
import { AnalyticsHourSystem } from './analytics-hour.system';
import type { ChairDay } from './chair-time.system';
import { type DayFoldInput, DayFiguresSystem } from './day-figures.system';
import {
  type AnalyticsDay,
  type AnalyticsFollowUp,
  type AnalyticsInput,
  type AnalyticsVisit,
  StaffAnalyticsSystem,
} from './staff-analytics.system';

/*
 * The fold that writes a day document and the sum that reads a period out
 * of them (staff analytics v2, «Systems (pure)»), and property P1: over any
 * set of barber-days and their visits, `sum(days.map(fold))` agrees with
 * `StaffAnalyticsSystem.report` figure by figure — minutes, money, counts,
 * origins, services (minus the derived ratio) and the hour grid.
 */

const { fold, sum, hourBuckets, rebookedVisits } = DayFiguresSystem;
const ivan = BarberId.of('ivan');
const niko = BarberId.of('niko');
const cut = ServiceId.of('svc-cut');
const beard = ServiceId.of('svc-beard');
const stamp = FIXTURE_NOW_UTC_MS;
const HOUR_MS = 3_600_000;
/** Today: Wednesday 14 October 2026, 14:00. */
const TODAY = localDate('2026-10-14');
const NOW: ShopNow = {
  localDate: TODAY,
  currentMinute: minute(14 * 60),
  utcEpochMs: stamp,
};
const OCTOBER = AnalyticsPeriod.monthOf(TODAY);
const day = (n: number): LocalDate => LocalDate.addDays(TODAY, n);
const zero = 0 as MinuteCount;

let seatSeq = 0;
const seat = (
  barberId: BarberId,
  priceCents: number,
  outcome: SeatOutcome = SeatOutcome.worked(stamp),
  serviceId: ServiceId = cut,
  startHour = 10,
  tipCents: number | null = null,
): Seat =>
  seatFixture({
    seatId: SeatId.of(`s-${++seatSeq}`),
    barberId,
    serviceId,
    startMinutes: minute(startHour * 60),
    tipCents: tipCents as Seat['tipCents'],
    terms: Seat.termsOf(termsFixture(priceCents, 30, 0, 0), null),
    outcome,
  });

const visit = (
  id: string,
  localDay: LocalDate,
  seats: readonly Seat[],
  extra: Partial<AnalyticsVisit> = {},
): AnalyticsVisit =>
  appointmentFixture({
    id: AppointmentId.of(id),
    localDate: localDay,
    seats,
    ...extra,
  } as Parameters<typeof appointmentFixture>[0]);

const dayOf = (
  barberId: BarberId,
  localDay: LocalDate,
  parts: Partial<Record<keyof ChairDay | 'closedDayMinutes', number>> = {},
  stretches: readonly MinuteRange[] = [],
  pastDay = LocalDate.addDays(localDay, 1) < TODAY,
): AnalyticsDay =>
  ({
    barberId,
    localDate: localDay,
    stretches,
    pastDay,
    rosteredMinutes: zero,
    workedMinutes: zero,
    noShowMinutes: zero,
    unmarkedMinutes: zero,
    bookedAheadMinutes: zero,
    heldMinutes: zero,
    blockedMinutes: zero,
    breakMinutes: zero,
    shortGapMinutes: zero,
    unsoldMinutes: zero,
    openMinutes: zero,
    pastBlockedMinutes: zero,
    pastHeldMinutes: zero,
    pastShortGapMinutes: zero,
    outsideHoursMinutes: zero,
    outsideHoursSeatCount: 0,
    closedDayMinutes: zero,
    ...parts,
  }) as AnalyticsDay;

function foldInput(overrides: Partial<DayFoldInput> = {}): DayFoldInput {
  return {
    day: dayOf(ivan, day(-3)),
    visits: [],
    followUps: [],
    policy: ClientStatsPolicy.DEFAULT,
    computedAtUtcMs: stamp,
    ...overrides,
  };
}

/** A client's cancellation `hoursBefore` the visit, under a 24-hour window. */
const clientCancel = (hoursBefore: number): SeatOutcome =>
  SeatOutcome.cancelled(
    UtcEpochMs.plusMs(stamp, -hoursBefore * HOUR_MS),
    CancelledBy.Client,
    CancellationReason.ClientChangedPlans,
    hourCount(24),
  );

describe('DayFiguresSystem.fold — one barber-day', () => {
  it('carries the day’s parts and closed-day minutes as its own, and stamps the version and the read instant', () => {
    const figures = fold(
      foldInput({
        day: dayOf(ivan, day(-3), {
          rosteredMinutes: 540,
          workedMinutes: 300,
          unsoldMinutes: 200,
          breakMinutes: 30,
          shortGapMinutes: 10,
          closedDayMinutes: 0,
          outsideHoursMinutes: 15,
          outsideHoursSeatCount: 1,
        }),
      }),
    );
    expect(figures.barberId).toBe(ivan);
    expect(figures.localDate).toBe(day(-3));
    expect(figures.dayRosteredMinutes).toBe(540);
    expect(figures.dayWorkedMinutes).toBe(300);
    expect(figures.dayUnsoldMinutes).toBe(200);
    expect(figures.dayBreakMinutes).toBe(30);
    expect(figures.dayShortGapMinutes).toBe(10);
    expect(figures.dayOutsideHoursMinutes).toBe(15);
    expect(figures.dayOutsideHoursSeatCount).toBe(1);
    expect(figures.dayDefinitionVersion).toBe(ANALYTICS_DEFINITION_VERSION);
    expect(figures.dayComputedAtUtcMs).toBe(stamp);
    expect(figures.currency).toBe(Currency.EUR);
    expect(DayFigures.is(figures)).toBe(true);
  });

  it('sums the barber’s worked seats — nets after the discount split, tips, the service rows — and skips the other barber’s and other days’', () => {
    const figures = fold(
      foldInput({
        visits: [
          visit('a1', day(-3), [
            seat(ivan, 2000, undefined, cut, 10, 300),
            seat(niko, 2000),
          ]),
          visit('a2', day(-3), [seat(ivan, 1750, undefined, beard, 12)]),
          // Another day: not this document's.
          visit('a3', day(-2), [seat(ivan, 9900)]),
        ],
      }),
    );
    expect(figures.dayTakingsCents).toBe(3750);
    expect(figures.dayTipsCents).toBe(300);
    expect(figures.dayWorkedSeatCount).toBe(2);
    expect(figures.dayNoShowBase).toBe(2);
    expect(figures.dayServices).toEqual([
      {
        serviceId: beard,
        workedSeatCount: 1,
        takingsCents: 1750,
        serviceMinutes: 30,
      },
      {
        serviceId: cut,
        workedSeatCount: 1,
        takingsCents: 2000,
        serviceMinutes: 30,
      },
    ]);
  });

  it('counts no-shows, late client cancellations and the visits by origin', () => {
    const figures = fold(
      foldInput({
        visits: [
          visit('a1', day(-3), [seat(ivan, 2000, SeatOutcome.noShow(stamp))]),
          visit('a2', day(-3), [seat(ivan, 2000, clientCancel(1))], {
            utcEpochMs: stamp,
            bookedAtUtcMs: UtcEpochMs.plusMs(stamp, -72 * HOUR_MS),
          }),
          visit('a3', day(-3), [seat(ivan, 2000, clientCancel(48))], {
            utcEpochMs: stamp,
            bookedAtUtcMs: UtcEpochMs.plusMs(stamp, -72 * HOUR_MS),
          }),
          visit('a4', day(-3), [seat(ivan, 2000)], {
            placement: Placement.Staff,
          }),
          visit('a5', day(-3), [seat(ivan, 2000)], { placement: null }),
          visit('a6', day(-3), [seat(ivan, 2000)]),
        ],
      }),
    );
    expect(figures.dayNoShowCount).toBe(1);
    expect(figures.dayNoShowBase).toBe(4);
    expect(figures.dayLateCancellationCount).toBe(1);
    expect(figures.dayOnlineVisitCount).toBe(1);
    expect(figures.dayStaffVisitCount).toBe(1);
    expect(figures.dayUnknownOriginVisitCount).toBe(1);
  });

  it('judges rebooking on a PAST day only, by a live follow-up booked by the end of the next shop day', () => {
    const followUps: AnalyticsFollowUp[] = [
      {
        bookedFromAppointmentId: AppointmentId.of('a1'),
        bookedOnLocalDate: day(-2),
        followUpCancelled: false,
      },
      {
        bookedFromAppointmentId: AppointmentId.of('a2'),
        bookedOnLocalDate: day(-1),
        followUpCancelled: false,
      },
      {
        bookedFromAppointmentId: AppointmentId.of('a3'),
        bookedOnLocalDate: day(-3),
        followUpCancelled: true,
      },
    ];
    const visits = [
      visit('a1', day(-3), [seat(ivan, 2000)]),
      visit('a2', day(-3), [seat(ivan, 2000)]),
      visit('a3', day(-3), [seat(ivan, 2000)]),
    ];
    const past = fold(foldInput({ visits, followUps }));
    expect(past.dayRebookedBase).toBe(3);
    expect(past.dayRebookedCount).toBe(1);
    const live = fold(
      foldInput({
        day: dayOf(ivan, day(-3), {}, [], false),
        visits,
        followUps,
      }),
    );
    expect(live.dayRebookedBase).toBe(0);
    expect(live.dayRebookedCount).toBe(0);
    expect(rebookedVisits(visits, followUps)).toEqual(
      new Set([AppointmentId.of('a1')]),
    );
  });

  it('buckets the worked seats’ chair time against the day’s stretches, by the hour', () => {
    const stretches = [MinuteRange.of(minute(540), endMinute(1080))];
    const figures = fold(
      foldInput({
        day: dayOf(ivan, day(-3), { rosteredMinutes: 540 }, stretches),
        visits: [
          visit('a1', day(-3), [seat(ivan, 2000, undefined, cut, 10)]),
          // A no-show holds no busy hour; a wholly cancelled visit none either.
          visit('a2', day(-3), [
            seat(ivan, 2000, SeatOutcome.noShow(stamp), cut, 11),
          ]),
        ],
      }),
    );
    expect(figures.dayHourWorked).toHaveLength(24);
    expect(figures.dayHourWorked[10]).toBe(30);
    expect(figures.dayHourWorked[11]).toBe(0);
    expect(figures.dayHourRostered.slice(9, 18).every((m) => m === 60)).toBe(
      true,
    );
    expect(
      hourBuckets(dayOf(ivan, day(-3), {}, stretches), []).rostered[9],
    ).toBe(60);
  });

  it('is pure: same input → same output, inputs untouched', () => {
    const input = deepFreeze(
      foldInput({
        day: dayOf(ivan, day(-3), { rosteredMinutes: 540 }, [
          MinuteRange.of(minute(540), endMinute(1080)),
        ]),
        visits: [
          visit('a1', day(-3), [seat(ivan, 2000, undefined, cut, 10, 200)]),
        ],
      }),
    );
    const once = fold(input);
    const twice = fold(input);
    expect(twice).toEqual(once);
  });
});

describe('DayFiguresSystem.sum — several days as one', () => {
  it('adds every integer, merges the service rows by service and the buckets by hour, and files the total where told', () => {
    const a = fold(
      foldInput({
        day: dayOf(ivan, day(-3), { rosteredMinutes: 540, workedMinutes: 60 }, [
          MinuteRange.of(minute(540), endMinute(1080)),
        ]),
        visits: [
          visit('a1', day(-3), [seat(ivan, 2000, undefined, cut, 10, 100)]),
          visit('a2', day(-3), [seat(ivan, 1000, undefined, beard, 11)]),
        ],
        computedAtUtcMs: UtcEpochMs.plusMs(stamp, 5000),
      }),
    );
    const b = fold(
      foldInput({
        day: dayOf(ivan, day(-2), { rosteredMinutes: 480, workedMinutes: 30 }, [
          MinuteRange.of(minute(600), endMinute(1080)),
        ]),
        visits: [visit('a3', day(-2), [seat(ivan, 3000, undefined, cut, 10)])],
      }),
    );
    const total = sum([a, b], ivan, day(-3));
    expect(total.barberId).toBe(ivan);
    expect(total.localDate).toBe(day(-3));
    expect(total.dayRosteredMinutes).toBe(1020);
    expect(total.dayWorkedMinutes).toBe(90);
    expect(total.dayTakingsCents).toBe(6000);
    expect(total.dayTipsCents).toBe(100);
    expect(total.dayWorkedSeatCount).toBe(3);
    expect(total.dayServices).toEqual([
      {
        serviceId: beard,
        workedSeatCount: 1,
        takingsCents: 1000,
        serviceMinutes: 30,
      },
      {
        serviceId: cut,
        workedSeatCount: 2,
        takingsCents: 5000,
        serviceMinutes: 60,
      },
    ]);
    expect(total.dayHourWorked[10]).toBe(60);
    expect(total.dayHourRostered[9]).toBe(60);
    expect(total.dayHourRostered[10]).toBe(120);
    // Stamped by the oldest part: a total is as current as its stalest day.
    expect(total.dayComputedAtUtcMs).toBe(stamp);
    expect(total.dayDefinitionVersion).toBe(ANALYTICS_DEFINITION_VERSION);
    expect(DayFigures.is(total)).toBe(true);
  });

  it('of nothing is the empty day at the epoch', () => {
    expect(sum([], niko, day(0))).toEqual(
      DayFigures.empty(niko, day(0), UtcEpochMs.EPOCH),
    );
  });

  it('is pure: same input → same output, inputs untouched', () => {
    const parts = deepFreeze([
      fold(foldInput({ visits: [visit('a1', day(-3), [seat(ivan, 2000)])] })),
      fold(foldInput({ day: dayOf(ivan, day(-2)) })),
    ]);
    expect(sum(parts, ivan, day(-3))).toEqual(sum(parts, ivan, day(-3)));
  });
});

/* ── Property P1 — the stored days sum to the report ──────────────────── */

const BARBERS = [ivan, niko] as const;
const DATES = [day(-6), day(-4), day(-1), TODAY] as const;
const SERVICES = [cut, beard] as const;

type SeatSpec = {
  readonly barber: number;
  readonly outcome: 'WORKED' | 'NO_SHOW' | 'LATE' | 'EARLY' | 'SCHEDULED';
  readonly price: number;
  readonly tip: number | null;
  readonly service: number;
  readonly startHour: number;
};
type VisitSpec = {
  readonly date: number;
  readonly seats: readonly SeatSpec[];
  readonly placement: 'SELF' | 'STAFF' | 'NONE';
  readonly followUp: 'NEXT_DAY' | 'LATER' | 'CANCELLED' | 'NONE';
};
type DaySpec = {
  readonly parts: readonly number[];
  readonly stretchFrom: number;
  readonly stretchHours: number;
  readonly pastDay: boolean;
};

const seatSpec: fc.Arbitrary<SeatSpec> = fc.record({
  barber: fc.integer({ min: 0, max: BARBERS.length - 1 }),
  outcome: fc.constantFrom(
    'WORKED',
    'WORKED',
    'NO_SHOW',
    'LATE',
    'EARLY',
    'SCHEDULED',
  ),
  price: fc.integer({ min: 0, max: 9999 }),
  tip: fc.option(fc.integer({ min: 0, max: 999 }), { nil: null }),
  service: fc.integer({ min: 0, max: SERVICES.length - 1 }),
  startHour: fc.integer({ min: 8, max: 19 }),
});
const visitSpec: fc.Arbitrary<VisitSpec> = fc.record({
  date: fc.integer({ min: 0, max: DATES.length - 1 }),
  seats: fc.array(seatSpec, { minLength: 1, maxLength: 3 }),
  placement: fc.constantFrom('SELF', 'STAFF', 'NONE'),
  followUp: fc.constantFrom('NEXT_DAY', 'LATER', 'CANCELLED', 'NONE'),
});
const daySpec: fc.Arbitrary<DaySpec> = fc.record({
  parts: fc.array(fc.integer({ min: 0, max: 120 }), {
    minLength: 10,
    maxLength: 10,
  }),
  stretchFrom: fc.integer({ min: 7, max: 12 }),
  stretchHours: fc.integer({ min: 0, max: 9 }),
  pastDay: fc.boolean(),
});
type WorldSpec = {
  readonly days: readonly DaySpec[];
  readonly visits: readonly VisitSpec[];
};
const worldSpec: fc.Arbitrary<WorldSpec> = fc.record({
  days: fc.array(daySpec, {
    minLength: BARBERS.length * DATES.length,
    maxLength: BARBERS.length * DATES.length,
  }),
  visits: fc.array(visitSpec, { minLength: 0, maxLength: 12 }),
});

type World = {
  readonly days: readonly AnalyticsDay[];
  readonly visits: readonly AnalyticsVisit[];
  readonly followUps: readonly AnalyticsFollowUp[];
};

function worldOf(spec: WorldSpec): World {
  const days: AnalyticsDay[] = [];
  for (let b = 0; b < BARBERS.length; b++) {
    for (let d = 0; d < DATES.length; d++) {
      const s = spec.days[b * DATES.length + d] as DaySpec;
      const p = s.parts;
      const rostered = p.reduce((a, n) => a + n, 0);
      days.push(
        dayOf(
          BARBERS[b] as BarberId,
          DATES[d] as LocalDate,
          {
            rosteredMinutes: rostered,
            workedMinutes: p[0],
            noShowMinutes: p[1],
            unmarkedMinutes: p[2],
            bookedAheadMinutes: p[3],
            heldMinutes: p[4],
            blockedMinutes: p[5],
            breakMinutes: p[6],
            shortGapMinutes: p[7],
            unsoldMinutes: p[8],
            openMinutes: p[9],
            pastBlockedMinutes: Math.min(p[5] as number, 30),
            pastHeldMinutes: Math.min(p[4] as number, 10),
            pastShortGapMinutes: Math.min(p[7] as number, 5),
            outsideHoursMinutes: (p[0] as number) % 7,
            outsideHoursSeatCount: (p[0] as number) % 2,
            closedDayMinutes: (p[1] as number) % 3 === 0 ? 0 : 480,
          },
          s.stretchHours === 0
            ? []
            : [
                MinuteRange.of(
                  minute(s.stretchFrom * 60),
                  endMinute((s.stretchFrom + s.stretchHours) * 60),
                ),
              ],
          s.pastDay,
        ),
      );
    }
  }
  const visits: AnalyticsVisit[] = [];
  const followUps: AnalyticsFollowUp[] = [];
  spec.visits.forEach((v, i) => {
    const id = AppointmentId.of(`p1-${i}`);
    const localDay = DATES[v.date] as LocalDate;
    const seats = v.seats.map((s) =>
      seat(
        BARBERS[s.barber] as BarberId,
        s.price,
        s.outcome === 'WORKED'
          ? SeatOutcome.worked(stamp)
          : s.outcome === 'NO_SHOW'
            ? SeatOutcome.noShow(stamp)
            : s.outcome === 'LATE'
              ? clientCancel(1)
              : s.outcome === 'EARLY'
                ? clientCancel(48)
                : SeatOutcome.scheduled(),
        SERVICES[s.service] as ServiceId,
        s.startHour,
        s.tip,
      ),
    );
    visits.push(
      visit(`p1-${i}`, localDay, seats, {
        utcEpochMs: stamp,
        bookedAtUtcMs: UtcEpochMs.plusMs(stamp, -72 * HOUR_MS),
        placement:
          v.placement === 'SELF'
            ? Placement.Self
            : v.placement === 'STAFF'
              ? Placement.Staff
              : null,
      }),
    );
    if (v.followUp !== 'NONE') {
      followUps.push({
        bookedFromAppointmentId: id,
        bookedOnLocalDate: LocalDate.addDays(
          localDay,
          v.followUp === 'LATER' ? 2 : 1,
        ),
        followUpCancelled: v.followUp === 'CANCELLED',
      });
    }
  });
  return { days, visits, followUps };
}

function reportInput(
  world: World,
  scopeBarberId: BarberId | null,
): AnalyticsInput {
  return {
    scopeBarberId,
    barberIds: scopeBarberId === null ? [...BARBERS] : [scopeBarberId],
    period: OCTOBER,
    analyticsComparison: AnalyticsComparison.Previous,
    days: world.days,
    pastDays: [],
    aheadDays: [],
    visits: world.visits,
    previousVisits: [],
    previousPastDays: [],
    followUps: world.followUps,
    policy: ClientStatsPolicy.DEFAULT,
    now: NOW,
  };
}

function expectSumAgrees(world: World, scopeBarberId: BarberId | null): void {
  const input = reportInput(world, scopeBarberId);
  const report = StaffAnalyticsSystem.report(input);
  const inScope = (barberId: BarberId): boolean =>
    scopeBarberId === null || barberId === scopeBarberId;
  const visitsOn = (date: LocalDate): readonly AnalyticsVisit[] =>
    world.visits.filter((v) => v.localDate === date);
  const folded = world.days
    .filter((d) => inScope(d.barberId))
    .map((d) =>
      fold({
        day: d,
        visits: visitsOn(d.localDate),
        followUps: world.followUps,
        policy: input.policy,
        computedAtUtcMs: stamp,
      }),
    );
  const total = sum(folded, ivan, OCTOBER.fromLocalDate);

  expect({
    rostered: total.dayRosteredMinutes,
    worked: total.dayWorkedMinutes,
    noShow: total.dayNoShowMinutes,
    unmarked: total.dayUnmarkedMinutes,
    bookedAhead: total.dayBookedAheadMinutes,
    held: total.dayHeldMinutes,
    blocked: total.dayBlockedMinutes,
    breaks: total.dayBreakMinutes,
    shortGap: total.dayShortGapMinutes,
    unsold: total.dayUnsoldMinutes,
    open: total.dayOpenMinutes,
    closed: total.dayClosedDayMinutes,
    outside: total.dayOutsideHoursMinutes,
    outsideSeats: total.dayOutsideHoursSeatCount,
    takings: total.dayTakingsCents,
    tips: total.dayTipsCents,
    excluded: total.dayExcludedVisitCount,
    rebookedBase: total.dayRebookedBase,
    rebookedCount: total.dayRebookedCount,
    noShowCount: total.dayNoShowCount,
    noShowBase: total.dayNoShowBase,
    late: total.dayLateCancellationCount,
    origins: [
      {
        bookingOrigin: BookingOrigin.Online,
        visitCount: total.dayOnlineVisitCount,
      },
      {
        bookingOrigin: BookingOrigin.Staff,
        visitCount: total.dayStaffVisitCount,
      },
      {
        bookingOrigin: BookingOrigin.Unknown,
        visitCount: total.dayUnknownOriginVisitCount,
      },
    ],
  }).toEqual({
    rostered: report.reportRosteredMinutes,
    worked: report.reportWorkedMinutes,
    noShow: report.reportNoShowMinutes,
    unmarked: report.reportUnmarkedMinutes,
    bookedAhead: report.reportBookedAheadMinutes,
    held: report.reportHeldMinutes,
    blocked: report.reportBlockedMinutes,
    breaks: report.reportBreakMinutes,
    shortGap: report.reportShortGapMinutes,
    unsold: report.reportUnsoldMinutes,
    open: report.reportOpenMinutes,
    closed: report.reportClosedDayMinutes,
    outside: report.reportOutsideHoursMinutes,
    outsideSeats: report.reportOutsideHoursSeatCount,
    takings: report.reportTakingsCents,
    tips: report.reportTipsCents,
    excluded: report.reportExcludedVisitCount,
    rebookedBase: report.reportRebookedBase,
    rebookedCount: report.reportRebookedCount,
    noShowCount: report.reportNoShowCount,
    noShowBase: report.reportNoShowBase,
    late: report.reportLateCancellationCount,
    origins: report.reportOrigins,
  });

  // The service rows, minus the derived ratio, as sets keyed by service.
  const byService = (rows: readonly { readonly serviceId: ServiceId }[]) =>
    [...rows].sort((a, b) => (a.serviceId < b.serviceId ? -1 : 1));
  expect(byService(total.dayServices)).toEqual(
    byService(
      report.reportServices.map(
        ({ serviceId, workedSeatCount, takingsCents, serviceMinutes }) => ({
          serviceId,
          workedSeatCount,
          takingsCents,
          serviceMinutes,
        }),
      ),
    ),
  );

  // The hour grid: the folded buckets, gridded by weekday, are the report's.
  expect(
    AnalyticsHourSystem.grid(
      folded.map((f) => ({
        localDate: f.localDate,
        worked: f.dayHourWorked,
        rostered: f.dayHourRostered,
      })),
    ),
  ).toEqual(report.reportHourGrid);

  // And the report's own day rows are the folds' rows, in date-then-barber order.
  expect(report.reportDayRows).toEqual(
    [...folded.map(DayFigures.rowOf)].sort(
      (a, b) =>
        (a.localDate < b.localDate ? -1 : a.localDate > b.localDate ? 1 : 0) ||
        (a.barberId < b.barberId ? -1 : a.barberId > b.barberId ? 1 : 0),
    ),
  );
}

describe('DayFiguresSystem — property P1: sum(days.map(fold)) === report(visits)', () => {
  it('holds for the shop and for each barber, over generated day sets', () => {
    fc.assert(
      fc.property(worldSpec, (spec) => {
        const world = worldOf(spec);
        expectSumAgrees(world, null);
        for (const barber of BARBERS) expectSumAgrees(world, barber);
      }),
      { numRuns: 40 },
    );
  });

  it('holds on a hand-built world with a party across both barbers', () => {
    const world: World = {
      days: [
        dayOf(ivan, day(-3), { rosteredMinutes: 540, workedMinutes: 60 }, [
          MinuteRange.of(minute(540), endMinute(1080)),
        ]),
        dayOf(niko, day(-3), { rosteredMinutes: 480, workedMinutes: 30 }, [
          MinuteRange.of(minute(600), endMinute(1080)),
        ]),
      ],
      visits: [
        visit(
          'party',
          day(-3),
          [
            seat(ivan, 2000, undefined, cut, 10, 100),
            seat(niko, 1500, undefined, beard, 10),
          ],
          {
            placement: Placement.Staff,
          },
        ),
        visit('solo', day(-3), [seat(ivan, 2500, undefined, cut, 12)]),
      ],
      followUps: [
        {
          bookedFromAppointmentId: AppointmentId.of('party'),
          bookedOnLocalDate: day(-2),
          followUpCancelled: false,
        },
      ],
    };
    expectSumAgrees(world, null);
    expectSumAgrees(world, ivan);
    expectSumAgrees(world, niko);
    // The party counts once per barber: the shop's staff origin is 2.
    const shop = StaffAnalyticsSystem.report(reportInput(world, null));
    expect(shop.reportOrigins).toEqual([
      { bookingOrigin: BookingOrigin.Online, visitCount: 1 },
      { bookingOrigin: BookingOrigin.Staff, visitCount: 2 },
      { bookingOrigin: BookingOrigin.Unknown, visitCount: 0 },
    ]);
    expect(shop.reportRebookedBase).toBe(3);
    expect(shop.reportRebookedCount).toBe(2);
  });
});
