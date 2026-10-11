import { describe, expect, it } from 'vitest';
import { FIXTURE_NOW, localDate, minute, utcMs } from '../testing';
import { ShopNow } from './shop-now.data';
import { WallTime } from './wall-time.data';

describe('ShopNow / WallTime — the shop wall clock (Law 7.3)', () => {
  it('ShopNow carries the shop day, the current minute and the stamp instant', () => {
    const now = ShopNow.of(
      localDate('2026-09-28'),
      minute(540),
      utcMs('2026-09-28T09:00:00+03:00'),
    );
    expect(now).toEqual(FIXTURE_NOW);
    expect(ShopNow.wallTime(now)).toEqual({
      localDate: '2026-09-28',
      minute: 540,
    });
  });

  it('WallTime orders on the civil line: day first, then minute', () => {
    const a = WallTime.of(localDate('2026-09-28'), minute(600));
    const b = WallTime.of(localDate('2026-09-28'), minute(601));
    const c = WallTime.of(localDate('2026-09-29'), minute(0));
    expect(WallTime.compare(a, b)).toBe(-1);
    expect(WallTime.compare(b, a)).toBe(1);
    expect(WallTime.compare(a, a)).toBe(0);
    expect(WallTime.compare(b, c)).toBe(-1);
    expect(WallTime.compare(c, a)).toBe(1);
  });
});
