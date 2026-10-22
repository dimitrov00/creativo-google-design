import { describe, expect, it } from 'vitest';
import { localDate } from '@core/testing';
import {
  StreakPublishError,
  StreakPublishErrorCode,
} from './streak-publish-errors.data';

describe('StreakPublishError', () => {
  it('keeps the callable’s codes SCREAMING under the LOYALTY_STREAK_PUBLISH_ prefix', () => {
    expect(Object.values(StreakPublishErrorCode).sort()).toEqual([
      'LOYALTY_STREAK_PUBLISH_CALLER_NOT_ADMIN',
      'LOYALTY_STREAK_PUBLISH_CALLER_UNAUTHENTICATED',
      'LOYALTY_STREAK_PUBLISH_INVALID',
      'LOYALTY_STREAK_PUBLISH_PREVIEW_STALE',
      'LOYALTY_STREAK_PUBLISH_RECOMPUTE_NEEDS_ENGINE',
      'LOYALTY_STREAK_PUBLISH_STALE',
      'LOYALTY_STREAK_PUBLISH_TOO_EARLY',
    ]);
  });

  it('builds one plain struct per errorCode', () => {
    const errors: readonly StreakPublishError[] = [
      StreakPublishError.callerUnauthenticated(),
      StreakPublishError.callerNotAdmin(),
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

  it('judges the caller with payload-free structs: who asks, never what was sent', () => {
    expect(StreakPublishError.callerUnauthenticated()).toEqual({
      errorCode: 'LOYALTY_STREAK_PUBLISH_CALLER_UNAUTHENTICATED',
    });
    expect(StreakPublishError.callerNotAdmin()).toEqual({
      errorCode: 'LOYALTY_STREAK_PUBLISH_CALLER_NOT_ADMIN',
    });
    expect(Object.keys(StreakPublishError.callerNotAdmin())).toEqual([
      'errorCode',
    ]);
  });
});
