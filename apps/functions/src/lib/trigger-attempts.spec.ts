import { beforeEach, describe, expect, it, vi } from 'vitest';
import { logger } from 'firebase-functions';
import {
  attemptFailure,
  attemptOutcome,
  decisiveFailure,
  eventAgeMs,
  failureCode,
  logAttempt,
  reportAttempt,
} from './trigger-attempts';

vi.mock('firebase-functions', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

describe('failed attempts — transient codes retry, the rest are dropped', () => {
  it('reads numeric gRPC codes as the Admin SDK reports them', () => {
    expect(failureCode({ code: 10 })).toBe('aborted');
    expect(failureCode({ code: 6 })).toBe('already-exists');
    expect(failureCode({ code: 14 })).toBe('unavailable');
    expect(failureCode({ code: 99 })).toBe('unknown');
  });

  it('reads string codes in any common spelling', () => {
    expect(failureCode({ code: 'DEADLINE_EXCEEDED' })).toBe(
      'deadline-exceeded',
    );
    expect(failureCode({ code: 'firestore/resource-exhausted' })).toBe(
      'resource-exhausted',
    );
    expect(failureCode(new Error('boom'))).toBe('unknown');
    expect(failureCode(null)).toBe('unknown');
  });

  it('retries only what a later attempt could change', () => {
    for (const code of [
      'aborted',
      'unavailable',
      'deadline-exceeded',
      'resource-exhausted',
    ]) {
      expect(attemptOutcome(code)).toBe('transient');
    }
    for (const code of [
      'invalid-argument',
      'permission-denied',
      'governance.id.empty',
      'unknown',
    ]) {
      expect(attemptOutcome(code)).toBe('permanent');
    }
  });

  it('measures how far into the retry window a delivery is', () => {
    const at = Date.parse('2026-09-25T08:00:00.000Z');
    expect(eventAgeMs('2026-09-25T08:00:00.000Z', at + 1500)).toBe(1500);
    expect(eventAgeMs('not a time', at)).toBeNull();
  });
});

describe('decisiveFailure — one verdict over independent failures', () => {
  it('is transient when any one failure is, so the redelivery retries them all', () => {
    const transient = { code: 10 };
    expect(decisiveFailure([{ code: 13 }, transient])).toEqual({
      error: transient,
      code: 'aborted',
      outcome: 'transient',
    });
  });

  it('is the first permanent failure when none is transient, and null for none', () => {
    const first = { code: 13 };
    expect(decisiveFailure([first, new Error('boom')])).toEqual({
      error: first,
      code: 'internal',
      outcome: 'permanent',
    });
    expect(decisiveFailure([])).toBeNull();
  });
});

describe('reportAttempt — the one tail every retrying handler shares', () => {
  const NOW = Date.parse('2026-09-25T08:00:00.000Z');
  const event = { id: 'evt-1', time: new Date(NOW - 2_500).toISOString() };
  beforeEach(() => vi.mocked(logger.error).mockClear());

  it('judges one failure by its code, or by a code it is given', () => {
    const error = { code: 14 };
    expect(attemptFailure(error)).toEqual({
      error,
      code: 'unavailable',
      outcome: 'transient',
    });
    expect(attemptFailure(error, 'governance.id.empty')).toEqual({
      error,
      code: 'governance.id.empty',
      outcome: 'permanent',
    });
  });

  it('logs the line and rethrows a transient failure for redelivery', () => {
    const error = { code: 10 };
    let thrown: unknown = null;
    try {
      reportAttempt('someTrigger', event, attemptFailure(error), NOW);
    } catch (caught) {
      thrown = caught;
    }
    // The failure itself, for the platform to see — not a wrapper.
    expect(thrown).toBe(error);
    expect(vi.mocked(logger.error).mock.calls).toEqual([
      [
        'trigger attempt failed',
        {
          fn: 'someTrigger',
          eventId: 'evt-1',
          outcome: 'transient',
          code: 'aborted',
          ageMs: 2_500,
        },
      ],
    ]);
  });

  it('logs the line and returns on a permanent one', () => {
    expect(() =>
      reportAttempt('someTrigger', event, attemptFailure({ code: 13 }), NOW),
    ).not.toThrow();
    expect(vi.mocked(logger.error).mock.calls[0]?.[1]).toMatchObject({
      outcome: 'permanent',
      code: 'internal',
    });
  });

  it('only logs, whatever the outcome, when asked to log', () => {
    expect(() =>
      logAttempt('someTrigger', event, attemptFailure({ code: 10 }), NOW),
    ).not.toThrow();
    expect(logger.error).toHaveBeenCalledTimes(1);
  });
});
