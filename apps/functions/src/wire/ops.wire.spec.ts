import { type CallableRequest, HttpsError } from 'firebase-functions/v2/https';
import { Actor, BackfillJobName, Role } from '@core/components';
import {
  CustomerId,
  RepositoryError,
  Result,
  RunBackfillRefusalCode,
  UserId,
} from '@core/primitives';
import { BackfillStart, WorkBudgetSystem } from '@core/systems';
import { type BackfillPageResult } from '@core/pipelines';
import { utcMs } from '@core/testing';
import { toHttpsError } from '../edge';
import {
  decodeRunBackfill,
  encodeRunBackfillAnswer,
  RUN_BACKFILL_TIMEOUT_SECONDS,
} from './ops.wire';

/*
 * The `runBackfill` callable's frozen wire (F1-3): today's `{ job, cursor? }`
 * decoded, today's page JSON encoded key for key, today's refusals as they
 * left (`run-backfill.ts`).
 */

function callable(
  data: unknown,
  auth: { readonly uid: string; readonly roles: readonly string[] } | null = {
    uid: 'u-sys',
    roles: ['sysadmin'],
  },
): CallableRequest<unknown> {
  return {
    data,
    ...(auth === null
      ? {}
      : { auth: { uid: auth.uid, token: { roles: auth.roles } } }),
  } as unknown as CallableRequest<unknown>;
}

function thrownBy(run: () => unknown): HttpsError {
  try {
    run();
  } catch (error) {
    if (error instanceof HttpsError) return error;
    throw error;
  }
  throw new Error('expected the decoder to answer with an HttpsError');
}

describe('decodeRunBackfill', () => {
  it('answers a caller nobody verified with today’s own `{ code }`', () => {
    const answer = thrownBy(() =>
      decodeRunBackfill(callable({ job: 'clientStats' }, null)),
    );
    expect(answer.code).toBe('unauthenticated');
    expect(answer.message).toBe('Sign in first');
    expect(answer.details).toEqual({ code: 'ops.backfill.unauthenticated' });
  });

  it('answers a token without the sysadmin claim with today’s own `{ code }`', () => {
    const answer = thrownBy(() =>
      decodeRunBackfill(
        callable({ job: 'clientStats' }, { uid: 'u-admin', roles: ['admin'] }),
      ),
    );
    expect(answer.code).toBe('permission-denied');
    expect(answer.message).toBe('Sysadmin only');
    expect(answer.details).toEqual({ code: 'ops.backfill.forbidden' });
  });

  it('decodes the job by today’s name, its start, and who ran it', () => {
    const resume = decodeRunBackfill(callable({ job: 'clientStats' }));
    expect(resume).toEqual({
      callerUserId: UserId.of('u-sys'),
      actor: Actor.forCaller(UserId.of('u-sys'), [Role.Sysadmin]),
      request: {
        backfillJobName: BackfillJobName.ClientStats,
        start: { backfillStart: BackfillStart.Resume },
      },
    });
    expect(
      decodeRunBackfill(callable({ job: 'subjectMirror', cursor: null }))
        .request,
    ).toEqual({
      backfillJobName: BackfillJobName.SubjectMirror,
      start: { backfillStart: BackfillStart.Top },
    });
    expect(
      decodeRunBackfill(callable({ job: 'clientStats', cursor: '~cus_ana' }))
        .request,
    ).toEqual({
      backfillJobName: BackfillJobName.ClientStats,
      start: { backfillStart: BackfillStart.After, cursor: '~cus_ana' },
    });
  });

  it('decodes an unknown job, or a cursor that is no document id, as no request — the pipeline refuses it after the stored roles', () => {
    expect(
      decodeRunBackfill(callable({ job: 'everything' })).request,
    ).toBeNull();
    expect(
      decodeRunBackfill(callable({ job: 'clientStats', cursor: 'a/b' }))
        .request,
    ).toBeNull();
    expect(decodeRunBackfill(callable(null)).request).toBeNull();
  });
});

describe('encodeRunBackfillAnswer', () => {
  const page: BackfillPageResult = {
    backfillJobName: BackfillJobName.ClientStats,
    cursor: null,
    done: true,
    processed: 0,
    storedClients: 2,
    stamped: 0,
    recomputed: 1,
    total: 40,
    runStartedAtUtcMs: utcMs('2026-09-28T09:00:00.123+03:00'),
    startedFrom: '~',
    sampleChecked: 2,
    sampleMismatched: [CustomerId.of('cus_ana')],
    budgetSpent: false,
  };

  it('answers today’s page JSON, key for key — the run’s start as today’s `toISOString()`', () => {
    const encoded = encodeRunBackfillAnswer(Result.ok(page));
    expect(encoded).toEqual({
      ok: true,
      value: {
        job: 'clientStats',
        cursor: null,
        done: true,
        processed: 0,
        storedClients: 2,
        stamped: 0,
        recomputed: 1,
        total: 40,
        runStartedAt: '2026-09-28T06:00:00.123Z',
        startedFrom: '~',
        sample: { checked: 2, mismatched: ['cus_ana'] },
        budgetSpent: false,
      },
    });
    expect(Object.keys(encoded.ok ? encoded.value : {})).toEqual([
      'job',
      'cursor',
      'done',
      'processed',
      'storedClients',
      'stamped',
      'recomputed',
      'total',
      'runStartedAt',
      'startedFrom',
      'sample',
      'budgetSpent',
    ]);
  });

  it('answers `sample: null` when none was taken, and today’s mirror job name', () => {
    const encoded = encodeRunBackfillAnswer(
      Result.ok({
        ...page,
        backfillJobName: BackfillJobName.SubjectMirror,
        sampleChecked: null,
        sampleMismatched: [],
      }),
    );
    expect(encoded.ok && encoded.value).toMatchObject({
      job: 'subjectMirror',
      sample: null,
    });
  });

  it.each([
    [
      RunBackfillRefusalCode.Forbidden,
      'permission-denied',
      'ops.backfill.forbidden',
    ],
    [
      RunBackfillRefusalCode.InvalidInput,
      'invalid-argument',
      'ops.backfill.invalid_input',
    ],
  ])('lets %s leave as today’s `{ code }` row', (errorCode, status, code) => {
    const encoded = encodeRunBackfillAnswer(Result.err({ errorCode }));
    if (encoded.ok) throw new Error('expected a refusal');
    const answer = toHttpsError(encoded.error);
    expect(answer.code).toBe(status);
    expect(answer.details).toEqual({ code });
  });

  it('turns a store failure into the edge’s unexpected throw', () => {
    expect(() =>
      encodeRunBackfillAnswer(
        Result.err(
          RepositoryError.readFailed('backfillJobs/clientStats', 'unavailable'),
        ),
      ),
    ).toThrow('REPOSITORY_READ_FAILED');
  });
});

describe('runBackfill — answers inside its callers’ wait', () => {
  it('keeps the long platform timeout as the reserve the call is never killed inside', () => {
    expect(RUN_BACKFILL_TIMEOUT_SECONDS).toBe(540);
  });

  it('takes new work for 49 s — the edge’s callable budget over that timeout — leaving the SDK’s 70 s wait the chunk in hand', () => {
    expect(
      WorkBudgetSystem.callableBudgetMs(RUN_BACKFILL_TIMEOUT_SECONDS),
    ).toBe(49_000);
  });
});
