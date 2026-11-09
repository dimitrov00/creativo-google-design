import {
  AnalyticsPeriod,
  type AppliedDiscount,
  BookingLifecycle,
  BookingPolicy,
  CancellationReason,
  CancellationReasonSet,
  CancelledBy,
  ClientStatsPolicy,
  Combinability,
  DayHours,
  DiscountMethod,
  DiscountSource,
  ExceptionEffectRule,
  type FlagName,
  LocationStatus,
  MinuteRange,
  Role,
  RosterBreak,
  Seat,
  SeatOccupant,
  SeatOutcome,
  ShiftSegment,
  SubjectRelationship,
  WriteAction,
} from '@core/components';
import type {
  Appointment,
  BarberAnalyticsDay,
  BarberBusyDay,
  BarberSchedule,
  ScheduleException,
  ShopLocation,
  StoredAnalyticsGoal,
  User,
} from '@core/entities';
import type { StaffAnalyticsPorts } from '@core/pipelines';
import {
  AppliedDiscountId,
  AppointmentId,
  BarberAnalyticsDayId,
  BarberBusyDayId,
  BarberId,
  BusyKey,
  Currency,
  type LocalDate,
  LocationId,
  MinuteCount,
  type PriceCents,
  Result,
  ScheduleExceptionId,
  SeatId,
  ServiceId,
  UserId,
  type UtcEpochMs,
  Weekday,
} from '@core/primitives';
import {
  type AnalyticsDay,
  type AnalyticsFollowUp,
  BusySystem,
  DayFiguresSystem,
  type ShopNowAt,
  StaffAnalyticsSystem,
  ZonedTimeSystem,
} from '@core/systems';
import {
  memoryAnalyticsDayPorts,
  memoryAnalyticsGoalPorts,
  memoryAnalyticsReadPorts,
  memoryProfileLoadPorts,
  memoryShopDayReadPorts,
} from './analytics-doubles';
import {
  at,
  locationFixture,
  termsFixture,
  until,
} from './booking-core.fixtures';
import { appointmentFixture, seatFixture } from './appointment.fixtures';
import { registeredUserFixture } from './identity.fixtures';
import {
  memoryClockPorts,
  memoryDefaultLocationPorts,
  memoryFlagsPorts,
} from './port-doubles';
import {
  FIXTURE_IDS,
  FIXTURE_NOW_UTC_MS,
  FIXTURE_TIME_ZONE,
  customerOf,
  hourCount,
  localDate,
  minute,
  recordingTelemetry,
  utcMs,
} from './test-support';

/*
 * THE ANALYTICS FIXTURE MONTH — design G5 («named figures agree»), one
 * shared world for the agreement specs: September 2026, read at the pinned
 * now (Monday 28 September, 09:00 in Sofia, `FIXTURE_NOW`), so the 1st to
 * the 27th are past, the 28th is cut at 09:00 and the 29th–30th are ahead.
 *
 * - **Three barbers at two shops.** Ivan — the centre, Mon–Fri 09:00–18:00
 *   with a 13:00–13:30 break, except Wednesday: 09:00–13:00 at the centre,
 *   14:00–18:00 at Mladost. Niko — Mladost, Mon–Fri 10:00–19:00. Maria —
 *   the centre, Tue–Fri 09:00–17:00, and Saturdays 10:00–16:00 at the OLD
 *   shop, which is hidden: the schedule does not offer it, so her Saturdays
 *   roster nothing (and her worked visit there is time outside hours).
 * - **Departures.** Ivan's Friday the 18th is BLOCKED 14:00–16:00; Niko's
 *   Friday the 4th is CLOSED.
 * - **Visits** (`ANALYTICS_FIXTURE_VISITS`), each named for what it proves:
 *   a solo cut with a tip (the 14th, rebooked by a follow-up), a seat over
 *   the break (the 14th, 13:00), a party split across Ivan and Maria with a
 *   3,33 € discount (an odd cent to share out, the 15th), a visit with one
 *   seat worked and one CANCELLED (not wholly cancelled — the cancelled seat
 *   holds the chair, the 17th), one client with three worked seats beside
 *   another's seat and a 3-cent discount (the 11th), a leva visit with a
 *   leva tip (the 10th), a no-show (the 21st), an unmarked past visit (the
 *   23rd), a worked visit at the hidden shop (Saturday the 19th), a late
 *   client cancellation (the 25th), today's 10:00 and tomorrow's booked
 *   ahead, August's worked visit (the hero's previous period) and the
 *   October follow-up booked from the solo cut on the day of the cut.
 */

/** The fixture month's barbers: Ivan is `FIXTURE_IDS.barber`. */
export const ANALYTICS_FIXTURE_BARBERS = {
  ivan: FIXTURE_IDS.barber,
  niko: BarberId.of('b-niko'),
  maria: BarberId.of('b-maria'),
} as const;

/** The two shops the schedule offers, and the hidden one it does not. */
export const ANALYTICS_FIXTURE_SHOPS = {
  centre: FIXTURE_IDS.location,
  mladost: LocationId.of('loc-mladost'),
  old: LocationId.of('loc-old'),
} as const;

/** The month reported on — September 2026 (a 1st, as `AnalyticsPeriod.of` requires). */
export const ANALYTICS_FIXTURE_MONTH: LocalDate = localDate('2026-09-01');

const { ivan, niko, maria } = ANALYTICS_FIXTURE_BARBERS;
const { centre, mladost, old } = ANALYTICS_FIXTURE_SHOPS;
const CUT = FIXTURE_IDS.service;
const BEARD = ServiceId.of('svc-beard');
const WORKED_AT = FIXTURE_NOW_UTC_MS;

/** The clients — each an account with its own client record (D29). */
const CLIENTS = {
  petar: UserId.of('u-petar'),
  georgi: UserId.of('u-georgi'),
  stefan: UserId.of('u-stefan'),
  alex: UserId.of('u-alex'),
  dimo: UserId.of('u-dimo'),
  boris: UserId.of('u-boris'),
} as const;

/** Every client record the fixture's seats name — whose lifetime spend is checked. */
export const ANALYTICS_FIXTURE_CUSTOMERS =
  Object.values(CLIENTS).map(customerOf);

/* ── The shops ──────────────────────────────────────────────────────────── */

const weekdays = (day: DayHours): readonly DayHours[] => [
  day,
  day,
  day,
  day,
  day,
  day,
  DayHours.closed(),
];

/** The centre (`locationFixture`, Mon–Sat 09:00–19:00), Mladost (Mon–Sat 10:00–20:00), the hidden old shop. */
export const ANALYTICS_FIXTURE_LOCATIONS: readonly ShopLocation[] = [
  locationFixture(),
  locationFixture({
    id: mladost,
    openingHours: weekdays(DayHours.open(at(10), until(20))),
    sortOrder: 1,
  }),
  locationFixture({
    id: old,
    openingHours: weekdays(DayHours.open(at(9), until(19))),
    locationStatus: LocationStatus.Hidden,
    sortOrder: 2,
  }),
];

/* ── The rosters ────────────────────────────────────────────────────────── */

function roster(
  barberId: BarberId,
  segments: readonly ShiftSegment[],
  breaks: readonly RosterBreak[] = [],
): BarberSchedule {
  return {
    id: barberId,
    turnaroundMinutes: MinuteCount.ZERO,
    versions: [
      {
        seq: 1,
        effectiveFromLocalDate: localDate('2026-01-01'),
        effectiveToLocalDate: null,
        segments,
        breaks,
      },
    ],
  };
}

const MON_TO_FRI = [
  Weekday.Mon,
  Weekday.Tue,
  Weekday.Wed,
  Weekday.Thu,
  Weekday.Fri,
] as const;

export const ANALYTICS_FIXTURE_ROSTERS: readonly BarberSchedule[] = [
  roster(
    ivan,
    [
      ...[Weekday.Mon, Weekday.Tue, Weekday.Thu, Weekday.Fri].map((day) =>
        ShiftSegment.of(day, centre, at(9), until(18)),
      ),
      ShiftSegment.of(Weekday.Wed, centre, at(9), until(13)),
      ShiftSegment.of(Weekday.Wed, mladost, at(14), until(18)),
    ],
    MON_TO_FRI.map((day) =>
      RosterBreak.of(day, MinuteRange.of(at(13), until(13, 30))),
    ),
  ),
  roster(
    niko,
    MON_TO_FRI.map((day) => ShiftSegment.of(day, mladost, at(10), until(19))),
  ),
  roster(maria, [
    ...[Weekday.Tue, Weekday.Wed, Weekday.Thu, Weekday.Fri].map((day) =>
      ShiftSegment.of(day, centre, at(9), until(17)),
    ),
    ShiftSegment.of(Weekday.Sat, old, at(10), until(16)),
  ]),
];

/* ── The departures ─────────────────────────────────────────────────────── */

function departure(
  barberId: BarberId,
  day: string,
  locationId: LocationId,
  rule: ExceptionEffectRule,
): ScheduleException {
  const date = localDate(day);
  return {
    id: ScheduleExceptionId.of(BusyKey.of(barberId, date)),
    barberId,
    localDate: date,
    utcEpochMs: ZonedTimeSystem.startOfLocalDay(date, FIXTURE_TIME_ZONE),
    locationId,
    ...rule,
    dayBreakRanges: null,
  } as ScheduleException;
}

const blockedRule = ExceptionEffectRule.blocked([
  MinuteRange.of(at(14), until(16)),
]);
if (!blockedRule.ok) throw new Error('a broken analytics fixture block');

/** Ivan's block on Friday the 18th; Niko's closed Friday the 4th. */
export const ANALYTICS_FIXTURE_DEPARTURES: readonly ScheduleException[] = [
  departure(ivan, '2026-09-18', centre, blockedRule.value),
  departure(niko, '2026-09-04', mladost, ExceptionEffectRule.closed()),
];

/* ── The visits ─────────────────────────────────────────────────────────── */

type SeatSpec = {
  readonly n: string;
  readonly barberId: BarberId;
  readonly client: UserId;
  readonly start: number;
  readonly priceCents: number;
  readonly outcome?: SeatOutcome;
  readonly serviceId?: ServiceId;
  readonly currency?: Currency;
  readonly tipCents?: number;
};

function seatOf(spec: SeatSpec): Seat {
  return seatFixture({
    seatId: SeatId.of(`s-${spec.n}`),
    barberId: spec.barberId,
    serviceId: spec.serviceId ?? CUT,
    startMinutes: minute(spec.start),
    tipCents:
      spec.tipCents === undefined ? null : (spec.tipCents as PriceCents),
    terms: Seat.termsOf(
      termsFixture(spec.priceCents, 30, 0, 0, spec.currency ?? Currency.EUR),
      null,
    ),
    occupant: SeatOccupant.account(
      spec.client,
      customerOf(spec.client),
      SubjectRelationship.Self,
    ),
    outcome: spec.outcome ?? SeatOutcome.scheduled(),
  });
}

/** A visit on `day` at `locationId`: its envelope, people, barbers and busy keys derived from its seats. */
function visitOf(
  id: string,
  day: string,
  locationId: LocationId,
  specs: readonly SeatSpec[],
  extra: Parameters<typeof appointmentFixture>[0] = {},
): Appointment {
  const date = localDate(day);
  const seats = specs.map(seatOf);
  const first = seats[0] as Seat;
  const last = seats[seats.length - 1] as Seat;
  const barbers = [...new Set(seats.map((seat) => seat.barberId))];
  const people = [...new Set(specs.map((spec) => spec.client))];
  const owner = people[0];
  if (owner === undefined) throw new Error(`a visit with no seat: ${id}`);
  const start = ZonedTimeSystem.toUtc(
    date,
    first.startMinutes,
    FIXTURE_TIME_ZONE,
  );
  if (!start.ok) throw new Error(`a broken analytics fixture visit ${id}`);
  const bookedAtUtcMs = ZonedTimeSystem.startOfLocalDay(
    localDate('2026-08-01'),
    FIXTURE_TIME_ZONE,
  );
  return appointmentFixture({
    id: AppointmentId.of(id),
    locationId,
    localDate: date,
    startMinutes: first.startMinutes,
    endMinutes: Seat.endMinutes(last),
    utcEpochMs: start.value,
    ownerUserId: owner,
    subjectUserIds: people,
    ownerCustomerId: customerOf(owner),
    subjectCustomerIds: people.map(customerOf),
    seats,
    barberIds: barbers,
    busyKeys: barbers.map((barber) => BusyKey.of(barber, date)),
    bookedAtUtcMs,
    lifecycle: BookingLifecycle.confirm(bookedAtUtcMs),
    ...extra,
  });
}

const worked = SeatOutcome.worked(WORKED_AT);
const noShow = SeatOutcome.noShow(WORKED_AT);

function fixedOff(amountCents: number): AppliedDiscount {
  return {
    discountId: AppliedDiscountId.of(`off-${amountCents}`),
    label: 'Counter',
    appliedAtUtcMs: WORKED_AT,
    combinability: Combinability.Stackable,
    discountSource: DiscountSource.Manual,
    discountMethod: DiscountMethod.FixedAmount,
    discountAmountCents: amountCents,
    discountCurrency: Currency.EUR,
  } as AppliedDiscount;
}

/** The late cancellation: Boris called it off at 08:00 for 10:00, under a 24-hour window. */
const LATE_CANCEL_AT: UtcEpochMs = utcMs('2026-09-25T08:00:00.000+03:00');

/** The solo cut the follow-up was booked from. */
const SOLO = visitOf('an-solo', '2026-09-14', centre, [
  {
    n: 'solo',
    barberId: ivan,
    client: CLIENTS.petar,
    start: 600,
    priceCents: 2800,
    outcome: worked,
    tipCents: 300,
  },
]);

/** Every visit of the fixture world — the period's, August's, the days ahead and the October follow-up. */
export const ANALYTICS_FIXTURE_VISITS: readonly Appointment[] = [
  SOLO,
  visitOf('an-over-break', '2026-09-14', centre, [
    {
      n: 'over-break',
      barberId: ivan,
      client: CLIENTS.georgi,
      start: 780,
      priceCents: 1750,
      serviceId: BEARD,
      outcome: worked,
    },
  ]),
  visitOf(
    'an-party',
    '2026-09-15',
    centre,
    [
      {
        n: 'party-ivan',
        barberId: ivan,
        client: CLIENTS.stefan,
        start: 660,
        priceCents: 2500,
        outcome: worked,
      },
      {
        n: 'party-maria',
        barberId: maria,
        client: CLIENTS.alex,
        start: 660,
        priceCents: 3000,
        outcome: worked,
        tipCents: 200,
      },
    ],
    { discounts: [fixedOff(333)] },
  ),
  visitOf('an-held', '2026-09-17', centre, [
    {
      n: 'held-worked',
      barberId: ivan,
      client: CLIENTS.dimo,
      start: 600,
      priceCents: 2800,
      outcome: worked,
    },
    {
      n: 'held-cancelled',
      barberId: ivan,
      client: CLIENTS.boris,
      start: 630,
      priceCents: 2800,
      outcome: SeatOutcome.cancelled(
        utcMs('2026-09-16T18:00:00.000+03:00'),
        CancelledBy.Client,
        CancellationReason.ClientChangedPlans,
        hourCount(24),
      ),
    },
  ]),
  visitOf(
    'an-three-seats',
    '2026-09-11',
    centre,
    [
      {
        n: 'three-boris',
        barberId: ivan,
        client: CLIENTS.boris,
        start: 600,
        priceCents: 1000,
        outcome: worked,
      },
      ...[630, 660, 690].map((start, i) => ({
        n: `three-petar-${i + 1}`,
        barberId: ivan,
        client: CLIENTS.petar,
        start,
        priceCents: 1000,
        outcome: worked,
      })),
    ],
    { discounts: [fixedOff(3)] },
  ),
  visitOf('an-leva', '2026-09-10', mladost, [
    {
      n: 'leva',
      barberId: niko,
      client: CLIENTS.georgi,
      start: 660,
      priceCents: 3912,
      currency: Currency.BGN,
      tipCents: 978,
      outcome: worked,
    },
  ]),
  visitOf('an-no-show', '2026-09-21', mladost, [
    {
      n: 'no-show',
      barberId: niko,
      client: CLIENTS.stefan,
      start: 720,
      priceCents: 2800,
      outcome: noShow,
    },
  ]),
  visitOf('an-unmarked', '2026-09-23', centre, [
    {
      n: 'unmarked',
      barberId: maria,
      client: CLIENTS.alex,
      start: 900,
      priceCents: 2800,
    },
  ]),
  visitOf('an-old-shop', '2026-09-19', old, [
    {
      n: 'old-shop',
      barberId: maria,
      client: CLIENTS.dimo,
      start: 660,
      priceCents: 2800,
      outcome: worked,
    },
  ]),
  visitOf(
    'an-late-cancel',
    '2026-09-25',
    mladost,
    [
      {
        n: 'late-cancel',
        barberId: niko,
        client: CLIENTS.boris,
        start: 600,
        priceCents: 2800,
        outcome: SeatOutcome.cancelled(
          LATE_CANCEL_AT,
          CancelledBy.Client,
          CancellationReason.ClientChangedPlans,
          hourCount(24),
        ),
      },
    ],
    {
      lifecycle: BookingLifecycle.cancel(
        LATE_CANCEL_AT,
        CancellationReasonSet.of([CancellationReason.ClientChangedPlans]),
      ),
    },
  ),
  visitOf('an-today', '2026-09-28', centre, [
    {
      n: 'today',
      barberId: ivan,
      client: CLIENTS.georgi,
      start: 600,
      priceCents: 2800,
    },
  ]),
  visitOf('an-ahead', '2026-09-29', mladost, [
    {
      n: 'ahead',
      barberId: niko,
      client: CLIENTS.dimo,
      start: 840,
      priceCents: 2800,
    },
  ]),
  visitOf('an-august', '2026-08-17', centre, [
    {
      n: 'august',
      barberId: ivan,
      client: CLIENTS.petar,
      start: 600,
      priceCents: 2800,
      outcome: worked,
    },
  ]),
  visitOf(
    'an-follow-up',
    '2026-10-12',
    centre,
    [
      {
        n: 'follow-up',
        barberId: ivan,
        client: CLIENTS.petar,
        start: 600,
        priceCents: 2800,
      },
    ],
    {
      bookedFromAppointmentId: SOLO.id,
      bookedAtUtcMs: utcMs('2026-09-14T11:00:00.000+03:00'),
    },
  ),
];

/* ── The people who ask ─────────────────────────────────────────────────── */

/** The admin (the shop's view) and one linked account per barber. */
export const ANALYTICS_FIXTURE_USERS = {
  admin: registeredUserFixture({
    id: UserId.of('u-an-admin'),
    roles: [Role.Admin],
  }),
  ivan: registeredUserFixture({
    id: UserId.of('u-an-ivan'),
    roles: [Role.Barber],
    linkedBarberId: ivan,
  }),
  niko: registeredUserFixture({
    id: UserId.of('u-an-niko'),
    roles: [Role.Barber],
    linkedBarberId: niko,
  }),
  maria: registeredUserFixture({
    id: UserId.of('u-an-maria'),
    roles: [Role.Barber],
    linkedBarberId: maria,
  }),
} as const;

/** What `analyticsFixturePorts` holds beside the fixture month: the day documents stored, and the flags on (none when omitted). */
export type AnalyticsFixtureWorld = {
  readonly storedDays?: readonly BarberAnalyticsDay[];
  readonly flagsOn?: readonly FlagName[];
  /** The month goals stored (PR 6); none by default. */
  readonly goals?: readonly StoredAnalyticsGoal[];
};

/**
 * `staffAnalytics`' ports over the fixture month, at the pinned now: the
 * reads answering as the Firestore adapters do (`memoryAnalyticsReadPorts`,
 * `memoryAnalyticsDayPorts` over `world.storedDays`), the flags of
 * `world.flagsOn` on (`analytics.storedDays` off by default — every day
 * computed live), the default shop the centre, the policy the default one.
 */
export function analyticsFixturePorts(
  world: AnalyticsFixtureWorld = {},
): StaffAnalyticsPorts {
  const analytics = memoryAnalyticsReadPorts({
    visits: ANALYTICS_FIXTURE_VISITS,
    departures: ANALYTICS_FIXTURE_DEPARTURES,
    barberIds: [ivan, maria, niko],
    locations: ANALYTICS_FIXTURE_LOCATIONS,
  });
  const days = memoryAnalyticsDayPorts({ days: world.storedDays ?? [] });
  return {
    ...analytics.ports,
    ...days.ports,
    ...memoryAnalyticsGoalPorts(world.goals ?? []).ports,
    ...memoryFlagsPorts(world.flagsOn ?? []),
    ...memoryProfileLoadPorts(Object.values(ANALYTICS_FIXTURE_USERS) as User[]),
    ...memoryShopDayReadPorts(ANALYTICS_FIXTURE_ROSTERS),
    loadPolicy: async () => Result.ok(BookingPolicy.DEFAULT),
    ...memoryDefaultLocationPorts(centre),
    ...memoryClockPorts(FIXTURE_NOW_UTC_MS),
    log: recordingTelemetry().log,
  };
}

/**
 * The busy projection of the fixture world, as the server's rebuild writes
 * it (`BusySystem.rebuild`, one document per barber-day a live visit
 * occupies) — what the schedule's lanes read beside the visits.
 */
export function analyticsFixtureBusyDays(): readonly BarberBusyDay[] {
  const keys = new Set<BusyKey>();
  for (const visit of ANALYTICS_FIXTURE_VISITS) {
    for (const key of visit.busyKeys) keys.add(key);
  }
  const days: BarberBusyDay[] = [];
  for (const key of keys) {
    const write = BusySystem.rebuild(key, ANALYTICS_FIXTURE_VISITS, (date) =>
      ZonedTimeSystem.startOfLocalDay(date, FIXTURE_TIME_ZONE),
    );
    if (write === null || write.writeAction !== WriteAction.Set) continue;
    days.push({
      id: BarberBusyDayId.of(key),
      ...write.body,
    } as BarberBusyDay);
  }
  return days;
}

/* ── The day documents (staff analytics v2, PR 4a) ──────────────────────── */

/** Every shop's clock at the pinned now — every fixture shop reads `FIXTURE_TIME_ZONE`. */
function analyticsFixtureNowByLocation(): readonly ShopNowAt[] {
  const now = ZonedTimeSystem.shopNow(FIXTURE_NOW_UTC_MS, FIXTURE_TIME_ZONE);
  return ANALYTICS_FIXTURE_LOCATIONS.map((location) => ({
    locationId: location.id,
    ...now,
  }));
}

/**
 * Every barber-day of the fixture month, as `StaffAnalyticsSystem.daysOf`
 * cuts it at the pinned now (Monday the 28th, 09:00): the 1st to the 26th
 * are PAST, the 27th to the 30th live.
 */
export function analyticsFixtureDays(): readonly AnalyticsDay[] {
  const now = ZonedTimeSystem.shopNow(FIXTURE_NOW_UTC_MS, FIXTURE_TIME_ZONE);
  return StaffAnalyticsSystem.daysOf({
    barberIds: [ivan, maria, niko],
    localDates: AnalyticsPeriod.days(
      AnalyticsPeriod.monthOf(ANALYTICS_FIXTURE_MONTH),
    ),
    rosters: ANALYTICS_FIXTURE_ROSTERS,
    departures: ANALYTICS_FIXTURE_DEPARTURES,
    locations: ANALYTICS_FIXTURE_LOCATIONS,
    visits: ANALYTICS_FIXTURE_VISITS,
    nowByLocation: analyticsFixtureNowByLocation(),
    now,
  });
}

/** The fixture world's follow-ups, each booking day read once on the fixture zone — as the pipeline reads them. */
export function analyticsFixtureFollowUps(): readonly AnalyticsFollowUp[] {
  const out: AnalyticsFollowUp[] = [];
  for (const visit of ANALYTICS_FIXTURE_VISITS) {
    if (!StaffAnalyticsSystem.isCountedFollowUp(visit)) continue;
    out.push(
      StaffAnalyticsSystem.followUpOf(
        visit,
        ZonedTimeSystem.toLocal(visit.bookedAtUtcMs, FIXTURE_TIME_ZONE)
          .localDate,
      ),
    );
  }
  return out;
}

/**
 * The day documents of the fixture month — `DayFiguresSystem.fold` over its
 * PAST barber-days (the 1st to the 26th, 78 documents, zeros included),
 * keyed by busy key and stamped at the pinned now: what the recompute would
 * have written, for the pipelines' reads.
 */
export function analyticsFixtureDayDocuments(): readonly BarberAnalyticsDay[] {
  const followUps = analyticsFixtureFollowUps();
  const policy = ClientStatsPolicy.forBooking(BookingPolicy.DEFAULT);
  const out: BarberAnalyticsDay[] = [];
  for (const day of analyticsFixtureDays()) {
    if (!day.pastDay) continue;
    out.push({
      id: BarberAnalyticsDayId.of(BusyKey.of(day.barberId, day.localDate)),
      ...DayFiguresSystem.fold({
        day,
        visits: ANALYTICS_FIXTURE_VISITS,
        followUps,
        policy,
        computedAtUtcMs: FIXTURE_NOW_UTC_MS,
      }),
    });
  }
  return out;
}
