import { describe, expect, it } from 'vitest';
import {
  PublishRequestId,
  StreakDefinitionId,
  StreakPublishError,
} from '@core/primitives';
import { localDate } from '@core/testing';
import { StreakPublishCall } from './streak-publish-call.data';
import {
  StreakRule,
  StreakRuleDirection,
  StreakTransition,
} from './streak-rule.data';

const REQUEST = PublishRequestId.of('req-1');
const CADENCE = StreakDefinitionId.of('cadence');

describe('StreakPublishCall — what the admin page sends and what it is answered', () => {
  it('carries the rule as proposed beside the head it was drafted against', () => {
    const call: StreakPublishCall = {
      requestId: REQUEST,
      streakId: CADENCE,
      baseVersion: 1,
      rule: {
        ...StreakRule.DEFAULT,
        version: 2,
        effectiveFromLocalDate: localDate('2026-10-28'),
      },
      streakTransition: StreakTransition.Grandfather,
      previewHash: null,
    };
    expect(call.rule.version).toBe(call.baseVersion + 1);
    expect(Object.keys(call)).toEqual([
      'requestId',
      'streakId',
      'baseVersion',
      'rule',
      'streakTransition',
      'previewHash',
    ]);
  });

  it('builds a withdrawal of the waiting version, field for field', () => {
    expect(StreakPublishCall.withdraw(REQUEST, CADENCE, 2)).toEqual({
      requestId: 'req-1',
      streakId: 'cadence',
      version: 2,
    });
  });

  it('builds a receipt: the version made, its first day, whom it favoured', () => {
    expect(
      StreakPublishCall.receipt(
        2,
        localDate('2026-10-28'),
        StreakRuleDirection.Stricter,
      ),
    ).toEqual({
      version: 2,
      effectiveFromLocalDate: '2026-10-28',
      streakRuleDirection: 'STRICTER',
    });
  });

  it('is pure: the same input builds equal, fresh, flat structs', () => {
    const day = localDate('2026-10-28');
    const first = StreakPublishCall.receipt(3, day, StreakRuleDirection.Looser);
    const again = StreakPublishCall.receipt(3, day, StreakRuleDirection.Looser);
    expect(again).toEqual(first);
    expect(again).not.toBe(first);
    expect(Object.getPrototypeOf(first)).toBe(Object.prototype);
    expect(StreakPublishCall.withdraw(REQUEST, CADENCE, 3)).not.toBe(
      StreakPublishCall.withdraw(REQUEST, CADENCE, 3),
    );
  });
});

/*
 * The publish callable's answer on the flipped wire (Phase 4a 4A-4):
 * `streakPublishOutcome` SCREAMING, an answered refusal projected flat (no
 * legacy nested locators), the web rebuilding today's struct from it — a
 * STALE restating the version asked, a TOO_EARLY with no vouched day
 * falling back to the day asked.
 */
describe('StreakPublishCall — the answer', () => {
  const day = localDate('2026-10-28');

  it('encodes and decodes a published receipt and a withdrawal', () => {
    const published = StreakPublishCall.published(
      StreakPublishCall.receipt(2, day, StreakRuleDirection.Looser),
    );
    expect(published).toEqual({
      streakPublishOutcome: 'PUBLISHED',
      version: 2,
      effectiveFromLocalDate: '2026-10-28',
      streakRuleDirection: 'LOOSER',
    });
    expect(StreakPublishCall.decodeAnswer(published)).toEqual({
      ok: true,
      value: published,
    });
    const withdrawn = StreakPublishCall.withdrawn(3);
    expect(StreakPublishCall.decodeAnswer(withdrawn)).toEqual({
      ok: true,
      value: { streakPublishOutcome: 'WITHDRAWN', version: 3 },
    });
  });

  it('projects an answered refusal flat and decodes it back', () => {
    const invalid = StreakPublishCall.refused(
      StreakPublishError.invalid(['intervalDays']),
    );
    expect(invalid).toEqual({
      streakPublishOutcome: 'REFUSED',
      errorCode: 'LOYALTY_STREAK_PUBLISH_INVALID',
      fields: ['intervalDays'],
      earliest: null,
      effectiveFromLocalDate: null,
    });
    expect(StreakPublishCall.decodeAnswer(invalid)).toEqual({
      ok: true,
      value: invalid,
    });
    expect(
      StreakPublishCall.refused(
        StreakPublishError.tooEarly(day, localDate('2026-11-02')),
      ),
    ).toMatchObject({
      earliest: '2026-11-02',
      effectiveFromLocalDate: '2026-10-28',
    });
  });

  it('rebuilds today’s struct — a STALE restates the version asked, a TOO_EARLY falls back to the day asked', () => {
    const stale = StreakPublishCall.refused(StreakPublishError.stale(4, 5));
    expect(StreakPublishCall.refusalOf(stale, 4, day)).toEqual(
      StreakPublishError.stale(4, 4),
    );
    const early = {
      ...StreakPublishCall.refused(
        StreakPublishError.tooEarly(day, localDate('2026-11-02')),
      ),
      earliest: null,
    };
    expect(StreakPublishCall.refusalOf(early, 1, day)).toEqual(
      StreakPublishError.tooEarly(day, day),
    );
    expect(StreakPublishCall.refusalOf(early, 1, null)).toBeNull();
    expect(
      StreakPublishCall.refusalOf(
        StreakPublishCall.refused(StreakPublishError.callerNotAdmin()),
        1,
        null,
      ),
    ).toEqual(StreakPublishError.callerNotAdmin());
  });

  it('answers a word nobody knows, or a refusal it does not answer, as nothing usable', () => {
    expect(
      StreakPublishCall.decodeAnswer({ streakPublishOutcome: 'published' }).ok,
    ).toBe(false);
    expect(
      StreakPublishCall.decodeAnswer({
        streakPublishOutcome: 'REFUSED',
        errorCode: 'LOYALTY_STREAK_PUBLISH_STORE_FAILED',
        fields: [],
        earliest: null,
        effectiveFromLocalDate: null,
      }).ok,
    ).toBe(false);
  });
});
