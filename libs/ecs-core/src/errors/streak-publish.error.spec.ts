import { describe, expect, it } from 'vitest';
import { deepFreeze, localDate } from '@core/testing';
import { RepositoryError } from './repository.error';
import {
  StreakPublishError,
  StreakPublishErrorCode,
} from './streak-publish.error';

describe('StreakPublishError', () => {
  it('keeps the callable’s codes SCREAMING under the LOYALTY_STREAK_PUBLISH_ prefix', () => {
    expect(Object.values(StreakPublishErrorCode).sort()).toEqual([
      'LOYALTY_STREAK_PUBLISH_CALLER_NOT_ADMIN',
      'LOYALTY_STREAK_PUBLISH_CALLER_UNAUTHENTICATED',
      'LOYALTY_STREAK_PUBLISH_INVALID',
      'LOYALTY_STREAK_PUBLISH_INVALID_INPUT',
      'LOYALTY_STREAK_PUBLISH_PREVIEW_STALE',
      'LOYALTY_STREAK_PUBLISH_RECOMPUTE_NEEDS_ENGINE',
      'LOYALTY_STREAK_PUBLISH_STALE',
      'LOYALTY_STREAK_PUBLISH_STORE_FAILED',
      'LOYALTY_STREAK_PUBLISH_TOO_EARLY',
    ]);
  });

  it('builds one plain struct per errorCode', () => {
    const errors: readonly { readonly errorCode: string }[] = [
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
      StreakPublishError.invalidInput('requestId'),
      StreakPublishError.storeFailed(),
    ];
    expect(errors.map((error) => error.errorCode).sort()).toEqual(
      Object.values(StreakPublishErrorCode).sort(),
    );
    expect(StreakPublishError.invalidInput('requestId')).toEqual({
      errorCode: 'LOYALTY_STREAK_PUBLISH_INVALID_INPUT',
      field: 'requestId',
    });
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

describe('StreakPublishError.guard — the publish’s no, as against no answer', () => {
  /** One struct per code of the dictionary, the two codes outside the union included. */
  const everyRefusal: readonly { readonly errorCode: string }[] = [
    StreakPublishError.callerUnauthenticated(),
    StreakPublishError.callerNotAdmin(),
    StreakPublishError.stale(1, 2),
    StreakPublishError.invalid(['graceDays']),
    StreakPublishError.tooEarly(
      localDate('2026-09-29'),
      localDate('2026-10-28'),
    ),
    StreakPublishError.recomputeNeedsEngine(),
    StreakPublishError.previewStale(),
    StreakPublishError.invalidInput('requestId'),
    StreakPublishError.storeFailed(),
  ];

  it('knows every code of the dictionary — never only the callable’s answered subset', () => {
    expect(everyRefusal.map((error) => error.errorCode).sort()).toEqual(
      Object.values(StreakPublishErrorCode).sort(),
    );
    for (const error of everyRefusal) {
      expect(StreakPublishError.guard(error)).toBe(true);
    }
  });

  it('tells a request that got no answer apart: a RepositoryError is no refusal', () => {
    expect(StreakPublishError.guard(RepositoryError.unavailable())).toBe(false);
    expect(
      StreakPublishError.guard(RepositoryError.writeFailed(null, 'threw')),
    ).toBe(false);
    expect(
      StreakPublishError.guard(RepositoryError.readFailed(null, 'gone')),
    ).toBe(false);
  });

  it('knows no code outside the dictionary, nor a lower-case spelling of one', () => {
    expect(
      StreakPublishError.guard({ errorCode: 'STAFF_EDIT_FORBIDDEN' }),
    ).toBe(false);
    expect(
      StreakPublishError.guard({
        errorCode: 'loyalty_streak_publish_too_early',
      }),
    ).toBe(false);
    expect(StreakPublishError.guard({ errorCode: '' })).toBe(false);
  });

  it('is pure: same input → same output, inputs untouched', () => {
    const error = deepFreeze(StreakPublishError.stale(1, 2));
    expect(StreakPublishError.guard(error)).toBe(
      StreakPublishError.guard(error),
    );
    expect(error).toEqual(StreakPublishError.stale(1, 2));
  });
});
