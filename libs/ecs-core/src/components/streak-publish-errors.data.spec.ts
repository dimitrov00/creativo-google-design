import { describe, expect, it } from 'vitest';
import { DayKey } from './day-key.data';
import {
  StreakPublishError,
  StreakPublishErrorCode,
} from './streak-publish-errors.data';

describe('StreakPublishError', () => {
  it('keeps the callable’s loyalty.streak_publish.* keys verbatim', () => {
    expect(Object.values(StreakPublishErrorCode).sort()).toEqual([
      'loyalty.streak_publish.invalid',
      'loyalty.streak_publish.preview_stale',
      'loyalty.streak_publish.recompute_needs_engine',
      'loyalty.streak_publish.stale',
      'loyalty.streak_publish.too_early',
    ]);
  });

  it('builds one plain struct per code', () => {
    const errors: readonly StreakPublishError[] = [
      StreakPublishError.stale(3, 4),
      StreakPublishError.invalid(['interval']),
      StreakPublishError.tooEarly(
        DayKey.of('2026-10-11'),
        DayKey.of('2026-10-17'),
      ),
      StreakPublishError.recomputeNeedsEngine(),
      StreakPublishError.previewStale(),
    ];
    expect(errors.map((error) => error.code).sort()).toEqual(
      Object.values(StreakPublishErrorCode).sort(),
    );
    expect(StreakPublishError.stale(3, 4)).toEqual({
      code: 'loyalty.streak_publish.stale',
      expected: 3,
      actual: 4,
    });
    expect(
      StreakPublishError.tooEarly(
        DayKey.of('2026-10-11'),
        DayKey.of('2026-10-17'),
      ),
    ).toEqual({
      code: 'loyalty.streak_publish.too_early',
      effectiveFromDayKey: '2026-10-11',
      earliest: '2026-10-17',
    });
  });
});
