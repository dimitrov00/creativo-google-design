import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { TriggerEventId, UtcEpochMs } from '@core/primitives';
import { RepositoryError } from '@core/errors';
import { deepFreeze, unwrapOk, utcMs } from '@core/testing';
import { AttemptOutcome, TriggerAttemptSystem } from './trigger-attempt.system';

/*
 * The cases of apps/functions/src/lib/trigger-attempts.spec.ts, copied (the
 * legacy spec ran against its shim until a flip deleted it). The event's
 * time is a
 * `UtcEpochMs` here (`null` when unreadable — the shim parses the wire
 * string), the outcome is the SCREAMING `AttemptOutcome` on the field
 * `attemptOutcome`, and the logging/rethrowing cases are re-targeted to the
 * one structured line (`attemptLine`) and the verdict that decides the
 * rethrow: writing the line and throwing stay with the caller.
 */

/** An instant literal in epoch ms. */
const at = (ms: number): UtcEpochMs => unwrapOk(UtcEpochMs.of(ms));

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
      expect(attemptOutcome(code)).toBe('TRANSIENT');
    }
    for (const code of [
      'invalid-argument',
      'permission-denied',
      'governance.id.empty',
      'unknown',
    ]) {
      expect(attemptOutcome(code)).toBe('PERMANENT');
    }
  });

  it('measures how far into the retry window a delivery is', () => {
    const sent = utcMs('2026-09-25T08:00:00.000Z');
    expect(eventAgeMs(sent, at(sent + 1500))).toBe(1500);
    expect(eventAgeMs(null, sent)).toBeNull();
    // A clock behind the event's own time never reads a negative age.
    expect(eventAgeMs(sent, at(sent - 1))).toBe(0);
  });
});

describe('decisiveFailure — one verdict over independent failures', () => {
  it('is transient when any one failure is, so the redelivery retries them all', () => {
    const transient = { code: 10 };
    expect(decisiveFailure([{ code: 13 }, transient])).toEqual({
      error: transient,
      failureCode: 'aborted',
      attemptOutcome: 'TRANSIENT',
    });
  });

  it('is the first permanent failure when none is transient, and null for none', () => {
    const first = { code: 13 };
    expect(decisiveFailure([first, new Error('boom')])).toEqual({
      error: first,
      failureCode: 'internal',
      attemptOutcome: 'PERMANENT',
    });
    expect(decisiveFailure([])).toBeNull();
  });
});

describe('the attempt line — what every retrying handler logs', () => {
  const NOW = utcMs('2026-09-25T08:00:00.000Z');
  const event = {
    id: TriggerEventId.of('evt-1'),
    eventAtUtcMs: at(NOW - 2_500),
  };

  it('judges one failure by its code, or by a code it is given', () => {
    const error = { code: 14 };
    expect(attemptFailure(error)).toEqual({
      error,
      failureCode: 'unavailable',
      attemptOutcome: 'TRANSIENT',
    });
    expect(attemptFailure(error, 'governance.id.empty')).toEqual({
      error,
      failureCode: 'governance.id.empty',
      attemptOutcome: 'PERMANENT',
    });
  });

  it('names the transient failure a redelivery is for, with its age (reportAttempt rethrows it)', () => {
    const error = { code: 10 };
    const failure = attemptFailure(error);
    // The failure itself rides the verdict, for the caller to rethrow — not a wrapper.
    expect(failure.error).toBe(error);
    expect(failure.attemptOutcome).toBe(AttemptOutcome.Transient);
    expect(attemptLine('someTrigger', event, failure, NOW)).toEqual({
      fn: 'someTrigger',
      eventId: 'evt-1',
      attemptOutcome: 'TRANSIENT',
      failureCode: 'aborted',
      ageMs: 2_500,
    });
  });

  it('marks a permanent one, which the caller logs and returns on', () => {
    expect(
      attemptLine('someTrigger', event, attemptFailure({ code: 13 }), NOW),
    ).toMatchObject({ attemptOutcome: 'PERMANENT', failureCode: 'internal' });
  });

  it('is the same line whatever the outcome, with no age for an unreadable time', () => {
    expect(
      attemptLine(
        'someTrigger',
        { id: TriggerEventId.of('evt-2'), eventAtUtcMs: null },
        attemptFailure({ code: 10 }),
        NOW,
      ),
    ).toEqual({
      fn: 'someTrigger',
      eventId: 'evt-2',
      attemptOutcome: 'TRANSIENT',
      failureCode: 'aborted',
      ageMs: null,
    });
  });
});

describe('a port’s refusal — judged by the code its adapter recorded as its reason (pass C, P-24)', () => {
  const { repositoryFailure } = TriggerAttemptSystem;

  it('reads a RepositoryError by its reason: a contended or absent store retries', () => {
    const refusal = RepositoryError.readFailed(
      'settings/bookingPolicy',
      'unavailable',
    );
    expect(repositoryFailure(refusal)).toEqual({
      error: refusal,
      failureCode: 'unavailable',
      attemptOutcome: 'TRANSIENT',
    });
    // attemptFailure reads the same off it, unless a code is given.
    expect(attemptFailure(refusal)).toEqual(repositoryFailure(refusal));
    expect(attemptFailure(refusal, 'internal')).toEqual({
      error: refusal,
      failureCode: 'internal',
      attemptOutcome: 'PERMANENT',
    });
  });

  it('reads the reason in any common spelling, and no reason as unknown — no redelivery is known to fix it', () => {
    expect(
      repositoryFailure(
        RepositoryError.writeFailed('a/1', 'firestore/ABORTED'),
      ),
    ).toMatchObject({ failureCode: 'aborted', attemptOutcome: 'TRANSIENT' });
    expect(
      repositoryFailure(RepositoryError.readFailed('a/1', 'permission-denied')),
    ).toMatchObject({
      failureCode: 'permission-denied',
      attemptOutcome: 'PERMANENT',
    });
    expect(repositoryFailure(RepositoryError.unavailable())).toMatchObject({
      failureCode: 'unknown',
      attemptOutcome: 'PERMANENT',
    });
    expect(
      repositoryFailure(RepositoryError.writeFailed(null, '')),
    ).toMatchObject({ failureCode: 'unknown', attemptOutcome: 'PERMANENT' });
  });

  it('never reads a port’s refusal by a `code` it does not carry — failureCode alone still says unknown', () => {
    expect(failureCode(RepositoryError.readFailed('a/1', 'unavailable'))).toBe(
      'unknown',
    );
  });

  it('decides an attempt over refusals and throws alike: transient when any one is, else the first', () => {
    const permanentThrow = { code: 13 };
    const transientRefusal = RepositoryError.readFailed('x', 'unavailable');
    expect(decisiveFailure([permanentThrow, transientRefusal])).toEqual({
      error: transientRefusal,
      failureCode: 'unavailable',
      attemptOutcome: 'TRANSIENT',
    });
    const permanentRefusal = RepositoryError.writeFailed('x', 'internal');
    expect(decisiveFailure([permanentRefusal, { code: 7 }])).toEqual({
      error: permanentRefusal,
      failureCode: 'internal',
      attemptOutcome: 'PERMANENT',
    });
  });

  it('is pure: same input → same output, inputs untouched', () => {
    const refusal = deepFreeze(RepositoryError.writeFailed('x', 'aborted'));
    const failures = deepFreeze([{ code: 7 }, refusal]);
    expect(repositoryFailure(refusal)).toEqual(repositoryFailure(refusal));
    expect(decisiveFailure(failures)).toEqual(decisiveFailure(failures));
    expect(decisiveFailure(failures)?.error).toBe(refusal);
  });
});

describe('properties', () => {
  it('reads every gRPC status by its own name, and never an age below zero', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -5, max: 40 }),
        fc.integer({ min: 0, max: 1e9 }),
        fc.integer({ min: 0, max: 1e9 }),
        (status, sent, now) => {
          const code = failureCode({ code: status });
          if (status < 1 || status > 16) expect(code).toBe('unknown');
          else expect(code).not.toBe('');
          expect(eventAgeMs(at(sent), at(now))).toBeGreaterThanOrEqual(0);
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
      failureCode: 'aborted',
      attemptOutcome: 'TRANSIENT',
    });
    const event = deepFreeze({
      id: TriggerEventId.of('evt-3'),
      eventAtUtcMs: at(1_000),
    });
    expect(
      attemptLine('fn', event, attemptFailure({ code: 14 }), at(4_000)),
    ).toEqual(
      attemptLine('fn', event, attemptFailure({ code: 14 }), at(4_000)),
    );
  });
});
