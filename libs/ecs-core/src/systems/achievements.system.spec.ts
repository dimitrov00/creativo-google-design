import { describe, expect, it } from 'vitest';
import {
  EarnedVia,
  type EarnedLevel,
  Metric,
  MetricRef,
  SeasonPhase,
  SeatOccupant,
  SeatOutcome,
  SubjectRelationship,
} from '@core/components';
import type { BadgeProgress, BadgeSeries } from '@core/entities';
import {
  Weekday,
  AppointmentId,
  BadgeSeriesId,
  BarberId,
  LocationId,
  SeatId,
  ServiceId,
  MinuteDelta,
  UserId,
  UtcEpochMs,
} from '@core/primitives';
import {
  FIXTURE_IDS,
  type LoyaltyClientFixture,
  appointmentFixture,
  customerOf,
  deepFreeze,
  localDate,
  loyaltyAccountFixtures,
  loyaltyCatalogFixture,
  minute,
  seatFixture,
  unwrapOk,
  utcMs,
} from '@core/testing';
import {
  AchievementsSystem,
  type CountedDraft,
  type CountedVisit,
  type DraftVisit,
} from './achievements.system';
import { BadgeSystem } from './badge.system';
import { LoyaltyCatalogSystem } from './loyalty-catalog.system';
import { SeasonSystem } from './season.system';

/*
 * The `countsToward` cases of
 * libs/features/staff/client-card/src/lib/medal-detail.presenter.spec.ts,
 * COPIED (the presenter's spec keeps running against its shim) and
 * re-targeted to the struct the system reads: the person's own worked
 * seats (services, barbers), the shop, and the first worked seat's start
 * on the shop's clock. Which seats are the person's and worked, and when
 * the first began in Sofia, is the presenter's read of an appointment (the
 * cases about another person's book, an unfinished companion and an hour
 * to come stay with its spec); the narrowing and every metric's test are
 * here — on the shop's wall clock (early bird, weekend) and on the two
 * stamps (on time, T2). Plus `insideWindows` and the purity case.
 */

/** What a family counts — the flat `MetricRef` slice, scoped by the parts given. */
const by = (
  metric: Metric,
  scope: {
    readonly serviceId?: ServiceId;
    readonly barberId?: BarberId;
    readonly locationId?: LocationId;
  } = {},
): MetricRef => ({
  ...MetricRef.of(metric),
  metricScopeServiceId: scope.serviceId ?? null,
  metricScopeBarberId: scope.barberId ?? null,
  metricScopeLocationId: scope.locationId ?? null,
});

const minutesFrom = (start: UtcEpochMs, minutes: number): UtcEpochMs =>
  UtcEpochMs.plusMinutes(start, unwrapOk(MinuteDelta.of(minutes)));

/** A fade with Иван at Център, 11:00 on Thursday 10 September, alone, never marked arrived. */
function visit(overrides: Partial<CountedVisit> = {}): CountedVisit {
  return {
    serviceIds: [ServiceId.of('svc-fade')],
    barberIds: [BarberId.of('ivan')],
    locationId: LocationId.of('loc-center'),
    localDate: localDate('2026-09-10'),
    startMinutes: minute(11 * 60),
    weekday: Weekday.Thu,
    startUtcMs: utcMs('2026-09-10T08:00:00.000Z'),
    arrivedAtUtcMs: null,
    withCompany: false,
    ...overrides,
  };
}

const VISITS = by(Metric.VisitsCompleted);
const FADE = by(Metric.VisitsCompleted, {
  serviceId: ServiceId.of('svc-fade'),
});
const CLASSIC = by(Metric.VisitsCompleted, {
  serviceId: ServiceId.of('svc-classic-cut'),
});
const NIKO = by(Metric.VisitsCompleted, { barberId: BarberId.of('niko') });
const IVAN = by(Metric.VisitsCompleted, { barberId: BarberId.of('ivan') });
const MLADOST = by(Metric.VisitsCompleted, {
  locationId: LocationId.of('loc-mladost'),
});
const CENTER = by(Metric.VisitsCompleted, {
  locationId: LocationId.of('loc-center'),
});

describe('AchievementsSystem.countsToward', () => {
  it('counts any worked visit towards the visits family, and the family’s own service, barber and shop', () => {
    for (const metric of [VISITS, FADE, IVAN, CENTER]) {
      expect(AchievementsSystem.countsToward(metric, visit())).toBe(true);
    }
  });

  it('asks for the service, the barber and the shop among the person’s own worked seats', () => {
    expect(AchievementsSystem.countsToward(CLASSIC, visit())).toBe(false);
    expect(AchievementsSystem.countsToward(NIKO, visit())).toBe(false);
    expect(AchievementsSystem.countsToward(MLADOST, visit())).toBe(false);
    // A companion's fade is not the booker's: his own seat was a beard.
    const booker = visit({
      serviceIds: [ServiceId.of('svc-beard')],
      withCompany: true,
    });
    const companion = visit({
      barberIds: [BarberId.of('niko')],
      withCompany: true,
    });
    expect(AchievementsSystem.countsToward(FADE, booker)).toBe(false);
    expect(AchievementsSystem.countsToward(FADE, companion)).toBe(true);
    expect(AchievementsSystem.countsToward(NIKO, booker)).toBe(false);
    expect(AchievementsSystem.countsToward(NIKO, companion)).toBe(true);
  });

  it('reads an early bird by when the person’s own first worked seat began: by 10:00', () => {
    const early = by(Metric.VisitsEarlyBird);
    expect(
      AchievementsSystem.countsToward(
        early,
        visit({ startMinutes: minute(600) }),
      ),
    ).toBe(true);
    expect(
      AchievementsSystem.countsToward(
        early,
        visit({ startMinutes: minute(605) }),
      ),
    ).toBe(false);
    // The booker sat at 9:30; the companion's own seat began at 10:15.
    expect(
      AchievementsSystem.countsToward(
        early,
        visit({ startMinutes: minute(570) }),
      ),
    ).toBe(true);
    expect(
      AchievementsSystem.countsToward(
        early,
        visit({ startMinutes: minute(615) }),
      ),
    ).toBe(false);
  });

  it('reads a weekend visit off the shop’s calendar: Saturday and Sunday', () => {
    const weekend = by(Metric.VisitsWeekend);
    const days: readonly (readonly [Weekday, boolean])[] = [
      [Weekday.Fri, false],
      [Weekday.Sat, true],
      [Weekday.Sun, true],
      [Weekday.Mon, false],
    ];
    for (const [day, counts] of days) {
      expect([
        day,
        AchievementsSystem.countsToward(weekend, visit({ weekday: day })),
      ]).toEqual([day, counts]);
    }
  });

  it('counts a punctual visit only when the arrival was marked, by the start', () => {
    const onTime = by(Metric.VisitsOnTime);
    const start = visit().startUtcMs;
    expect(AchievementsSystem.countsToward(onTime, visit())).toBe(false);
    expect(
      AchievementsSystem.countsToward(
        onTime,
        visit({ arrivedAtUtcMs: minutesFrom(start, -5) }),
      ),
    ).toBe(true);
    expect(
      AchievementsSystem.countsToward(onTime, visit({ arrivedAtUtcMs: start })),
    ).toBe(true);
    expect(
      AchievementsSystem.countsToward(
        onTime,
        visit({ arrivedAtUtcMs: minutesFrom(start, 5) }),
      ),
    ).toBe(false);
  });

  it('counts a visit with company only when someone else holds a seat on it', () => {
    const party = by(Metric.VisitsParty);
    expect(AchievementsSystem.countsToward(party, visit())).toBe(false);
    expect(
      AchievementsSystem.countsToward(party, visit({ withCompany: true })),
    ).toBe(true);
    // Two services of his own are not company.
    expect(
      AchievementsSystem.countsToward(
        party,
        visit({
          serviceIds: [ServiceId.of('svc-fade'), ServiceId.of('svc-beard')],
        }),
      ),
    ).toBe(false);
  });

  it('answers no for a family that counts no single visit', () => {
    // Today's `metric: null` — a single act, the rhythm — is the all-null slice.
    expect(AchievementsSystem.countsToward(MetricRef.none(), visit())).toBe(
      false,
    );
    for (const metric of [
      Metric.TenureDays,
      Metric.BookingsSelfService,
      Metric.ReferralsCompleted,
      Metric.WaitlistBooked,
      Metric.ServicesDistinct,
      Metric.BarbersDistinct,
      Metric.LocationsDistinct,
      Metric.MonthsDistinct,
      Metric.SpendMajor,
      Metric.PointsLifetime,
      Metric.ShopBookingsCreated,
    ]) {
      expect([
        metric,
        AchievementsSystem.countsToward(by(metric), visit()),
      ]).toEqual([metric, false]);
    }
  });
});

describe('AchievementsSystem.insideWindows', () => {
  const TODAY = localDate('2026-09-28');
  const autumn = {
    windowFrom: localDate('2026-09-01'),
    windowUntil: localDate('2026-11-30'),
  };

  it('counts a season’s family inside the season only, and nothing for a season the catalogue lacks', () => {
    expect(
      AchievementsSystem.insideWindows(
        autumn,
        true,
        null,
        localDate('2026-09-10'),
        TODAY,
      ),
    ).toBe(true);
    expect(
      AchievementsSystem.insideWindows(
        autumn,
        true,
        null,
        localDate('2026-08-31'),
        TODAY,
      ),
    ).toBe(false);
    expect(
      AchievementsSystem.insideWindows(
        null,
        true,
        null,
        localDate('2026-09-10'),
        TODAY,
      ),
    ).toBe(false);
    expect(
      AchievementsSystem.insideWindows(
        null,
        false,
        null,
        localDate('2020-01-01'),
        TODAY,
      ),
    ).toBe(true);
  });

  it('counts the last `lastDays` days of the metric’s own window, today included', () => {
    const year = 365;
    expect(
      AchievementsSystem.insideWindows(
        null,
        false,
        year,
        localDate('2025-09-29'),
        TODAY,
      ),
    ).toBe(true);
    expect(
      AchievementsSystem.insideWindows(
        null,
        false,
        year,
        localDate('2025-09-28'),
        TODAY,
      ),
    ).toBe(false);
  });
});

describe('AchievementsSystem purity', () => {
  it('is pure: same input → same output, inputs untouched', () => {
    const counted = deepFreeze(visit({ withCompany: true }));
    const metric = deepFreeze(FADE);
    expect(AchievementsSystem.countsToward(metric, counted)).toBe(
      AchievementsSystem.countsToward(metric, counted),
    );
  });
});

/*
 * THE VISIT ON SCREEN AND THE VISITS THAT COUNTED (Law 10.2, §2.4: M-1,
 * M-6, M-30, M-31, M-32, M-39) — the cases of `achievements.presenter.spec.ts`
 * («с това посещение», `completesWithThisVisit`) and
 * `medal-detail.presenter.spec.ts` (`countsToward`'s read of an appointment,
 * the draft that counts, the dock's verb, «Броени посещения») re-stated as
 * the facts, flags, ids and visits the presenters now word — on the same
 * catalogue and Георги's and Мартин's progress, the visit on screen as its
 * draft holds it once the edge has read it on the shop's clock.
 */

const CATALOG = unwrapOk(
  LoyaltyCatalogSystem.validate(loyaltyCatalogFixture()),
);
const TODAY = localDate('2026-09-28');
const GEORGI = loyaltyAccountFixtures.georgi;
const MARTIN = loyaltyAccountFixtures.martin;

function family(id: string): BadgeSeries {
  const found = LoyaltyCatalogSystem.series(CATALOG, BadgeSeriesId.of(id));
  if (found === null) throw new Error(`no family ${id}`);
  return found;
}

function progressOf(
  holder: LoyaltyClientFixture,
  id: string,
): BadgeProgress | null {
  return holder.badgeProgress.find((held) => held.id === id) ?? null;
}

/** The phase of the family's season on the card's today; `null` = no season, or one the catalogue lacks. */
function phaseOf(series: BadgeSeries): SeasonPhase | null {
  if (series.seasonId === null) return null;
  const season = LoyaltyCatalogSystem.season(CATALOG, series.seasonId);
  return season === null ? null : SeasonSystem.phaseOn(season, TODAY);
}

const earned = (level: number, on: string): EarnedLevel => ({
  level,
  earnedAtUtcMs: utcMs(`${on}T08:00:00.000Z`),
  earnedLocalDate: localDate(on),
  earnedVia: EarnedVia.Rule,
  count: 1,
});

/** Георги's next fade with Иван at Център, opened early: 10:00 on Friday 2 October. */
const GEORGI_DRAFT: DraftVisit = {
  serviceIds: [ServiceId.of('svc-fade')],
  barberIds: [BarberId.of('ivan')],
  locationId: LocationId.of('loc-center'),
  startMinutes: minute(600),
  birthdayToday: false,
};

/** Мартин's classic cut with Иван at Център, in the chair today at 12:30 — his birthday. */
const MARTIN_DRAFT: DraftVisit = {
  serviceIds: [ServiceId.of('svc-classic-cut')],
  barberIds: [BarberId.of('ivan')],
  locationId: LocationId.of('loc-center'),
  startMinutes: minute(750),
  birthdayToday: true,
};

describe('AchievementsSystem.completesWithVisit — «с това посещение» (M-6)', () => {
  const completes = (holder: LoyaltyClientFixture, draft: DraftVisit) =>
    CATALOG.families
      .filter((series) => {
        const progress = progressOf(holder, series.id);
        return AchievementsSystem.completesWithVisit(
          series,
          BadgeSystem.standing(series, progress),
          BadgeSystem.latestEarned(progress),
          draft,
          phaseOf(series),
          TODAY,
        );
      })
      .map((series): string => series.id)
      .sort();

  it('names every family one short on a count the open visit moves', () => {
    // 24/25 on every visit count; the autumn track at 2/3; the event's
    // beard is not in this visit; on time, a weekend and company never.
    expect(completes(GEORGI, GEORGI_DRAFT)).toEqual([
      'series-2026-autumn-track',
      'series-barber-ivan',
      'series-early-bird',
      'series-shop-center',
      'series-svc-fade',
      'series-visits',
    ]);
  });

  it('holds a service, a barber and a shop to the visit’s own, and 12:00 to no early bird', () => {
    const elsewhere: DraftVisit = {
      serviceIds: [ServiceId.of('svc-beard')],
      barberIds: [BarberId.of('niko')],
      locationId: LocationId.of('loc-mladost'),
      startMinutes: minute(720),
      birthdayToday: false,
    };
    expect(completes(GEORGI, elsewhere)).toEqual([
      'series-2026-autumn-track',
      'series-2026-beard-week-beard',
      'series-barber-niko',
      'series-shop-mladost',
      'series-visits',
    ]);
  });

  it('completes the birthday visit on the client’s birthday', () => {
    expect(completes(MARTIN, MARTIN_DRAFT)).toEqual([
      'series-2026-autumn-track',
      'series-birthday',
    ]);
    expect(
      completes(MARTIN, { ...MARTIN_DRAFT, birthdayToday: false }),
    ).toEqual(['series-2026-autumn-track']);
  });

  it('completes the yearly act once a year: earned last year yes, this year no', () => {
    const birthday = family('series-birthday');
    const once = (on: string) =>
      AchievementsSystem.completesWithVisit(
        birthday,
        BadgeSystem.standing(birthday, {
          value: 1,
          earned: [earned(1, on)],
        }),
        earned(1, on),
        MARTIN_DRAFT,
        null,
        TODAY,
      );
    expect(once('2025-09-28')).toBe(true);
    expect(once('2026-01-02')).toBe(false);
    expect(once('2025-12-31')).toBe(true);
  });

  it('completes a season’s family only while its season is OPEN — a season that does not resolve never', () => {
    const track = family('series-2026-autumn-track');
    const standing = BadgeSystem.standing(
      track,
      progressOf(GEORGI, 'series-2026-autumn-track'),
    );
    const on = (phase: SeasonPhase | null) =>
      AchievementsSystem.completesWithVisit(
        track,
        standing,
        null,
        GEORGI_DRAFT,
        phase,
        TODAY,
      );
    expect(on(SeasonPhase.Open)).toBe(true);
    expect(on(SeasonPhase.Announced)).toBe(false);
    expect(on(SeasonPhase.Ended)).toBe(false);
    expect(on(null)).toBe(false);
    // A family with no season ignores the phase.
    const visits = family('series-visits');
    expect(
      AchievementsSystem.completesWithVisit(
        visits,
        BadgeSystem.standing(visits, progressOf(GEORGI, 'series-visits')),
        null,
        GEORGI_DRAFT,
        null,
        TODAY,
      ),
    ).toBe(true);
  });

  it('completes a level one short only, never a retired or calendar-driven family', () => {
    const fade = family('series-svc-fade');
    const at = (value: number) =>
      AchievementsSystem.completesWithVisit(
        fade,
        BadgeSystem.standing(fade, {
          value,
          earned: [earned(1, '2025-04-21'), earned(2, '2025-09-22')],
        }),
        null,
        GEORGI_DRAFT,
        null,
        TODAY,
      );
    expect(at(24)).toBe(true);
    expect(at(23)).toBe(false);
    // A level due and not yet stamped completes too.
    expect(at(25)).toBe(true);
    const retired = {
      ...fade,
      retiredAtUtcMs: utcMs('2026-09-01T00:00:00.000Z'),
      retiredLocalDate: localDate('2026-09-01'),
    };
    expect(
      AchievementsSystem.completesWithVisit(
        retired,
        BadgeSystem.standing(retired, progressOf(GEORGI, 'series-svc-fade')),
        null,
        GEORGI_DRAFT,
        null,
        TODAY,
      ),
    ).toBe(false);
    const tenure = family('series-tenure');
    expect(
      AchievementsSystem.completesWithVisit(
        tenure,
        { next: tenure.levels[1] ?? null, target: 730, value: 729 },
        null,
        GEORGI_DRAFT,
        null,
        TODAY,
      ),
    ).toBe(false);
  });

  it('reads the FIRST scope only (service › barber › shop) — not countsToward’s every scope', () => {
    const fade = family('series-svc-fade');
    // A fade with Niko at Младост still completes a fade family narrowed to Niko too.
    const narrowed: BadgeSeries = {
      ...fade,
      metricScopeBarberId: BarberId.of('niko'),
      metricScopeLocationId: LocationId.of('loc-mladost'),
    };
    const standing = BadgeSystem.standing(
      narrowed,
      progressOf(GEORGI, 'series-svc-fade'),
    );
    expect(
      AchievementsSystem.completesWithVisit(
        narrowed,
        standing,
        null,
        GEORGI_DRAFT,
        null,
        TODAY,
      ),
    ).toBe(true);
    expect(
      AchievementsSystem.countsToward(
        narrowed,
        AchievementsSystem.countedDraft({
          start: null,
          serviceIds: GEORGI_DRAFT.serviceIds,
          barberIds: GEORGI_DRAFT.barberIds,
          locationId: GEORGI_DRAFT.locationId,
        }),
      ),
    ).toBe(false);
  });

  it('reads an early bird by the earliest leg’s MINUTE, by 10:00, whatever the scopes', () => {
    const early = family('series-early-bird');
    const scoped: BadgeSeries = {
      ...early,
      metricScopeLocationId: LocationId.of('loc-mladost'),
    };
    const standing = BadgeSystem.standing(
      early,
      progressOf(GEORGI, 'series-early-bird'),
    );
    const at = (startMinutes: DraftVisit['startMinutes']) =>
      AchievementsSystem.completesWithVisit(
        scoped,
        standing,
        null,
        { ...GEORGI_DRAFT, startMinutes },
        null,
        TODAY,
      );
    expect(AchievementsSystem.EARLY_BIRD_LAST_MINUTE).toBe(600);
    expect(at(minute(600))).toBe(true);
    expect(at(minute(601))).toBe(false);
    // No start yet: no early bird.
    expect(at(null)).toBe(false);
  });

  it('never completes a weekend, an on-time or a party count, one short or not', () => {
    for (const metric of [
      Metric.VisitsWeekend,
      Metric.VisitsOnTime,
      Metric.VisitsParty,
    ]) {
      const series: BadgeSeries = { ...family('series-visits'), metric };
      expect([
        metric,
        AchievementsSystem.completesWithVisit(
          series,
          BadgeSystem.standing(series, progressOf(GEORGI, 'series-visits')),
          null,
          GEORGI_DRAFT,
          null,
          TODAY,
        ),
      ]).toEqual([metric, false]);
    }
  });
});

describe('AchievementsSystem.workedVisitOf — one appointment as the person’s worked visit (M-30)', () => {
  const me = FIXTURE_IDS.customer;
  const friendUser = UserId.of('u-friend');
  const friend = customerOf(friendUser);
  const at = utcMs('2026-09-28T09:00:00.000Z');
  const friendSeat = (outcome: SeatOutcome) =>
    seatFixture({
      seatId: SeatId.of('seat-2'),
      serviceId: ServiceId.of('svc-beard'),
      barberId: BarberId.of('niko'),
      startMinutes: minute(570),
      occupant: SeatOccupant.account(
        friendUser,
        friend,
        SubjectRelationship.Companion,
      ),
      outcome,
    });

  it('reads the person’s own worked seats: services, barbers, the shop, the day, the start', () => {
    const visit = appointmentFixture({
      seats: [seatFixture({ outcome: SeatOutcome.worked(at) })],
      arrivedAtUtcMs: at,
    });
    expect(AchievementsSystem.workedVisitOf(visit, me)).toEqual({
      serviceIds: [FIXTURE_IDS.service],
      barberIds: [FIXTURE_IDS.barber],
      locationId: FIXTURE_IDS.location,
      localDate: '2026-09-28',
      startMinutes: 600,
      weekday: Weekday.Mon,
      arrivedAtUtcMs: at,
      withCompany: false,
    });
  });

  it('counts only a worked visit: never an hour still to come, a cancelled one or a no-show', () => {
    for (const outcome of [SeatOutcome.scheduled(), SeatOutcome.noShow(at)]) {
      expect(
        AchievementsSystem.workedVisitOf(
          appointmentFixture({ seats: [seatFixture({ outcome })] }),
          me,
        ),
      ).toBeNull();
    }
  });

  it('reads nothing off another person’s book', () => {
    const visit = appointmentFixture({
      seats: [friendSeat(SeatOutcome.worked(at))],
    });
    expect(AchievementsSystem.workedVisitOf(visit, me)).toBeNull();
    expect(AchievementsSystem.workedVisitOf(visit, friend)).toMatchObject({
      serviceIds: ['svc-beard'],
      withCompany: false,
    });
  });

  it('counts the person’s worked seat on a visit a companion has not finished — with company', () => {
    const visit = appointmentFixture({
      seats: [
        friendSeat(SeatOutcome.scheduled()),
        seatFixture({ outcome: SeatOutcome.worked(at) }),
      ],
    });
    expect(AchievementsSystem.workedVisitOf(visit, me)).toMatchObject({
      serviceIds: [FIXTURE_IDS.service],
      barberIds: [FIXTURE_IDS.barber],
      startMinutes: 600,
      withCompany: true,
    });
  });

  it('starts at the person’s EARLIEST worked seat, seats in their own order', () => {
    const visit = appointmentFixture({
      seats: [
        seatFixture({
          seatId: SeatId.of('seat-late'),
          serviceId: ServiceId.of('svc-beard'),
          startMinutes: minute(660),
          outcome: SeatOutcome.worked(at),
        }),
        seatFixture({ outcome: SeatOutcome.worked(at) }),
        seatFixture({
          seatId: SeatId.of('seat-unworked'),
          serviceId: ServiceId.of('svc-finish'),
          startMinutes: minute(540),
          outcome: SeatOutcome.noShow(at),
        }),
      ],
    });
    expect(AchievementsSystem.workedVisitOf(visit, me)).toMatchObject({
      serviceIds: ['svc-beard', FIXTURE_IDS.service],
      startMinutes: 600,
      withCompany: false,
    });
  });
});

describe('AchievementsSystem.countedDraft — the visit on screen as a visit (M-31)', () => {
  it('holds a draft with no start and no shop as nothing: no day, no minute, no weekday, no instant, no shop', () => {
    const draft = AchievementsSystem.countedDraft({
      start: null,
      serviceIds: [ServiceId.of('svc-fade')],
      barberIds: [BarberId.of('ivan')],
      locationId: null,
    });
    expect(draft).toEqual({
      serviceIds: ['svc-fade'],
      barberIds: ['ivan'],
      locationId: null,
      localDate: null,
      startMinutes: null,
      weekday: null,
      startUtcMs: null,
      arrivedAtUtcMs: null,
      withCompany: false,
    });
    // Never early, never on a weekend, in no shop.
    expect(
      AchievementsSystem.countsToward(by(Metric.VisitsEarlyBird), draft),
    ).toBe(false);
    expect(
      AchievementsSystem.countsToward(by(Metric.VisitsWeekend), draft),
    ).toBe(false);
    expect(AchievementsSystem.countsToward(CENTER, draft)).toBe(false);
  });

  it('reads a draft’s start: its day, its minute, its weekday and its instant; never an arrival or company', () => {
    const startUtcMs = utcMs('2026-10-03T08:00:00.000Z');
    expect(
      AchievementsSystem.countedDraft({
        start: {
          localDate: localDate('2026-10-03'),
          minute: minute(660),
          utcMs: startUtcMs,
        },
        serviceIds: [],
        barberIds: [],
        locationId: LocationId.of('loc-center'),
      }),
    ).toEqual({
      serviceIds: [],
      barberIds: [],
      locationId: 'loc-center',
      localDate: '2026-10-03',
      startMinutes: 660,
      weekday: Weekday.Sat,
      startUtcMs,
      arrivedAtUtcMs: null,
      withCompany: false,
    });
  });
});

describe('AchievementsSystem.draftCountsToward — what the open visit adds (M-31)', () => {
  /** Георги's open fade as the edge builds it: Friday 2 October, 10:00 in Sofia. */
  const georgiOpen = AchievementsSystem.countedDraft({
    start: {
      localDate: localDate('2026-10-02'),
      minute: minute(600),
      utcMs: utcMs('2026-10-02T07:00:00.000Z'),
    },
    serviceIds: [ServiceId.of('svc-fade')],
    barberIds: [BarberId.of('ivan')],
    locationId: LocationId.of('loc-center'),
  });
  /** The same fade on Saturday 3 October, 11:00. */
  const saturday = AchievementsSystem.countedDraft({
    start: {
      localDate: localDate('2026-10-03'),
      minute: minute(660),
      utcMs: utcMs('2026-10-03T08:00:00.000Z'),
    },
    serviceIds: [ServiceId.of('svc-fade')],
    barberIds: [BarberId.of('ivan')],
    locationId: LocationId.of('loc-center'),
  });
  /** Мартин's cut in the chair: Monday 28 September, 12:30. */
  const martinOpen = AchievementsSystem.countedDraft({
    start: {
      localDate: TODAY,
      minute: minute(750),
      utcMs: utcMs('2026-09-28T09:30:00.000Z'),
    },
    serviceIds: [ServiceId.of('svc-classic-cut')],
    barberIds: [BarberId.of('ivan')],
    locationId: LocationId.of('loc-center'),
  });

  const counts = (
    holder: LoyaltyClientFixture,
    id: string,
    draft: CountedDraft | null,
    series: BadgeSeries = family(id),
    phase: SeasonPhase | null = phaseOf(series),
  ) =>
    AchievementsSystem.draftCountsToward(
      series,
      BadgeSystem.standing(series, progressOf(holder, id)),
      draft,
      phase,
      phase === SeasonPhase.Ended,
    );

  it('counts the draft that holds what the family counts', () => {
    for (const id of [
      'series-svc-fade',
      'series-visits',
      'series-barber-ivan',
      'series-shop-center',
      'series-early-bird',
    ]) {
      expect([id, counts(GEORGI, id, georgiOpen)]).toEqual([id, true]);
    }
    for (const id of [
      'series-svc-beard',
      'series-barber-niko',
      'series-shop-mladost',
      'series-weekend',
    ]) {
      expect([id, counts(GEORGI, id, georgiOpen)]).toEqual([id, false]);
    }
    expect(counts(MARTIN, 'series-svc-classic-cut', martinOpen)).toBe(true);
    expect(counts(MARTIN, 'series-early-bird', martinOpen)).toBe(false);
    expect(counts(MARTIN, 'series-svc-fade', martinOpen)).toBe(false);
  });

  it('counts a weekend by the draft’s own day', () => {
    expect(counts(GEORGI, 'series-weekend', saturday)).toBe(true);
    expect(counts(GEORGI, 'series-early-bird', saturday)).toBe(false);
  });

  it('never promises what only the day decides, nor what one visit cannot tell', () => {
    for (const id of [
      'series-on-time',
      'series-party',
      'series-explorer',
      'series-self-service',
      'series-tenure',
      'series-rhythm',
      'series-welcome',
    ]) {
      expect([id, counts(GEORGI, id, georgiOpen)]).toEqual([id, false]);
    }
  });

  it('counts nothing without a draft, for a family that cannot move, or out of an OPEN season — null included', () => {
    expect(counts(GEORGI, 'series-svc-fade', null)).toBe(false);
    const fade = family('series-svc-fade');
    expect(
      counts(GEORGI, 'series-svc-fade', georgiOpen, {
        ...fade,
        retiredAtUtcMs: utcMs('2026-09-01T00:00:00.000Z'),
        retiredLocalDate: localDate('2026-09-01'),
      }),
    ).toBe(false);
    // The summer track ended; the autumn one runs.
    expect(counts(GEORGI, 'series-2026-summer-track', georgiOpen)).toBe(false);
    expect(counts(GEORGI, 'series-2026-autumn-track', georgiOpen)).toBe(true);
    const track = family('series-2026-autumn-track');
    for (const phase of [SeasonPhase.Announced, SeasonPhase.Ended, null]) {
      expect([
        phase,
        counts(GEORGI, 'series-2026-autumn-track', georgiOpen, track, phase),
      ]).toEqual([phase, false]);
    }
  });

  it('counts a draft with no start yet by what it holds — never early, on a weekend or on time', () => {
    const noStart = AchievementsSystem.countedDraft({
      start: null,
      serviceIds: [ServiceId.of('svc-fade')],
      barberIds: [BarberId.of('ivan')],
      locationId: LocationId.of('loc-center'),
    });
    for (const id of [
      'series-svc-fade',
      'series-visits',
      'series-barber-ivan',
      'series-shop-center',
    ]) {
      expect([id, counts(GEORGI, id, noStart)]).toEqual([id, true]);
    }
    for (const id of [
      'series-early-bird',
      'series-weekend',
      'series-on-time',
      'series-party',
      'series-svc-beard',
    ]) {
      expect([id, counts(GEORGI, id, noStart)]).toEqual([id, false]);
    }
  });

  it('counts a draft with no shop yet in no shop: every family scoped to one says no, the rest still count', () => {
    const noShop = AchievementsSystem.countedDraft({
      start: {
        localDate: localDate('2026-10-02'),
        minute: minute(600),
        utcMs: utcMs('2026-10-02T07:00:00.000Z'),
      },
      serviceIds: [ServiceId.of('svc-fade')],
      barberIds: [BarberId.of('ivan')],
      locationId: null,
    });
    for (const id of ['series-shop-center', 'series-shop-mladost']) {
      expect([id, counts(GEORGI, id, noShop)]).toEqual([id, false]);
    }
    for (const id of [
      'series-svc-fade',
      'series-visits',
      'series-barber-ivan',
      'series-early-bird',
    ]) {
      expect([id, counts(GEORGI, id, noShop)]).toEqual([id, true]);
    }
  });
});

describe('AchievementsSystem.serviceToAdd — the dock’s verb (M-32)', () => {
  const martinServices = [ServiceId.of('svc-classic-cut')];
  const EDITABLE = { online: true, visitGone: false, paused: false };
  const add = (
    id: string,
    services = martinServices,
    canMove = true,
    gate = EDITABLE,
  ) => AchievementsSystem.serviceToAdd(family(id), services, canMove, gate);

  it('offers the family’s service while the open visit lacks it', () => {
    expect(add('series-svc-fade')).toBe('svc-fade');
    expect(add('series-2026-autumn-beard')).toBe('svc-beard');
  });

  it('gives way once the visit holds the service', () => {
    expect(add('series-svc-classic-cut')).toBeNull();
    expect(
      add('series-svc-fade', [...martinServices, ServiceId.of('svc-fade')]),
    ).toBeNull();
  });

  it('is a verb for a SERVICE only: never a barber, a shop, a count of visits', () => {
    for (const id of [
      'series-barber-niko',
      'series-shop-mladost',
      'series-visits',
      'series-early-bird',
      'series-welcome',
      'series-rhythm',
    ]) {
      expect([id, add(id)]).toEqual([id, null]);
    }
  });

  it('is absent for a family no longer awarded, or one that cannot move', () => {
    expect(
      AchievementsSystem.serviceToAdd(
        {
          ...family('series-svc-fade'),
          retiredAtUtcMs: utcMs('2026-09-01T00:00:00.000Z'),
          retiredLocalDate: localDate('2026-09-01'),
        },
        martinServices,
        true,
        EDITABLE,
      ),
    ).toBeNull();
    expect(add('series-svc-fade', martinServices, false)).toBeNull();
  });

  it('is absent while the visit cannot be edited: offline, gone, or the client paused', () => {
    // medal-detail.presenter.spec.ts `detailActionOf`'s gate cases.
    expect(add('series-svc-fade', martinServices, true, EDITABLE)).toBe(
      'svc-fade',
    );
    for (const gate of [
      { ...EDITABLE, online: false },
      { ...EDITABLE, visitGone: true },
      { ...EDITABLE, paused: true },
    ]) {
      expect([
        gate,
        add('series-svc-fade', martinServices, true, gate),
      ]).toEqual([gate, null]);
    }
  });
});

describe('AchievementsSystem.countedVisits — «Броени посещения» (M-39)', () => {
  type Row = {
    readonly id: AppointmentId;
    readonly localDate: ReturnType<typeof localDate>;
    readonly utcEpochMs: UtcEpochMs;
  };
  const row = (id: string, day: string, hour = '07'): Row => ({
    id: AppointmentId.of(id),
    localDate: localDate(day),
    utcEpochMs: utcMs(`${day}T${hour}:00:00.000Z`),
  });
  /** A pair the edge built: the row and, unless `null`, its worked fade with Иван at Център. */
  const pair = (
    appointment: Row,
    counted: Partial<CountedVisit> | null = {},
  ) => ({
    appointment,
    counted:
      counted === null
        ? null
        : visit({
            localDate: appointment.localDate,
            weekday: Weekday.Thu,
            startUtcMs: appointment.utcEpochMs,
            ...counted,
          }),
  });
  const ids = (rows: readonly Row[]) => rows.map((r): string => r.id);
  const fade = family('series-svc-fade');

  const sep03 = row('sep-03', '2026-09-03');
  const sep28 = row('sep-28', '2026-09-28');
  const aug06 = row('aug-06', '2026-08-06');
  const jul13 = row('jul-13', '2026-07-13');
  const may02 = row('may-02', '2025-05-02');
  const next = row('next', '2026-10-02');

  it('lists the visits that counted, newest first', () => {
    expect(
      ids(
        AchievementsSystem.countedVisits(
          fade,
          null,
          [pair(aug06), pair(sep28), pair(may02), pair(sep03)],
          TODAY,
          null,
          null,
        ),
      ),
    ).toEqual(['sep-28', 'sep-03', 'aug-06', 'may-02']);
  });

  it('lists only the person’s worked visits that count towards the family', () => {
    expect(
      ids(
        AchievementsSystem.countedVisits(
          fade,
          null,
          [
            pair(sep28),
            pair(sep03, null),
            pair(aug06, { serviceIds: [ServiceId.of('svc-beard')] }),
          ],
          TODAY,
          null,
          null,
        ),
      ),
    ).toEqual(['sep-28']);
    // A family that counts no single visit lists none.
    expect(
      AchievementsSystem.countedVisits(
        family('series-rhythm'),
        null,
        [pair(sep28), pair(sep03)],
        TODAY,
        null,
        null,
      ),
    ).toEqual([]);
  });

  it('leads with the visit on screen while its draft counts, whatever it holds', () => {
    const draft = visit();
    const visits = [pair(sep28), pair(next, null), pair(sep03)];
    expect(
      ids(
        AchievementsSystem.countedVisits(
          fade,
          null,
          visits,
          TODAY,
          draft,
          next.id,
        ),
      ),
    ).toEqual(['next', 'sep-28', 'sep-03']);
    // Its draft does not count: an hour still to come is never listed.
    expect(
      ids(
        AchievementsSystem.countedVisits(
          fade,
          null,
          visits,
          TODAY,
          null,
          next.id,
        ),
      ),
    ).toEqual(['sep-28', 'sep-03']);
    // No visit on screen to lead.
    expect(
      ids(
        AchievementsSystem.countedVisits(
          fade,
          null,
          visits,
          TODAY,
          draft,
          null,
        ),
      ),
    ).toEqual(['sep-28', 'sep-03']);
  });

  it('keeps a season’s family to the season’s own window, and to nothing where the season does not resolve', () => {
    const summer = family('series-2026-summer-track');
    const season =
      summer.seasonId === null
        ? null
        : LoyaltyCatalogSystem.season(CATALOG, summer.seasonId);
    expect(season).not.toBeNull();
    const visits = [
      pair(sep28),
      pair(sep03),
      pair(aug06),
      pair(jul13),
      pair(may02),
    ];
    expect(
      ids(
        AchievementsSystem.countedVisits(
          summer,
          season,
          visits,
          TODAY,
          null,
          null,
        ),
      ),
    ).toEqual(['aug-06', 'jul-13']);
    expect(
      AchievementsSystem.countedVisits(summer, null, visits, TODAY, null, null),
    ).toEqual([]);
  });

  it('keeps a metric with a window of its own to it, today included', () => {
    const windowed: BadgeSeries = {
      ...family('series-visits'),
      metricWindowDays: 30,
    };
    // 28 September back to 30 August.
    expect(
      ids(
        AchievementsSystem.countedVisits(
          windowed,
          null,
          [
            pair(sep28),
            pair(sep03),
            pair(aug06),
            pair(row('aug-30', '2026-08-30')),
            pair(row('aug-29', '2026-08-29')),
          ],
          TODAY,
          null,
          null,
        ),
      ),
    ).toEqual(['sep-28', 'sep-03', 'aug-30']);
  });

  it('lists a visit handed over twice twice, and keeps the order of equal instants', () => {
    const twin = row('twin', '2026-09-03');
    expect(
      ids(
        AchievementsSystem.countedVisits(
          fade,
          null,
          [pair(sep03), pair(sep28), pair(twin), pair(sep03)],
          TODAY,
          null,
          null,
        ),
      ),
    ).toEqual(['sep-28', 'sep-03', 'twin', 'sep-03']);
  });
});

describe('AchievementsSystem purity — the visit on screen', () => {
  it('is pure: same input → same output, inputs untouched', () => {
    const fade = deepFreeze({ ...family('series-svc-fade') });
    const progress = deepFreeze(progressOf(GEORGI, 'series-svc-fade'));
    const draft = deepFreeze({ ...GEORGI_DRAFT });
    const book = deepFreeze(
      appointmentFixture({
        seats: [
          seatFixture({
            outcome: SeatOutcome.worked(utcMs('2026-09-28T09:00:00.000Z')),
          }),
        ],
      }),
    );
    const pairs = deepFreeze([
      {
        appointment: {
          id: AppointmentId.of('b'),
          localDate: localDate('2026-09-03'),
          utcEpochMs: utcMs('2026-09-03T07:00:00.000Z'),
        },
        counted: visit({ localDate: localDate('2026-09-03') }),
      },
      {
        appointment: {
          id: AppointmentId.of('a'),
          localDate: localDate('2026-09-28'),
          utcEpochMs: utcMs('2026-09-28T07:00:00.000Z'),
        },
        counted: visit(),
      },
    ]);
    const run = () => {
      const standing = BadgeSystem.standing(fade, progress);
      const counted = AchievementsSystem.countedDraft({
        start: null,
        serviceIds: draft.serviceIds,
        barberIds: draft.barberIds,
        locationId: draft.locationId,
      });
      return [
        AchievementsSystem.completesWithVisit(
          fade,
          standing,
          null,
          draft,
          null,
          TODAY,
        ),
        AchievementsSystem.workedVisitOf(book, FIXTURE_IDS.customer),
        counted,
        AchievementsSystem.draftCountsToward(
          fade,
          standing,
          counted,
          null,
          false,
        ),
        AchievementsSystem.serviceToAdd(fade, draft.serviceIds, true, {
          online: true,
          visitGone: false,
          paused: false,
        }),
        AchievementsSystem.countedVisits(
          fade,
          null,
          pairs,
          TODAY,
          counted,
          AppointmentId.of('b'),
        ),
      ];
    };
    expect(run()).toEqual(run());
  });
});
