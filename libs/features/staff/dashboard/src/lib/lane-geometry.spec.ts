import { describe, expect, it } from 'vitest';
import {
  DayHours,
  ExceptionEffectRule,
  MinuteRange,
  ShiftSegment,
} from '@core/components';
import {
  BarberId,
  LocalDate,
  LocationId,
  MinuteCount,
  ScheduleExceptionId,
  Weekday,
} from '@core/primitives';
import {
  at,
  barberScheduleFixture,
  locationFixture,
  scheduleExceptionFixture,
  unwrapOk,
  until,
} from '@core/testing';
import { laneGeometryOf } from './staff-day.store';

const IVAN = BarberId.of('ivan');
const MONDAY = unwrapOk(LocalDate.parse('2026-08-03'));
const CENTER = LocationId.of('loc-center');
/** Ivan's afternoon shop, hidden from the catalogue — no active shop row. */
const MLADOST = LocationId.of('loc-mladost');
/** An evening segment at a shop nobody authored: no document at all. */
const GHOST = LocationId.of('loc-ghost');

/** The day as the clock reads it: `HH:MM–HH:MM`, one per range. */
function asClock(ranges: readonly MinuteRange[]): readonly string[] {
  const clock = (minutes: number): string =>
    `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
  return ranges.map(
    (range) => `${clock(range.startMinutes)}–${clock(range.endMinutes)}`,
  );
}

describe('laneGeometryOf', () => {
  // The staff day draws only the shops the catalogue offers: a segment at a
  // hidden shop, or at one with no document, has no window — and the block
  // an exception carved out of that segment goes with it. A block drawn
  // over a window that is not there would be a rectangle over nothing.
  it('drops what a hidden shop’s day had blocked out too, with its windows', () => {
    const schedule = barberScheduleFixture({
      id: IVAN,
      turnaroundMinutes: MinuteCount.ZERO,
      versions: [
        {
          seq: 1,
          effectiveFromLocalDate: unwrapOk(LocalDate.parse('2026-01-01')),
          effectiveToLocalDate: null,
          segments: [
            ShiftSegment.of(Weekday.Mon, CENTER, at(8), until(12)),
            ShiftSegment.of(Weekday.Mon, MLADOST, at(14), until(18)),
            ShiftSegment.of(Weekday.Mon, GHOST, at(18), until(20)),
          ],
        },
      ],
    });
    const exception = scheduleExceptionFixture({
      id: ScheduleExceptionId.of('ivan__2026-08-03'),
      barberId: IVAN,
      localDate: MONDAY,
      locationId: CENTER,
      ...unwrapOk(
        ExceptionEffectRule.blocked([
          MinuteRange.of(at(10), until(10, 30)),
          MinuteRange.of(at(15), until(15, 30)),
        ]),
      ),
    });
    // Only the Center is listed: the hidden shop and the ghost are absent.
    const listed = [
      locationFixture({
        id: CENTER,
        openingHours: Array.from({ length: 7 }, () =>
          DayHours.open(at(8), until(20)),
        ),
      }),
    ];

    const geometry = laneGeometryOf(
      IVAN,
      MONDAY,
      schedule,
      null,
      exception,
      listed,
    );

    expect(asClock(geometry.rostered)).toEqual(['08:00–10:00', '10:30–12:00']);
    expect(asClock(geometry.blocks)).toEqual(['10:00–10:30']);
  });
});
