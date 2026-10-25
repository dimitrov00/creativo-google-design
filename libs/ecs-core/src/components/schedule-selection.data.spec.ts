import { describe, expect, it } from 'vitest';
import { BarberId, CartLineId, LocationId } from '@core/primitives';
import { endMinute, localDate, minute } from '@core/testing';
import { ScheduleSelection } from './schedule-selection.data';
import type { SeatAssignment } from './seat-assignment.data';

/** 09:00 — every assignment below is measured from it, on the one shop day. */
const T0 = 9 * 60;
const DAY = localDate('2026-10-07');
const CENTER = LocationId.of('loc-center');

const assignment = (
  lineId: string,
  startMinute: number,
  minutes: number,
): SeatAssignment => ({
  lineId: CartLineId.of(lineId),
  barberId: BarberId.of('ivan'),
  startMinutes: minute(T0 + startMinute),
  endMinutes: endMinute(T0 + startMinute + minutes),
});

describe('ScheduleSelection', () => {
  it('derives the envelope from the assignments — first start to last end, on the shop day', () => {
    const built = ScheduleSelection.of(CENTER, DAY, [
      assignment('line-0', 0, 30),
      assignment('line-1', 30, 45),
    ]);
    expect(built?.localDate).toBe('2026-10-07');
    expect([built?.startMinutes, built?.endMinutes]).toEqual([T0, T0 + 75]);
    const parallel = ScheduleSelection.of(CENTER, DAY, [
      assignment('line-0', 0, 30),
      assignment('line-1', 0, 60),
    ]);
    expect([parallel?.startMinutes, parallel?.endMinutes]).toEqual([
      T0,
      T0 + 60,
    ]);
  });

  it('describes no appointment without an assignment', () => {
    expect(ScheduleSelection.of(CENTER, DAY, [])).toBeNull();
  });
});
