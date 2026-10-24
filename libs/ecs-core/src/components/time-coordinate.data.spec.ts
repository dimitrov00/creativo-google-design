import { describe, expect, it } from 'vitest';
import {
  FIXTURE_TIME_ZONE,
  deepFreeze,
  endMinute,
  localDate,
  minute,
  utcMs,
} from '@core/testing';
import { ZonedTimeSystem } from '@core/systems';
import { TimeCoordinate } from './time-coordinate.data';

const DAY = localDate('2026-10-07');

function time(start: number, end: number, day = DAY): TimeCoordinate {
  const startMinutes = minute(start);
  const instant = ZonedTimeSystem.toUtc(day, startMinutes, FIXTURE_TIME_ZONE);
  if (!instant.ok) throw new Error('bad fixture');
  return {
    localDate: day,
    startMinutes,
    endMinutes: endMinute(end),
    utcEpochMs: instant.value,
  };
}

describe('TimeCoordinate — the shop wall clock and the one instant', () => {
  it('measures the envelope on the wall clock', () => {
    expect(TimeCoordinate.durationMinutes(time(600, 645))).toBe(45);
    expect(TimeCoordinate.durationMinutes(time(600, 600))).toBe(0);
  });

  it('overlaps only on the same day, half-open', () => {
    expect(TimeCoordinate.overlaps(time(600, 645), time(630, 700))).toBe(true);
    expect(TimeCoordinate.overlaps(time(600, 645), time(645, 700))).toBe(false);
    expect(
      TimeCoordinate.overlaps(
        time(600, 645),
        time(600, 645, localDate('2026-10-08')),
      ),
    ).toBe(false);
  });

  it('places a seat’s start on the absolute timeline by its distance from the envelope (T9)', () => {
    const visit = time(600, 700);
    expect(visit.utcEpochMs).toBe(utcMs('2026-10-07T10:00:00+03:00'));
    expect(
      TimeCoordinate.seatStartUtcMs(visit, { startMinutes: minute(645) }),
    ).toBe(utcMs('2026-10-07T10:45:00+03:00'));
    expect(
      TimeCoordinate.seatStartUtcMs(visit, { startMinutes: minute(600) }),
    ).toBe(visit.utcEpochMs);
  });

  it('is pure: same input, same output, input untouched', () => {
    const visit = Object.freeze(time(600, 700));
    const once = TimeCoordinate.seatStartUtcMs(visit, {
      startMinutes: minute(630),
    });
    expect(
      TimeCoordinate.seatStartUtcMs(visit, { startMinutes: minute(630) }),
    ).toBe(once);
    expect(visit.startMinutes).toBe(600);
  });
});

describe('TimeCoordinate.endUtcMs — the envelope’s end as an instant (.ics)', () => {
  it('is the start as stored plus the sold span of real time', () => {
    expect(TimeCoordinate.endUtcMs(time(600, 645))).toBe(
      utcMs('2026-10-07T10:45:00+03:00'),
    );
    expect(TimeCoordinate.endUtcMs(time(23 * 60, 1440))).toBe(
      utcMs('2026-10-08T00:00:00+03:00'),
    );
  });

  it('is the start itself for an empty envelope', () => {
    const empty = time(600, 600);
    expect(TimeCoordinate.endUtcMs(empty)).toBe(empty.utcEpochMs);
  });

  it('adds the minutes to the instant as stored, whatever the wall clock says', () => {
    const shifted = {
      ...time(600, 660),
      utcEpochMs: utcMs('2026-10-07T00:00:00Z'),
    };
    expect(TimeCoordinate.endUtcMs(shifted)).toBe(
      utcMs('2026-10-07T01:00:00Z'),
    );
  });

  it('is pure: same input → same output, inputs untouched', () => {
    const visit = deepFreeze(time(600, 645));
    expect(TimeCoordinate.endUtcMs(visit)).toBe(TimeCoordinate.endUtcMs(visit));
  });
});
