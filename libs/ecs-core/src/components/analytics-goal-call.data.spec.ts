import { describe, expect, it } from 'vitest';
import { PipelineErrorCode } from '@core/errors';
import { FIXTURE_NOW_UTC_MS } from '@core/testing';
import { SetAnalyticsGoalCall } from './analytics-goal-call.data';

const UNUSABLE = {
  ok: false,
  error: expect.objectContaining({ errorCode: PipelineErrorCode.Unknown }),
};

describe('SetAnalyticsGoalCall.decodeSet — the setAnalyticsGoal answer', () => {
  it('reads the stored key and the set’s stamp back, a barber’s and the shop’s', () => {
    for (const goalKey of ['b-ivan__2026-11', 'shop__2026-11']) {
      expect(
        SetAnalyticsGoalCall.decodeSet({
          goalKey,
          goalSetAtUtcMs: FIXTURE_NOW_UTC_MS,
        }),
      ).toEqual({
        ok: true,
        value: { goalKey, goalSetAtUtcMs: FIXTURE_NOW_UTC_MS },
      });
    }
  });

  it('refuses a reply that is no object, or whose key or stamp is missing or malformed', () => {
    for (const raw of [
      null,
      undefined,
      'ok',
      {},
      { goalKey: 'b-ivan__2026-11' },
      { goalSetAtUtcMs: FIXTURE_NOW_UTC_MS },
      { goalKey: 'b-ivan__2026-11-09', goalSetAtUtcMs: FIXTURE_NOW_UTC_MS },
      { goalKey: 'b-ivan_2026-11', goalSetAtUtcMs: FIXTURE_NOW_UTC_MS },
      { goalKey: 7, goalSetAtUtcMs: FIXTURE_NOW_UTC_MS },
      { goalKey: 'shop__2026-11', goalSetAtUtcMs: 'now' },
      { goalKey: 'shop__2026-11', goalSetAtUtcMs: 1.5 },
    ]) {
      expect(SetAnalyticsGoalCall.decodeSet(raw)).toEqual(UNUSABLE);
    }
  });
});
