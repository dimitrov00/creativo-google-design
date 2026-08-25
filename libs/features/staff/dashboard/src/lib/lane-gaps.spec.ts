import { describe, expect, it } from 'vitest';
import { Interval } from '@creativo/application/booking';
import { laneGaps } from './staff-day.store';

const H = 3_600_000;
/** A day that starts at an arbitrary epoch — only the arithmetic matters. */
const DAY = 1_000_000_000_000;
const at = (hours: number): number => DAY + hours * H;

describe('laneGaps', () => {
  const rostered = [Interval.of(at(9), at(18))];

  it('draws the ELAPSED hole, which used to be discarded entirely', () => {
    // A hole that has already passed is not sellable, but it is a fact: the
    // chair sat empty and nobody filled it. Hiding it made an idle morning
    // and a fully booked one render identically. With a 10:00 cut done and
    // the clock at 17:00 the rest of the day is one elapsed hole and one
    // sellable hour.
    const gaps = laneGaps(rostered, [Interval.of(at(9), at(10))], at(17));
    expect(gaps.length).toBe(2);
    expect(gaps[0]).toMatchObject({ sellable: false, startMs: at(10) });
    expect(gaps[1]).toMatchObject({ sellable: true, startMs: at(17) });
  });

  it('splits a hole that straddles the clock, and floors each piece AFTER', () => {
    // 10:00–18:00 free with now at 17:00 is seven elapsed hours and one
    // sellable one — two different facts that must not be one card.
    const wide = laneGaps(rostered, [], at(12));
    expect(wide.length).toBe(2);
    expect(wide[0]).toMatchObject({ sellable: false, minutes: 3 * 60 });
    expect(wide[1]).toMatchObject({ sellable: true, minutes: 6 * 60 });
  });

  it('never emits a sellable sliver from a mostly-elapsed hole', () => {
    // Flooring BEFORE the split would let a 105-minute hole with five
    // minutes left on it advertise "5 мин свободни".
    const nearlyOver = at(17) + 55 * 60_000; // 17:55, hole runs to 18:00
    const gaps = laneGaps(rostered, [Interval.of(at(9), at(10))], nearlyOver);
    expect(gaps.every((gap) => gap.minutes >= 20)).toBe(true);
    expect(gaps.some((gap) => gap.sellable)).toBe(false);
  });

  it('keeps the 20-minute floor on both sides of the clock', () => {
    // Below the floor a lane becomes a ladder of booking/gap/booking and the
    // three-second read is gone — the reason the floor exists at all.
    const busy = [
      Interval.of(at(9), at(12)),
      Interval.of(at(12) + 600_000, at(18)),
    ];
    expect(laneGaps(rostered, busy, at(9)).length).toBe(0);
  });

  it('draws nothing for a chair that is not rostered', () => {
    // No window is not the same as an empty window, and never was.
    expect(laneGaps([], [], at(12)).length).toBe(0);
  });

  it('reports a wholly past day as entirely idle when nothing was booked', () => {
    const gaps = laneGaps(rostered, [], at(30));
    expect(gaps.length).toBe(1);
    expect(gaps[0]).toMatchObject({ sellable: false, minutes: 9 * 60 });
  });
});
