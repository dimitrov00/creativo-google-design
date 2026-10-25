import { describe, expect, it } from 'vitest';
import { IntervalSetSystem } from '@core/systems';
import { deepFreeze, endMinute, minute } from '@core/testing';
import { MinuteRange } from './minute-range.data';
import { NormalizedRanges } from './normalized-ranges.data';

/*
 * The brand's own file since pass D (its one constructor and its cast moved
 * out of interval-set.system.ts). `IntervalSetSystem.normalize` IS this
 * constructor, so the set algebra's normalize cases (interval-set
 * .system.spec.ts) pin it too; these pin the companion directly.
 */

const iv = (start: number, end: number): MinuteRange =>
  MinuteRange.of(minute(start), endMinute(end));

describe('NormalizedRanges — the canonical range set and its one constructor', () => {
  it('is the set algebra’s normalize — one function, one cast site', () => {
    expect(IntervalSetSystem.normalize).toBe(NormalizedRanges.normalize);
  });

  it('sorts, merges overlapping and touching runs, drops empty ones', () => {
    expect(
      NormalizedRanges.normalize([iv(660, 720), iv(540, 600), iv(600, 630)]),
    ).toEqual([iv(540, 630), iv(660, 720)]);
    expect(NormalizedRanges.normalize([iv(600, 600)])).toEqual([]);
  });

  it('knows a canonical set by one linear look — non-empty, strictly ascending, never touching', () => {
    expect(NormalizedRanges.isNormalized([])).toBe(true);
    expect(NormalizedRanges.isNormalized([iv(540, 600), iv(660, 720)])).toBe(
      true,
    );
    expect(NormalizedRanges.isNormalized([iv(540, 600), iv(600, 660)])).toBe(
      false,
    );
    expect(NormalizedRanges.isNormalized([iv(660, 720), iv(540, 600)])).toBe(
      false,
    );
    expect(NormalizedRanges.isNormalized([iv(600, 600)])).toBe(false);
  });

  it('hands a canonical input straight back — the same array, no copy', () => {
    const set = [iv(540, 600), iv(660, 720)];
    expect(NormalizedRanges.normalize(set)).toBe(set);
  });

  it('is pure: same input → same output, input untouched', () => {
    const messy = deepFreeze([iv(660, 720), iv(540, 600), iv(590, 640)]);
    const once = NormalizedRanges.normalize(messy);
    expect(NormalizedRanges.normalize(messy)).toEqual(once);
    expect(messy).toEqual([iv(660, 720), iv(540, 600), iv(590, 640)]);
  });
});
