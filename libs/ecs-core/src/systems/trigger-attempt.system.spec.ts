import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { OperationId, TriggerEventId, UtcEpochMs } from '@core/primitives';
import { RepositoryError } from '@core/errors';
import { deepFreeze, unwrapOk, utcMs } from '@core/testing';
import { AttemptOutcome } from '@core/components';
import { TriggerAttemptSystem } from './trigger-attempt.system';

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
    documentPath: null,
    writeOperationId: null,
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
      documentPath: null,
      writeOperationId: null,
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
        {
          id: TriggerEventId.of('evt-2'),
          eventAtUtcMs: null,
          documentPath: null,
          writeOperationId: null,
        },
        attemptFailure({ code: 10 }),
        NOW,
      ),
    ).toEqual({
      fn: 'someTrigger',
      eventId: 'evt-2',
      attemptOutcome: 'TRANSIENT',
      failureCode: 'aborted',
      ageMs: null,
      documentPath: null,
      writeOperationId: null,
    });
  });

  it('carries the written document and the operation id it holds, as the event names them (WS-4.3, DEP-19)', () => {
    const op = OperationId.of('op-00000000000001');
    expect(
      attemptLine(
        'rebuildBusyOnAppointmentChange',
        {
          id: TriggerEventId.of('evt-4'),
          eventAtUtcMs: at(NOW - 100),
          documentPath: 'appointments/apt-1',
          writeOperationId: op,
        },
        attemptFailure({ code: 14 }),
        NOW,
      ),
    ).toEqual({
      fn: 'rebuildBusyOnAppointmentChange',
      eventId: 'evt-4',
      attemptOutcome: 'TRANSIENT',
      failureCode: 'unavailable',
      ageMs: 100,
      documentPath: 'appointments/apt-1',
      writeOperationId: 'op-00000000000001',
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

describe('a malformed stored document — judged data-loss, never redelivered (edge-hardening D-2, D-5)', () => {
  const { repositoryFailure, DATA_LOSS_CODE } = TriggerAttemptSystem;

  it('judges a REPOSITORY_MALFORMED refusal by data-loss — PERMANENT, whatever field its reason names', () => {
    // A field that happens to spell a transient code must never earn a redelivery.
    const malformed = RepositoryError.malformed('appointments/a1', 'aborted');
    expect(DATA_LOSS_CODE).toBe('data-loss');
    expect(repositoryFailure(malformed)).toEqual({
      error: malformed,
      failureCode: 'data-loss',
      attemptOutcome: 'PERMANENT',
    });
    expect(attemptFailure(malformed)).toEqual(repositoryFailure(malformed));
    expect(
      repositoryFailure(
        RepositoryError.malformed('barberBusy/b1__2026-10-25', 'blocks[0]'),
      ),
    ).toMatchObject({ failureCode: 'data-loss', attemptOutcome: 'PERMANENT' });
  });

  it('lets a transient failure beside it decide the attempt — the redelivery re-runs both', () => {
    const malformed = RepositoryError.malformed('appointments/a1', 'seats');
    const unavailable = RepositoryError.readFailed('x', 'unavailable');
    expect(decisiveFailure([malformed, unavailable])).toEqual({
      error: unavailable,
      failureCode: 'unavailable',
      attemptOutcome: 'TRANSIENT',
    });
    expect(decisiveFailure([malformed])).toMatchObject({
      error: malformed,
      failureCode: 'data-loss',
      attemptOutcome: 'PERMANENT',
    });
  });

  it('keeps the allowlist closed: data-loss and internal stay permanent on the server', () => {
    expect(attemptOutcome('data-loss')).toBe('PERMANENT');
    expect(attemptOutcome('internal')).toBe('PERMANENT');
  });

  it('is pure: same input → same output, inputs untouched', () => {
    const malformed = deepFreeze(
      RepositoryError.malformed('appointments/a1', 'localDate'),
    );
    const failures = deepFreeze([malformed, { code: 7 }]);
    expect(repositoryFailure(malformed)).toEqual(repositoryFailure(malformed));
    expect(decisiveFailure(failures)).toEqual(decisiveFailure(failures));
    expect(malformed).toEqual({
      errorCode: 'REPOSITORY_MALFORMED',
      path: 'appointments/a1',
      reason: 'localDate',
    });
  });
});

describe('the dead letter — what a retrying trigger records when it gives up (WS-6, DEP-23)', () => {
  const {
    deadLetter,
    triggerFailure,
    RETRY_WINDOW_MS,
    LAST_ATTEMPT_MARGIN_MS,
  } = TriggerAttemptSystem;
  const transient = attemptFailure({ code: 14 });
  const permanent = attemptFailure({ code: 3 });
  /** The first age that counts as the window's last stretch. */
  const FINAL = RETRY_WINDOW_MS - LAST_ATTEMPT_MARGIN_MS;

  it('keeps a 24 h window and a 15 min last stretch', () => {
    expect(RETRY_WINDOW_MS).toBe(86_400_000);
    expect(LAST_ATTEMPT_MARGIN_MS).toBe(900_000);
    expect(FINAL).toBe(85_500_000);
  });

  it.each([
    ['PERMANENT, age unknown', permanent, null, true],
    ['PERMANENT, fresh', permanent, 0, true],
    ['PERMANENT, inside the last stretch', permanent, FINAL, true],
    ['TRANSIENT, age unknown', transient, null, false],
    ['TRANSIENT, fresh', transient, 0, false],
    ['TRANSIENT, one ms before the last stretch', transient, FINAL - 1, false],
    ['TRANSIENT, at the last stretch', transient, FINAL, true],
    ['TRANSIENT, at the window’s end', transient, RETRY_WINDOW_MS, true],
    ['TRANSIENT, past the window', transient, RETRY_WINDOW_MS + 1, true],
  ] as const)('%s → %s', (_name, failure, ageMs, expected) => {
    expect(deadLetter(failure, ageMs)).toBe(expected);
  });

  it('records the line’s ids and codes, the event id as the document id, stamped at now', () => {
    const NOW = at(1_790_000_000_000);
    const op = OperationId.of('op-00000000000005');
    const line = attemptLine(
      'rebuildBusyOnAppointmentChange',
      {
        id: TriggerEventId.of('evt-5'),
        eventAtUtcMs: at(1_790_000_000_000 - 2_000),
        documentPath: 'appointments/apt-5',
        writeOperationId: op,
      },
      permanent,
      NOW,
    );
    expect(triggerFailure(line, NOW)).toEqual({
      id: 'evt-5',
      fn: 'rebuildBusyOnAppointmentChange',
      documentPath: 'appointments/apt-5',
      attemptOutcome: AttemptOutcome.Permanent,
      failureCode: 'invalid-argument',
      recordedAtUtcMs: NOW,
      writeOperationId: op,
    });
  });

  it('records a schedule tick with no document and no operation as nulls, never absent keys', () => {
    const NOW = at(5_000);
    const failure = triggerFailure(
      attemptLine(
        'sweepClientStatsPolicyRecompute',
        {
          id: TriggerEventId.of('evt-6'),
          eventAtUtcMs: null,
          documentPath: null,
          writeOperationId: null,
        },
        transient,
        NOW,
      ),
      NOW,
    );
    expect(failure).toEqual({
      id: 'evt-6',
      fn: 'sweepClientStatsPolicyRecompute',
      documentPath: null,
      attemptOutcome: AttemptOutcome.Transient,
      failureCode: 'unavailable',
      recordedAtUtcMs: NOW,
      writeOperationId: null,
    });
    expect(Object.keys(failure)).toHaveLength(7);
  });

  it('is pure: same input → same output, inputs untouched', () => {
    const NOW = at(9_000);
    const line = deepFreeze(
      attemptLine(
        'fn',
        {
          id: TriggerEventId.of('evt-7'),
          eventAtUtcMs: at(1_000),
          documentPath: 'customers/cus-7',
          writeOperationId: OperationId.of('op-00000000000007'),
        },
        transient,
        NOW,
      ),
    );
    const failure = deepFreeze(attemptFailure({ code: 10 }));
    expect(triggerFailure(line, NOW)).toEqual(triggerFailure(line, NOW));
    expect(deadLetter(failure, FINAL)).toBe(deadLetter(failure, FINAL));
  });

  it('dead-letters every PERMANENT failure, and a TRANSIENT one exactly when its known age reaches the last stretch', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(3, 5, 7, 10, 13, 14),
        fc.option(fc.integer({ min: 0, max: 2 * RETRY_WINDOW_MS }), {
          nil: null,
        }),
        (status, ageMs) => {
          const failure = attemptFailure({ code: status });
          const expected =
            failure.attemptOutcome === AttemptOutcome.Permanent ||
            (ageMs !== null && ageMs >= FINAL);
          expect(deadLetter(failure, ageMs)).toBe(expected);
        },
      ),
    );
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
      documentPath: 'customers/cus-1',
      writeOperationId: OperationId.of('op-00000000000003'),
    });
    expect(
      attemptLine('fn', event, attemptFailure({ code: 14 }), at(4_000)),
    ).toEqual(
      attemptLine('fn', event, attemptFailure({ code: 14 }), at(4_000)),
    );
  });
});
