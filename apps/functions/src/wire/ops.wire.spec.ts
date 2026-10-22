import type { CallableRequest } from 'firebase-functions/v2/https';
import {
  Actor,
  type BackfillCall,
  BackfillJobName,
  Role,
} from '@core/components';
import {
  CustomerId,
  RepositoryError,
  type Result,
  RunBackfillRefusalCode,
  UserId,
} from '@core/primitives';
import { BackfillStart, WorkBudgetSystem } from '@core/systems';
import { utcMs } from '@core/testing';
import { type EdgeError, toHttpsError } from '../edge';
import {
  decodeRunBackfill,
  encodeRunBackfillAnswer,
  RUN_BACKFILL_TIMEOUT_SECONDS,
  runBackfillRefusal,
} from './ops.wire';

/*
 * The `runBackfill` callable's flipped wire (Phase 4a 4A-4): the call
 * component `BackfillCall` `{ backfillJobName, backfillResume, cursor }`
 * decoded, the page answered as `BackfillCall.Page` (no ISO text), a
 * refusal the ecs-core struct projected by the shared table.
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

function valueOf<T>(result: Result<T, EdgeError>): T {
  if (!result.ok) {
    throw new Error(`expected a command: ${JSON.stringify(result.error)}`);
  }
  return result.value;
}

function refusalOf<T>(result: Result<T, EdgeError>): EdgeError {
  if (result.ok) throw new Error('expected a refusal');
  return result.error;
}

function wire(error: EdgeError) {
  const thrown = toHttpsError(error);
  return {
    code: thrown.code,
    message: thrown.message,
    details: thrown.details,
  };
}

const RESUME = {
  backfillJobName: BackfillJobName.ClientStats,
  backfillResume: true,
  cursor: null,
};

describe('decodeRunBackfill', () => {
  it('refuses a caller nobody verified as OPS_BACKFILL_UNAUTHENTICATED', () => {
    expect(wire(refusalOf(decodeRunBackfill(callable(RESUME, null))))).toEqual({
      code: 'unauthenticated',
      message: 'OPS_BACKFILL_UNAUTHENTICATED',
      details: { errorCode: 'OPS_BACKFILL_UNAUTHENTICATED' },
    });
  });

  it('refuses a token without the sysadmin claim as OPS_BACKFILL_FORBIDDEN', () => {
    expect(
      wire(
        refusalOf(
          decodeRunBackfill(
            callable(RESUME, { uid: 'u-admin', roles: ['admin'] }),
          ),
        ),
      ),
    ).toEqual({
      code: 'permission-denied',
      message: 'OPS_BACKFILL_FORBIDDEN',
      details: { errorCode: 'OPS_BACKFILL_FORBIDDEN' },
    });
  });

  it('decodes the SCREAMING job, its start, and who ran it', () => {
    expect(valueOf(decodeRunBackfill(callable(RESUME)))).toEqual({
      callerUserId: UserId.of('u-sys'),
      actor: Actor.forCaller(UserId.of('u-sys'), [Role.Sysadmin]),
      request: {
        backfillJobName: BackfillJobName.ClientStats,
        start: { backfillStart: BackfillStart.Resume },
      },
    });
    // `backfillResume` wins over a cursor sent beside it.
    expect(
      valueOf(decodeRunBackfill(callable({ ...RESUME, cursor: '~cus_ana' })))
        .request,
    ).toEqual({
      backfillJobName: BackfillJobName.ClientStats,
      start: { backfillStart: BackfillStart.Resume },
    });
    expect(
      valueOf(
        decodeRunBackfill(
          callable({
            backfillJobName: BackfillJobName.SubjectMirror,
            backfillResume: false,
            cursor: null,
          }),
        ),
      ).request,
    ).toEqual({
      backfillJobName: BackfillJobName.SubjectMirror,
      start: { backfillStart: BackfillStart.Top },
    });
    expect(
      valueOf(
        decodeRunBackfill(
          callable({
            backfillJobName: BackfillJobName.ClientStats,
            backfillResume: false,
            cursor: '~cus_ana',
          }),
        ),
      ).request,
    ).toEqual({
      backfillJobName: BackfillJobName.ClientStats,
      start: { backfillStart: BackfillStart.After, cursor: '~cus_ana' },
    });
  });

  it('decodes an unknown or legacy job, or a cursor that is no document id, as no request — the pipeline refuses it after the stored roles', () => {
    expect(
      valueOf(decodeRunBackfill(callable({ backfillJobName: 'EVERYTHING' })))
        .request,
    ).toBeNull();
    expect(
      valueOf(decodeRunBackfill(callable({ job: 'clientStats' }))).request,
    ).toBeNull();
    expect(
      valueOf(
        decodeRunBackfill(
          callable({
            backfillJobName: BackfillJobName.ClientStats,
            backfillResume: false,
            cursor: 'a/b',
          }),
        ),
      ).request,
    ).toBeNull();
    expect(valueOf(decodeRunBackfill(callable(null))).request).toBeNull();
  });
});

describe('encodeRunBackfillAnswer / runBackfillRefusal', () => {
  const page: BackfillCall.Page = {
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

  it('answers the page as `BackfillCall.Page`, key for key — the run’s start an instant, never an ISO text', () => {
    const encoded = encodeRunBackfillAnswer(page);
    expect(encoded).toEqual({
      backfillJobName: 'CLIENT_STATS',
      cursor: null,
      done: true,
      processed: 0,
      storedClients: 2,
      stamped: 0,
      recomputed: 1,
      total: 40,
      runStartedAtUtcMs: Date.UTC(2026, 8, 28, 6, 0, 0, 123),
      startedFrom: '~',
      sampleChecked: 2,
      sampleMismatched: ['cus_ana'],
      budgetSpent: false,
    });
    expect(Object.keys(encoded).sort()).toEqual(
      [
        'backfillJobName',
        'cursor',
        'done',
        'processed',
        'storedClients',
        'stamped',
        'recomputed',
        'total',
        'runStartedAtUtcMs',
        'startedFrom',
        'sampleChecked',
        'sampleMismatched',
        'budgetSpent',
      ].sort(),
    );
  });

  it('answers `sampleChecked: null` when none was taken', () => {
    expect(
      encodeRunBackfillAnswer({
        ...page,
        backfillJobName: BackfillJobName.SubjectMirror,
        sampleChecked: null,
        sampleMismatched: [],
      }),
    ).toMatchObject({
      backfillJobName: 'SUBJECT_MIRROR',
      sampleChecked: null,
      sampleMismatched: [],
    });
  });

  it.each([
    [RunBackfillRefusalCode.Forbidden, 'permission-denied'],
    [RunBackfillRefusalCode.InvalidInput, 'invalid-argument'],
  ])('lets %s leave as its code alone', (errorCode, status) => {
    expect(wire(runBackfillRefusal({ errorCode }))).toEqual({
      code: status,
      message: errorCode,
      details: { errorCode },
    });
  });

  it('turns a store failure into the edge’s unexpected throw', () => {
    expect(() =>
      runBackfillRefusal(
        RepositoryError.readFailed('backfillJobs/clientStats', 'unavailable'),
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
