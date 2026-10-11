import { describe, expect, it } from 'vitest';
import {
  FIXTURE_TIME_ZONE,
  endMinute,
  localDate,
  minute,
  utcMs,
} from '../testing';
import { ZonedTimeSystem } from '../systems/zoned-time.system';
import { AppointmentTime } from './appointment-time.data';

const DAY = localDate('2026-10-07');

function time(start: number, end: number, day = DAY): AppointmentTime {
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

describe('AppointmentTime — the shop wall clock and the one instant', () => {
  it('measures the envelope on the wall clock', () => {
    expect(AppointmentTime.durationMinutes(time(600, 645))).toBe(45);
    expect(AppointmentTime.durationMinutes(time(600, 600))).toBe(0);
  });

  it('overlaps only on the same day, half-open', () => {
    expect(AppointmentTime.overlaps(time(600, 645), time(630, 700))).toBe(true);
    expect(AppointmentTime.overlaps(time(600, 645), time(645, 700))).toBe(
      false,
    );
    expect(
      AppointmentTime.overlaps(
        time(600, 645),
        time(600, 645, localDate('2026-10-08')),
      ),
    ).toBe(false);
  });

  it('places a seat’s start on the absolute timeline by its distance from the envelope (T9)', () => {
    const visit = time(600, 700);
    expect(visit.utcEpochMs).toBe(utcMs('2026-10-07T10:00:00+03:00'));
    expect(
      AppointmentTime.seatStartUtcMs(visit, { startMinutes: minute(645) }),
    ).toBe(utcMs('2026-10-07T10:45:00+03:00'));
    expect(
      AppointmentTime.seatStartUtcMs(visit, { startMinutes: minute(600) }),
    ).toBe(visit.utcEpochMs);
  });

  it('is pure: same input, same output, input untouched', () => {
    const visit = Object.freeze(time(600, 700));
    const once = AppointmentTime.seatStartUtcMs(visit, {
      startMinutes: minute(630),
    });
    expect(
      AppointmentTime.seatStartUtcMs(visit, { startMinutes: minute(630) }),
    ).toBe(once);
    expect(visit.startMinutes).toBe(600);
  });
});
