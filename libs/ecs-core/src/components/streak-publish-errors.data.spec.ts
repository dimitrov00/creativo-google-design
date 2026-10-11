import { describe, expect, it } from 'vitest';
import { localDate } from '../testing';
import {
  StreakPublishError,
  StreakPublishErrorCode,
} from './streak-publish-errors.data';

describe('StreakPublishError', () => {
  it('keeps the callable’s codes SCREAMING under the LOYALTY_STREAK_PUBLISH_ prefix', () => {
    expect(Object.values(StreakPublishErrorCode).sort()).toEqual([
      'LOYALTY_STREAK_PUBLISH_INVALID',
      'LOYALTY_STREAK_PUBLISH_PREVIEW_STALE',
      'LOYALTY_STREAK_PUBLISH_RECOMPUTE_NEEDS_ENGINE',
      'LOYALTY_STREAK_PUBLISH_STALE',
      'LOYALTY_STREAK_PUBLISH_TOO_EARLY',
    ]);
  });

  it('builds one plain struct per errorCode', () => {
    const errors: readonly StreakPublishError[] = [
      StreakPublishError.stale(3, 4),
      StreakPublishError.invalid(['intervalDays']),
      StreakPublishError.tooEarly(
        localDate('2026-10-11'),
        localDate('2026-10-17'),
      ),
      StreakPublishError.recomputeNeedsEngine(),
      StreakPublishError.previewStale(),
    ];
    expect(errors.map((error) => error.errorCode).sort()).toEqual(
      Object.values(StreakPublishErrorCode).sort(),
    );
    expect(StreakPublishError.stale(3, 4)).toEqual({
      errorCode: 'LOYALTY_STREAK_PUBLISH_STALE',
      expected: 3,
      actual: 4,
    });
    expect(
      StreakPublishError.tooEarly(
        localDate('2026-10-11'),
        localDate('2026-10-17'),
      ),
    ).toEqual({
      errorCode: 'LOYALTY_STREAK_PUBLISH_TOO_EARLY',
      effectiveFromLocalDate: '2026-10-11',
      earliest: '2026-10-17',
    });
  });
});
