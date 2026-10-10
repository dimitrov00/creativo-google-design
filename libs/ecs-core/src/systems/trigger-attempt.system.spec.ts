import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { deepFreeze } from '../testing';
import { AttemptOutcome, TriggerAttemptSystem } from './trigger-attempt.system';

/*
 * The cases of apps/functions/src/lib/trigger-attempts.spec.ts, copied (the
 * legacy spec keeps running against its shim). The event's time is epoch
 * ms here (`null` when unreadable — the shim parses the wire string), and
 * the logging/rethrowing cases are re-targeted to the one structured line
 * (`attemptLine`) and the verdict that decides the rethrow: writing the
 * line and throwing stay with the caller.
 */

const {
  attemptFailure,
  attemptLine,
  attemptOutcome,
  decisiveFailure,
  eventAgeMs,
  failureCode,
} = TriggerAttemptSystem;

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
    expect(eventAgeMs(at, at + 1500)).toBe(1500);
    expect(eventAgeMs(null, at)).toBeNull();
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

describe('the attempt line — what every retrying handler logs', () => {
  const NOW = Date.parse('2026-09-25T08:00:00.000Z');
  const event = { id: 'evt-1', atMs: NOW - 2_500 };

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

  it('names the transient failure a redelivery is for, with its age (reportAttempt rethrows it)', () => {
    const error = { code: 10 };
    const failure = attemptFailure(error);
    // The failure itself rides the verdict, for the caller to rethrow — not a wrapper.
    expect(failure.error).toBe(error);
    expect(failure.outcome).toBe(AttemptOutcome.Transient);
    expect(attemptLine('someTrigger', event, failure, NOW)).toEqual({
      fn: 'someTrigger',
      eventId: 'evt-1',
      outcome: 'transient',
      code: 'aborted',
      ageMs: 2_500,
    });
  });

  it('marks a permanent one, which the caller logs and returns on', () => {
    expect(
      attemptLine('someTrigger', event, attemptFailure({ code: 13 }), NOW),
    ).toMatchObject({ outcome: 'permanent', code: 'internal' });
  });

  it('is the same line whatever the outcome, with no age for an unreadable time', () => {
    expect(
      attemptLine(
        'someTrigger',
        { id: 'evt-2', atMs: null },
        attemptFailure({ code: 10 }),
        NOW,
      ),
    ).toEqual({
      fn: 'someTrigger',
      eventId: 'evt-2',
      outcome: 'transient',
      code: 'aborted',
      ageMs: null,
    });
  });
});

describe('properties', () => {
  it('reads every gRPC status by its own name, and never an age below zero', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -5, max: 40 }),
        fc.integer({ min: 0, max: 1e9 }),
        fc.integer({ min: 0, max: 1e9 }),
        (status, at, now) => {
          const code = failureCode({ code: status });
          if (status < 1 || status > 16) expect(code).toBe('unknown');
          else expect(code).not.toBe('');
          expect(eventAgeMs(at, now)).toBeGreaterThanOrEqual(0);
        },
      ),
    );
  });

  it('is pure: same input → same output, inputs untouched', () => {
    const errors = deepFreeze([{ code: 13 }, { code: 'ABORTED' }, null]);
    const once = decisiveFailure(errors);
    const twice = decisiveFailure(errors);
    expect(twice).toEqual(once);
    expect(once).toEqual({
      error: errors[1],
      code: 'aborted',
      outcome: 'transient',
    });
    const event = deepFreeze({ id: 'evt-3', atMs: 1_000 });
    expect(
      attemptLine('fn', event, attemptFailure({ code: 14 }), 4_000),
    ).toEqual(attemptLine('fn', event, attemptFailure({ code: 14 }), 4_000));
  });
});
