import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type Functions, FunctionsError } from 'firebase/functions';
import {
  callableClientPorts,
  loyaltyCatalogMemo,
} from '@creativo/infrastructure/firebase-app';
import {
  StreakPublishCall,
  StreakPublishOutcome,
  StreakRule,
  StreakRuleDirection,
  StreakTransition,
} from '@core/components';
import {
  PublishRequestId,
  RepositoryErrorCode,
  StreakPublishError,
  StreakPublishErrorCode,
  StreakRuleField,
} from '@core/primitives';
import { localDate, unwrapErr, unwrapOk } from '@core/testing';

const { callableMock, httpsCallableMock } = vi.hoisted(() => {
  const callable = vi.fn();
  return {
    callableMock: callable,
    httpsCallableMock: vi.fn<
      (functions: unknown, name: string) => typeof callable
    >(() => callable),
  };
});

vi.mock('firebase/functions', async () => ({
  ...(await vi.importActual<typeof import('firebase/functions')>(
    'firebase/functions',
  )),
  httpsCallable: httpsCallableMock,
}));

const { streakPublishPorts } = await import('./streak-publish.adapter');

const FUNCTIONS = { app: 'functions' } as unknown as Functions;
const CADENCE = StreakRule.DEFAULT_DEFINITION_ID;
const ASKED_DAY = localDate('2026-10-05');

/** The recommended rule with grace widened to ten days from 5.10: version 2, which waits. */
const WIDER_GRACE: StreakRule = {
  ...StreakRule.DEFAULT,
  version: 2,
  effectiveFromLocalDate: ASKED_DAY,
  graceDays: 10,
};

function call(overrides: Partial<StreakPublishCall> = {}): StreakPublishCall {
  return {
    requestId: PublishRequestId.of('req-1'),
    streakId: CADENCE,
    baseVersion: 1,
    rule: WIDER_GRACE,
    streakTransition: StreakTransition.Grandfather,
    previewHash: null,
    ...overrides,
  };
}

const withdrawal = (version = 2) =>
  StreakPublishCall.withdraw(PublishRequestId.of('req-undo'), CADENCE, version);

/** The ports over the REAL callable client: the decoder and the classification are the web's own. */
function setUp() {
  const invalidate = vi.fn();
  const memo = { ...loyaltyCatalogMemo(), invalidate };
  return {
    invalidate,
    ports: streakPublishPorts(callableClientPorts(FUNCTIONS), memo),
  };
}

/** What the callable was sent, the n-th time. */
const sent = (n = 0): unknown => callableMock.mock.calls.at(n)?.[0];

const PUBLISHED = {
  streakPublishOutcome: StreakPublishOutcome.Published,
  version: 2,
  effectiveFromLocalDate: '2026-10-05',
  streakRuleDirection: StreakRuleDirection.Looser,
};

/** A refused answer as the flipped wire projects it: the code, its fields, its two days. */
const refused = (
  errorCode: string,
  extra: Partial<{
    fields: readonly unknown[];
    earliest: string | null;
    effectiveFromLocalDate: string | null;
  }> = {},
) => ({
  streakPublishOutcome: StreakPublishOutcome.Refused,
  errorCode,
  fields: [],
  earliest: null,
  effectiveFromLocalDate: null,
  ...extra,
});

describe('streakPublishPorts — publish, through the callable client', () => {
  beforeEach(() => {
    callableMock.mockReset();
    httpsCallableMock.mockClear();
  });

  it('sends the publish call as the flat call component it is', async () => {
    callableMock.mockResolvedValueOnce({ data: PUBLISHED });
    const { ports } = setUp();
    const publish = call({ previewHash: 'hash-1', baseVersion: 1 });

    await ports.publishStreakRule(publish);

    expect(httpsCallableMock).toHaveBeenCalledWith(
      FUNCTIONS,
      'publishStreakDefinition',
    );
    expect(callableMock).toHaveBeenCalledTimes(1);
    expect(sent()).toBe(publish);
  });

  it('answers with what the SERVER wrote: its number, its day, its verdict', async () => {
    // After a withdrawal the writer numbers past the proposal.
    callableMock.mockResolvedValueOnce({
      data: {
        ...PUBLISHED,
        version: 3,
        streakRuleDirection: StreakRuleDirection.Mixed,
      },
    });
    const { ports } = setUp();

    const receipt = unwrapOk(await ports.publishStreakRule(call()));

    expect(receipt).toEqual({
      version: 3,
      effectiveFromLocalDate: '2026-10-05',
      streakRuleDirection: StreakRuleDirection.Mixed,
    });
  });

  it('drops the session’s copy of the catalogue once the rule is written', async () => {
    callableMock.mockResolvedValueOnce({ data: PUBLISHED });
    const { ports, invalidate } = setUp();

    await ports.publishStreakRule(call());

    expect(invalidate).toHaveBeenCalledTimes(1);
  });

  it.each<[string, Record<string, unknown>, StreakPublishError]>([
    [
      'CALLER_NOT_ADMIN',
      refused(StreakPublishErrorCode.CallerNotAdmin),
      StreakPublishError.callerNotAdmin(),
    ],
    [
      'INVALID',
      refused(StreakPublishErrorCode.Invalid, {
        fields: [StreakRuleField.GraceDays, 7, StreakRuleField.IntervalKind],
      }),
      StreakPublishError.invalid([
        StreakRuleField.GraceDays,
        StreakRuleField.IntervalKind,
      ]),
    ],
    [
      'STALE',
      refused(StreakPublishErrorCode.Stale),
      StreakPublishError.stale(1, 1),
    ],
    [
      'TOO_EARLY',
      refused(StreakPublishErrorCode.TooEarly, {
        earliest: '2026-10-05',
        effectiveFromLocalDate: '2026-10-05',
      }),
      StreakPublishError.tooEarly(ASKED_DAY, ASKED_DAY),
    ],
    [
      'RECOMPUTE_NEEDS_ENGINE',
      refused(StreakPublishErrorCode.RecomputeNeedsEngine),
      StreakPublishError.recomputeNeedsEngine(),
    ],
    [
      'PREVIEW_STALE',
      refused(StreakPublishErrorCode.PreviewStale),
      StreakPublishError.previewStale(),
    ],
  ])(
    'hands over the server’s answered refusal %s as its flat struct, never dropping the copy',
    async (_code, data, refusal) => {
      callableMock.mockResolvedValueOnce({ data });
      const { ports, invalidate } = setUp();

      const result = await ports.publishStreakRule(call());

      expect(unwrapErr(result)).toEqual(refusal);
      expect(invalidate).not.toHaveBeenCalled();
    },
  );

  it('reads an INVALID refusal’s flat fields as named, in order — a field the page does not know kept as written', async () => {
    callableMock.mockResolvedValueOnce({
      data: refused(StreakPublishErrorCode.Invalid, {
        fields: [
          StreakRuleField.IntervalDays,
          StreakRuleField.GraceDays,
          StreakRuleField.BookingHoldMaxDaysPastDue,
          StreakRuleField.ScheduledEffectiveFromLocalDate,
          StreakRuleField.NameBg,
          'somethingNew',
        ],
      }),
    });
    const { ports } = setUp();

    const refusal = unwrapErr(await ports.publishStreakRule(call()));

    expect(refusal).toEqual({
      errorCode: StreakPublishErrorCode.Invalid,
      fields: [
        StreakRuleField.IntervalDays,
        StreakRuleField.GraceDays,
        StreakRuleField.BookingHoldMaxDaysPastDue,
        StreakRuleField.ScheduledEffectiveFromLocalDate,
        StreakRuleField.NameBg,
        'somethingNew',
      ],
    });
  });

  it('reads TOO_EARLY with the first day the server names', async () => {
    callableMock.mockResolvedValueOnce({
      data: refused(StreakPublishErrorCode.TooEarly, {
        fields: [StreakRuleField.EffectiveFromLocalDate],
        earliest: '2026-10-29',
        effectiveFromLocalDate: '2026-10-05',
      }),
    });
    const { ports } = setUp();

    const refusal = unwrapErr(await ports.publishStreakRule(call()));

    expect(refusal).toEqual(
      StreakPublishError.tooEarly(ASKED_DAY, localDate('2026-10-29')),
    );
  });

  it('reads a TOO_EARLY that names no day as the day the publish asked for', async () => {
    callableMock.mockResolvedValueOnce({
      data: refused(StreakPublishErrorCode.TooEarly),
    });
    const { ports } = setUp();

    const refusal = unwrapErr(await ports.publishStreakRule(call()));

    expect(refusal).toEqual(StreakPublishError.tooEarly(ASKED_DAY, ASKED_DAY));
  });

  it('reads a refusal that names no head version as the version the call named', async () => {
    callableMock.mockResolvedValueOnce({
      data: refused(StreakPublishErrorCode.Stale),
    });
    const { ports } = setUp();

    const refusal = unwrapErr(
      await ports.publishStreakRule(call({ baseVersion: 4 })),
    );

    expect(refusal).toEqual(StreakPublishError.stale(4, 4));
  });

  it.each([
    // As the callable throws it when nobody is signed in.
    [
      'unauthenticated',
      new FunctionsError('unauthenticated', 'no', {
        errorCode: StreakPublishErrorCode.CallerUnauthenticated,
      }),
    ],
    // As the platform throws it before the callable is reached.
    ['permission-denied', new FunctionsError('permission-denied', 'no')],
  ])(
    'reads the SDK’s own «%s» as the caller not being the admin pair',
    async (_status, thrown) => {
      callableMock.mockRejectedValueOnce(thrown);
      const { ports } = setUp();

      const refusal = unwrapErr(await ports.publishStreakRule(call()));

      expect(refusal).toEqual(StreakPublishError.callerNotAdmin());
    },
  );

  it.each([
    ['offline', new FunctionsError('unavailable', 'offline'), 'unavailable'],
    [
      'a timeout',
      new FunctionsError('deadline-exceeded', 'late'),
      'deadline-exceeded',
    ],
    [
      'a write that fell over',
      new FunctionsError('internal', 'boom'),
      'internal',
    ],
    [
      'a request the server could not read',
      new FunctionsError(
        'invalid-argument',
        'Invalid rhythm rule request: requestId',
        {
          errorCode: StreakPublishErrorCode.InvalidInput,
          field: 'requestId',
        },
      ),
      'invalid-argument',
    ],
  ])(
    'tells %s apart from a refusal: the request got no answer',
    async (_what, thrown, reason) => {
      callableMock.mockRejectedValueOnce(thrown);
      const { ports, invalidate } = setUp();

      const failure = unwrapErr(await ports.publishStreakRule(call()));

      expect(failure).toEqual({
        errorCode: RepositoryErrorCode.WriteFailed,
        path: 'streakDefinitions/cadence',
        reason,
      });
      expect(invalidate).not.toHaveBeenCalled();
    },
  );

  it.each<[string, unknown]>([
    ['nothing', undefined],
    ['null', null],
    ['a word', 'PUBLISHED'],
    ['a list', [PUBLISHED]],
    [
      'an outcome nobody knows',
      { ...PUBLISHED, streakPublishOutcome: 'QUEUED' },
    ],
    ['the retired lowercase wire', { kind: 'published', version: 2 }],
    ['a publish with no number', { ...PUBLISHED, version: undefined }],
    ['a publish numbered zero', { ...PUBLISHED, version: 0 }],
    ['a publish numbered in halves', { ...PUBLISHED, version: 2.5 }],
    [
      'a day that is no day',
      { ...PUBLISHED, effectiveFromLocalDate: '2026-02-30' },
    ],
    [
      'an instant for a day',
      { ...PUBLISHED, effectiveFromLocalDate: '2026-10-05T00:00:00.000Z' },
    ],
    ['a verdict nobody knows', { ...PUBLISHED, streakRuleDirection: 'KINDER' }],
    ['a refusal in a code nobody knows', refused('LOYALTY_BUSY')],
    ['something that is no error, thrown', 'THROWN'],
    [
      'a withdrawal, to a publish',
      { streakPublishOutcome: StreakPublishOutcome.Withdrawn, version: 2 },
    ],
  ])(
    'never reports a publish on %s: it is no answer at all',
    async (_what, data) => {
      if (data === 'THROWN') callableMock.mockRejectedValueOnce('nope');
      else callableMock.mockResolvedValueOnce({ data });
      const { ports, invalidate } = setUp();

      const failure = unwrapErr(await ports.publishStreakRule(call()));

      expect(failure).toMatchObject({
        errorCode: RepositoryErrorCode.Malformed,
        path: 'streakDefinitions/cadence',
      });
      expect(invalidate).not.toHaveBeenCalled();
    },
  );
});

describe('streakPublishPorts — withdraw, through the same callable', () => {
  beforeEach(() => {
    callableMock.mockReset();
    httpsCallableMock.mockClear();
  });

  it('names the version it calls off', async () => {
    callableMock.mockResolvedValueOnce({
      data: {
        streakPublishOutcome: StreakPublishOutcome.Withdrawn,
        version: 2,
      },
    });
    const { ports } = setUp();
    const undo = withdrawal();

    const result = await ports.withdrawStreakRule(undo);

    expect(httpsCallableMock).toHaveBeenCalledWith(
      FUNCTIONS,
      'publishStreakDefinition',
    );
    expect(sent()).toBe(undo);
    expect(sent()).toEqual({
      requestId: 'req-undo',
      streakId: 'cadence',
      version: 2,
    });
    expect(unwrapOk(result)).toBeUndefined();
  });

  it('drops the session’s copy of the catalogue once the version is called off', async () => {
    callableMock.mockResolvedValueOnce({
      data: {
        streakPublishOutcome: StreakPublishOutcome.Withdrawn,
        version: 2,
      },
    });
    const { ports, invalidate } = setUp();

    await ports.withdrawStreakRule(withdrawal());

    expect(invalidate).toHaveBeenCalledTimes(1);
  });

  it('hands over STALE when the version no longer waits', async () => {
    callableMock.mockResolvedValueOnce({
      data: refused(StreakPublishErrorCode.Stale),
    });
    const { ports, invalidate } = setUp();

    const refusal = unwrapErr(await ports.withdrawStreakRule(withdrawal()));

    expect(refusal).toEqual(StreakPublishError.stale(2, 2));
    expect(invalidate).not.toHaveBeenCalled();
  });

  it.each<[string, unknown]>([
    [
      'another version',
      { streakPublishOutcome: StreakPublishOutcome.Withdrawn, version: 3 },
    ],
    ['a publish', PUBLISHED],
    ['nothing', undefined],
    // A withdrawal asks for no day: a TOO_EARLY naming none is no refusal it can carry.
    ['a TOO_EARLY naming no day', refused(StreakPublishErrorCode.TooEarly)],
  ])('never reports a withdrawal on an answer for %s', async (_what, data) => {
    callableMock.mockResolvedValueOnce({ data });
    const { ports, invalidate } = setUp();

    const failure = unwrapErr(await ports.withdrawStreakRule(withdrawal()));

    expect(failure).toMatchObject({
      errorCode: RepositoryErrorCode.Malformed,
      path: 'streakDefinitions/cadence',
    });
    expect(invalidate).not.toHaveBeenCalled();
  });

  it('tells a request that got no answer apart from a refusal', async () => {
    callableMock.mockRejectedValueOnce(
      new FunctionsError('unavailable', 'offline'),
    );
    const { ports } = setUp();

    const failure = unwrapErr(await ports.withdrawStreakRule(withdrawal()));

    expect(failure).toEqual({
      errorCode: RepositoryErrorCode.WriteFailed,
      path: 'streakDefinitions/cadence',
      reason: 'unavailable',
    });
  });
});
