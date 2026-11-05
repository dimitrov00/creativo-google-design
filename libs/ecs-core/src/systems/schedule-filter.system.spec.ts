import { describe, expect, it } from 'vitest';
import { BookingStatus } from '@core/primitives';
import { deepFreeze } from '@core/testing';
import { ScheduleFilterSystem } from './schedule-filter.system';

const visit = (id: string, bookingStatus: BookingStatus) => ({
  id,
  bookingStatus,
});

describe('ScheduleFilterSystem.shown — which visits the schedule draws', () => {
  const day = [
    visit('a', BookingStatus.Confirmed),
    visit('b', BookingStatus.Cancelled),
    visit('c', BookingStatus.Completed),
    visit('d', BookingStatus.NoShow),
    visit('e', BookingStatus.Cancelled),
  ];

  it('draws every visit, as the same array, while nothing is hidden', () => {
    expect(ScheduleFilterSystem.shown(day, [])).toBe(day);
  });

  it('leaves out the hidden states and keeps the rest in their order', () => {
    expect(
      ScheduleFilterSystem.shown(day, [
        BookingStatus.Cancelled,
        BookingStatus.NoShow,
      ]).map((v) => v.id),
    ).toEqual(['a', 'c']);
  });

  it('draws nothing when every state on the day is hidden', () => {
    expect(
      ScheduleFilterSystem.shown(day, [
        BookingStatus.Confirmed,
        BookingStatus.Cancelled,
        BookingStatus.Completed,
        BookingStatus.NoShow,
      ]),
    ).toEqual([]);
  });

  it('is pure: same input → same output, inputs untouched', () => {
    const visits = deepFreeze(day);
    const hidden = deepFreeze([BookingStatus.Cancelled]);
    expect(ScheduleFilterSystem.shown(visits, hidden)).toEqual(
      ScheduleFilterSystem.shown(visits, hidden),
    );
  });
});
