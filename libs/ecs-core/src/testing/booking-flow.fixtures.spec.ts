import { describe, expect, it } from 'vitest';
import {
  ExceptionEffect,
  BusyKey,
  ScheduleExceptionId,
} from '@core/primitives';
import { ZonedTimeSystem } from '@core/systems';
import { deepFreeze } from './deep-freeze';
import {
  FIXTURE_IDS,
  FIXTURE_TIME_ZONE,
  FIXTURE_TODAY,
  localDate,
  utcMs,
} from './test-support';
import { scheduleExceptionFixture } from './booking-flow.fixtures';

/*
 * The booking-flow fixtures (moved out of `testing.spec.ts`'s "fixture
 * builders" block, flatten-spec §8.1): the flat exception, its pins held
 * equal to `testing.ts`.
 */
describe('scheduleExceptionFixture', () => {
  it('is Ivan off for the whole of today — the public effect only, flat at the root', () => {
    const exception = scheduleExceptionFixture();
    expect(exception.exceptionEffect).toBe(ExceptionEffect.Closed);
    expect(exception).toEqual({
      id: ScheduleExceptionId.of(BusyKey.of(FIXTURE_IDS.barber, FIXTURE_TODAY)),
      barberId: FIXTURE_IDS.barber,
      localDate: FIXTURE_TODAY,
      utcEpochMs: utcMs('2026-09-28T00:00:00+03:00'),
      locationId: FIXTURE_IDS.location,
      exceptionEffect: 'CLOSED',
    });
    // No zone on a temporal entity: the instant is the shop day's first.
    expect(exception).not.toHaveProperty('zone');
    expect(exception.utcEpochMs).toBe(
      ZonedTimeSystem.startOfLocalDay(FIXTURE_TODAY, FIXTURE_TIME_ZONE),
    );
  });

  it('is overridable field by field', () => {
    const tomorrow = localDate('2026-09-29');
    expect(scheduleExceptionFixture({ localDate: tomorrow }).localDate).toBe(
      tomorrow,
    );
    const hours = scheduleExceptionFixture({
      exceptionEffect: ExceptionEffect.Hours,
      exceptionRanges: [],
    });
    expect(hours.exceptionEffect).toBe('HOURS');
  });

  it('survives deepFreeze (no builder shares a mutable value)', () => {
    const a = deepFreeze(scheduleExceptionFixture());
    const b = scheduleExceptionFixture();
    expect(Object.isFrozen(b)).toBe(false);
    expect(b).toEqual(a);
  });
});
