import { describe, expect, it } from 'vitest';
import { BlockKind } from '../components/minute-block.data';
import { OpeningState } from '../components/opening-hours.data';
import { ServiceTerms } from '../components/service-terms.data';
import { BusyKey } from '../primitives/busy-key.primitive';
import { Currency } from '../primitives/currency.primitive';
import { ZonedTimeSystem } from '../systems/zoned-time.system';
import {
  FIXTURE_IDS,
  FIXTURE_TIME_ZONE,
  FIXTURE_TODAY,
  deepFreeze,
  textFixture,
  utcMs,
} from '../testing';
import {
  EUR,
  FIXTURE_TERMS,
  at,
  barberBusyDayFixture,
  barberFixture,
  barberScheduleFixture,
  cents,
  duration,
  locationFixture,
  minuteCount,
  minuteDelta,
  serviceFixture,
  termsFixture,
  until,
} from './booking-core.fixtures';

/*
 * The booking-core fixtures' own spec: the builders' defaults agree with one
 * another and with `testing.ts`' pins (the file restates them to stay free
 * of an import cycle), every field is overridable, and a broken literal
 * throws instead of building a value no system could hold.
 */

describe('booking-core fixtures — the shared pins', () => {
  it('restates testing.ts’ ids, today and zone exactly', () => {
    expect(barberFixture().id).toBe(FIXTURE_IDS.barber);
    expect(locationFixture().id).toBe(FIXTURE_IDS.location);
    expect(serviceFixture().id).toBe(FIXTURE_IDS.service);
    expect(serviceFixture().categoryId).toBe(FIXTURE_IDS.category);
    expect(barberBusyDayFixture().localDate).toBe(FIXTURE_TODAY);
    expect(locationFixture().timeZone).toBe(FIXTURE_TIME_ZONE);
  });
});

describe('booking-core fixtures — branded literals', () => {
  it('builds each brand from plain figures', () => {
    expect(cents(2800)).toBe(2800);
    expect(duration(30)).toBe(30);
    expect(minuteCount(0)).toBe(0);
    expect(minuteDelta(-15)).toBe(-15);
    expect(at(10, 30)).toBe(630);
    expect(until(24)).toBe(1440);
    expect(EUR).toBe(Currency.EUR);
  });

  it('throws on a literal no brand admits — a broken fixture, never a value', () => {
    expect(() => cents(-1)).toThrow(/broken fixture/);
    expect(() => duration(0)).toThrow(/broken fixture/);
    expect(() => minuteCount(-5)).toThrow(/broken fixture/);
    expect(() => minuteDelta(1.5)).toThrow(/broken fixture/);
    expect(() => at(24)).toThrow(/broken fixture/);
    expect(() => until(0)).toThrow(/broken fixture/);
  });

  it('terms come from plain figures, pads defaulting to zero', () => {
    expect(termsFixture(2800, 30)).toEqual(FIXTURE_TERMS);
    expect(FIXTURE_TERMS).toEqual({
      priceCents: 2800,
      currency: 'EUR',
      durationMinutes: 30,
      setupMinutes: 0,
      cleanupMinutes: 0,
    });
    expect(ServiceTerms.occupiedMinutes(termsFixture(2800, 30, 5, 10))).toBe(
      45,
    );
  });
});

// testing.spec.ts' "fixture builders", for the booking-core entities.
describe('booking-core fixtures — entity builders', () => {
  it('the catalogue fixtures cross-reference the same ids', () => {
    const barber = barberFixture();
    const location = locationFixture();
    const service = serviceFixture();
    expect(barber.locationIds).toEqual([location.id]);
    expect(service.locationIds).toEqual([location.id]);
    expect(service.offerings[0]?.barberId).toBe(barber.id);
    expect(location.openingHours).toHaveLength(7);
    expect(location.openingHours[6]?.openingState).toBe(OpeningState.Closed);
    expect(location.timeZone).toBe(FIXTURE_TIME_ZONE);
    expect(barberFixture({ sortOrder: 3 }).sortOrder).toBe(3);
    expect(locationFixture({ mapUrl: 'https://maps.example' }).mapUrl).toBe(
      'https://maps.example',
    );
    expect(serviceFixture({ popular: true }).popular).toBe(true);
    expect(textFixture('Cut')).toEqual({ bg: 'Cut', en: 'Cut' });
  });

  it('the scheduling fixtures describe Ivan today', () => {
    const schedule = barberScheduleFixture();
    expect(schedule.versions[0]?.segments.map((s) => s.weekday)).toEqual([
      1, 2, 3, 4, 5,
    ]);
    expect(barberBusyDayFixture().id).toBe(
      BusyKey.of(FIXTURE_IDS.barber, FIXTURE_TODAY),
    );
    expect(barberBusyDayFixture().blocks[0]).toEqual({
      startMinutes: 600,
      endMinutes: 630,
      blockKind: BlockKind.Busy,
    });
    // The day's first instant in the shop's zone: 00:00 EEST.
    expect(barberBusyDayFixture().utcEpochMs).toBe(
      utcMs('2026-09-28T00:00:00+03:00'),
    );
    expect(barberBusyDayFixture().utcEpochMs).toBe(
      ZonedTimeSystem.startOfLocalDay(FIXTURE_TODAY, FIXTURE_TIME_ZONE),
    );
    expect(
      barberScheduleFixture({ turnaroundMinutes: minuteCount(5) })
        .turnaroundMinutes,
    ).toBe(5);
    expect(barberBusyDayFixture({ blocks: [] }).blocks).toEqual([]);
  });

  it('every fixture survives deepFreeze (no builder shares a mutable value)', () => {
    const builders = [
      barberFixture,
      locationFixture,
      serviceFixture,
      barberScheduleFixture,
      barberBusyDayFixture,
    ] as const;
    for (const build of builders) {
      const frozen = deepFreeze(build());
      const fresh = build();
      expect(Object.isFrozen(fresh)).toBe(false);
      expect(fresh).toEqual(frozen);
    }
  });
});
