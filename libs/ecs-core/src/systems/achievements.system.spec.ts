import { describe, expect, it } from 'vitest';
import { Metric, MetricRef } from '@core/components';
import {
  Weekday,
  BarberId,
  LocationId,
  ServiceId,
  MinuteDelta,
  UtcEpochMs,
} from '@core/primitives';
import { deepFreeze, localDate, minute, unwrapOk, utcMs } from '@core/testing';
import { AchievementsSystem, type CountedVisit } from './achievements.system';

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
