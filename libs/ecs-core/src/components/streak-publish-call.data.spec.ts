import { describe, expect, it } from 'vitest';
import { PublishRequestId, StreakDefinitionId } from '@core/primitives';
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
