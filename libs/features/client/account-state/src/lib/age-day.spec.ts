import { describe, expect, it } from 'vitest';
import { memoryClockPorts, utcMs } from '@core/testing';
import { ageDayOf } from './age-day';

/*
 * The age day is the UTC civil date of the one clock reading (F2-7) —
 * total over `CLOCK_PORTS` since Phase 4a (the `null` branch of the
 * legacy clock is dead: the browser clock always answers). Pinned clocks
 * only.
 */
describe('ageDayOf', () => {
  it('is the UTC civil date of the instant', () => {
    expect(ageDayOf(memoryClockPorts(utcMs('2026-09-28T06:00:00Z')))).toBe(
      '2026-09-28',
    );
  });

  it('turns the day at UTC midnight, not at the shop’s', () => {
    expect(ageDayOf(memoryClockPorts(utcMs('2026-09-28T23:30:00Z')))).toBe(
      '2026-09-28',
    );
    expect(ageDayOf(memoryClockPorts(utcMs('2026-09-29T00:00:00Z')))).toBe(
      '2026-09-29',
    );
  });
});
