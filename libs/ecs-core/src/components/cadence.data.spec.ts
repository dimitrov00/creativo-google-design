import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { Cadence } from './cadence.data';

/*
 * OR-46: the ONE mean the card's cadence (`ClientStatsSystem`'s
 * `cadenceOf`) and a personal streak's habit (`StreakSystem`) share. The
 * calendar-day gap rule itself — whole shop days, a same-day pair skipped —
 * is pinned where the gaps are read (`client-stats.system.spec.ts`
 * «stats — cadence», the streak spec's habit cases).
 */
describe('Cadence.meanDays — the mean gap, one decimal', () => {
  it('is the plain mean when it is whole', () => {
    expect(Cadence.meanDays(70, 2)).toBe(35);
    expect(Cadence.meanDays(28, 1)).toBe(28);
    expect(Cadence.meanDays(42, 6)).toBe(7);
  });

  it('rounds to one decimal — half up, the stored figure stable', () => {
    expect(Cadence.meanDays(20, 3)).toBe(6.7);
    expect(Cadence.meanDays(43, 6)).toBe(7.2);
    expect(Cadence.meanDays(21, 2)).toBe(10.5);
    expect(Cadence.meanDays(201, 20)).toBe(10.1);
  });

  it('is null with no gap to measure', () => {
    expect(Cadence.meanDays(0, 0)).toBeNull();
    expect(Cadence.meanDays(14, 0)).toBeNull();
    expect(Cadence.meanDays(14, -1)).toBeNull();
  });

  it('never strays more than half a tenth from the exact mean (property)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 20 }),
        fc.integer({ min: 0, max: 8_000 }),
        (gaps, total) => {
          const mean = Cadence.meanDays(total, gaps);
          return mean !== null && Math.abs(mean - total / gaps) <= 0.05 + 1e-9;
        },
      ),
    );
  });

  it('is pure: same input → same output', () => {
    expect(Cadence.meanDays(20, 3)).toBe(Cadence.meanDays(20, 3));
    expect(Cadence.meanDays(0, 0)).toBe(Cadence.meanDays(0, 0));
  });
});
