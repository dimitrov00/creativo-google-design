import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Functions } from 'firebase/functions';
import { loyaltyCatalogMemo } from '@creativo/infrastructure/firebase-app';
import {
  StreakExcuse,
  StreakInterval,
  StreakOnBreak,
  StreakPublishCall,
  StreakQualifier,
  StreakRule,
  StreakRuleDirection,
  StreakTransition,
} from '@core/components';
import {
  PublishRequestId,
  RepositoryErrorCode,
  ServiceCategoryId,
  ServiceId,
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

const { streakPublishGatewayPorts } =
  await import('./streak-publish-gateway.adapter');

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

/**
 * `StreakDefinition.default()` as the legacy draft mapper encoded it —
 * recorded verbatim on 2026-10-22 (6d43e1c), before the mapper was
 * deleted. The frozen wire (F3-3): the server's decoder reads exactly this.
 */
const RECOMMENDED_DRAFT = {
  version: 1,
  effectiveFrom: '2025-03-01',
  enabled: true,
  qualifier: { kind: 'anyVisit' },
  minGapDays: 7,
  bookingHold: { enabled: true, maxDaysPastDue: 14 },
  interval: { kind: 'fixed', days: 42 },
  graceDays: 7,
  riskLeadDays: 7,
  protections: { enabled: true, maxBanked: 2, earnEvery: 5, startWith: 0 },
  excuses: ['shopClosure', 'barberAbsence', 'staffCancelled'],
  clientPause: { enabled: false, maxDaysPerYear: 90 },
  repair: { enabled: true, windowDays: 14, perYear: 1 },
  onBreak: 'restart',
};

/**
 * The legacy mapper's encoding of the default revised with the services
 * qualifier, a personal interval, the closed-days excuse, a client pause
 * and a held miss, from 2.11 — recorded the same day.
 */
const VARIANT_DRAFT = {
  version: 2,
  effectiveFrom: '2026-11-02',
  enabled: true,
  qualifier: { kind: 'services', serviceIds: ['svc-fade', 'svc-beard'] },
  minGapDays: 7,
  bookingHold: { enabled: true, maxDaysPastDue: 14 },
  interval: {
    kind: 'personal',
    tolerancePct: 50,
    minDays: 21,
    maxDays: 70,
    fallbackDays: 42,
  },
  graceDays: 7,
  riskLeadDays: 7,
  protections: { enabled: true, maxBanked: 2, earnEvery: 5, startWith: 0 },
  excuses: ['shopClosure', 'closedDays'],
  clientPause: { enabled: true, maxDaysPerYear: 60 },
  repair: { enabled: true, windowDays: 14, perYear: 1 },
  onBreak: 'hold',
};

/** The same revision as {@link VARIANT_DRAFT}, as the flat rule the admin page sends. */
const VARIANT_RULE: StreakRule = {
  version: 2,
  effectiveFromLocalDate: localDate('2026-11-02'),
  enabled: true,
  streakQualifier: StreakQualifier.Services,
  qualifierServiceIds: [ServiceId.of('svc-fade'), ServiceId.of('svc-beard')],
  minGapDays: 7,
  bookingHoldEnabled: true,
  bookingHoldMaxDaysPastDue: 14,
  streakInterval: StreakInterval.Personal,
  intervalTolerancePct: 50,
  intervalMinDays: 21,
  intervalMaxDays: 70,
  intervalFallbackDays: 42,
  graceDays: 7,
  riskLeadDays: 7,
  protectionsEnabled: true,
  protectionsMaxBanked: 2,
  protectionsEarnEvery: 5,
  protectionsStartWith: 0,
  excuses: [StreakExcuse.ShopClosure, StreakExcuse.ClosedDays],
  clientPauseEnabled: true,
  clientPauseMaxDaysPerYear: 60,
  repairEnabled: true,
  repairWindowDays: 14,
  repairPerYear: 1,
  onBreak: StreakOnBreak.Hold,
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

function setUp() {
  const invalidate = vi.fn();
  const memo = { ...loyaltyCatalogMemo(), invalidate };
  return { invalidate, gateway: streakPublishGatewayPorts(FUNCTIONS, memo) };
}

/** What the callable was sent, the n-th time. */
const sent = (n = 0): unknown => callableMock.mock.calls.at(n)?.[0];

const PUBLISHED = {
  kind: 'published',
  version: 2,
  effectiveFrom: '2026-10-05',
  direction: 'looser',
};

describe('streakPublishGatewayPorts — publish, through the callable', () => {
  beforeEach(() => {
    callableMock.mockReset();
    httpsCallableMock.mockClear();
  });

  it('sends the rule as the callable’s request: the draft is the rule’s own nested body', async () => {
    callableMock.mockResolvedValueOnce({ data: PUBLISHED });
    const { gateway } = setUp();

    await gateway.publishStreakRule(
      call({ previewHash: 'hash-1', baseVersion: 1 }),
    );

    expect(httpsCallableMock).toHaveBeenCalledWith(
      FUNCTIONS,
      'publishStreakDefinition',
    );
    expect(callableMock).toHaveBeenCalledTimes(1);
    expect(sent()).toEqual({
      op: 'publish',
      requestId: 'req-1',
      streakId: 'cadence',
      baseVersion: 1,
      draft: {
        ...RECOMMENDED_DRAFT,
        version: 2,
        effectiveFrom: '2026-10-05',
        graceDays: 10,
      },
      effectiveFrom: '2026-10-05',
      transition: 'grandfather',
      previewHash: 'hash-1',
    });
  });

  it('encodes the recommended rule exactly as the legacy draft mapper did, key order included', async () => {
    callableMock.mockResolvedValueOnce({ data: PUBLISHED });
    const { gateway } = setUp();

    await gateway.publishStreakRule(call({ rule: StreakRule.DEFAULT }));

    const { draft } = sent() as { readonly draft: object };
    expect(draft).toEqual(RECOMMENDED_DRAFT);
    expect(JSON.stringify(draft)).toBe(JSON.stringify(RECOMMENDED_DRAFT));
  });

  it('encodes every variant and word as the legacy draft mapper did', async () => {
    callableMock.mockResolvedValue({ data: PUBLISHED });
    const { gateway } = setUp();

    await gateway.publishStreakRule(
      call({
        rule: VARIANT_RULE,
        streakTransition: StreakTransition.Recompute,
      }),
    );
    await gateway.publishStreakRule(
      call({
        rule: {
          ...StreakRule.DEFAULT,
          streakQualifier: StreakQualifier.Categories,
          qualifierCategoryIds: [ServiceCategoryId.of('cat-hair')],
        },
      }),
    );

    const first = sent(0) as {
      readonly draft: object;
      readonly transition: string;
    };
    expect(JSON.stringify(first.draft)).toBe(JSON.stringify(VARIANT_DRAFT));
    expect(first.transition).toBe('recompute');
    expect(sent(1)).toMatchObject({
      draft: { qualifier: { kind: 'categories', categoryIds: ['cat-hair'] } },
    });
  });

  it('carries no id and no name in the draft: they are the head’s', async () => {
    callableMock.mockResolvedValueOnce({ data: PUBLISHED });
    const { gateway } = setUp();

    await gateway.publishStreakRule(call());

    expect(sent()).toMatchObject({ draft: { version: 2, graceDays: 10 } });
    expect(sent()).not.toHaveProperty('draft.id');
    expect(sent()).not.toHaveProperty('draft.name');
  });

  it('answers with what the SERVER wrote: its number, its day, its verdict', async () => {
    // After a withdrawal the writer numbers past the proposal.
    callableMock.mockResolvedValueOnce({
      data: { ...PUBLISHED, version: 3, direction: 'mixed' },
    });
    const { gateway } = setUp();

    const receipt = unwrapOk(await gateway.publishStreakRule(call()));

    expect(receipt).toEqual({
      version: 3,
      effectiveFromLocalDate: '2026-10-05',
      streakRuleDirection: StreakRuleDirection.Mixed,
    });
  });

  it('drops the session’s copy of the catalogue once the rule is written', async () => {
    callableMock.mockResolvedValueOnce({ data: PUBLISHED });
    const { gateway, invalidate } = setUp();

    await gateway.publishStreakRule(call());

    expect(invalidate).toHaveBeenCalledTimes(1);
  });

  it.each<[string, StreakPublishError]>([
    ['notAdmin', StreakPublishError.callerNotAdmin()],
    ['invalid', StreakPublishError.invalid(['graceDays', 'interval'])],
    ['stale', StreakPublishError.stale(1, 1)],
    ['tooEarly', StreakPublishError.tooEarly(ASKED_DAY, ASKED_DAY)],
    ['recomputeNeedsEngine', StreakPublishError.recomputeNeedsEngine()],
    ['previewStale', StreakPublishError.previewStale()],
  ])(
    'hands over the server’s refusal «%s» as its flat struct, never dropping the copy',
    async (code, refusal) => {
      callableMock.mockResolvedValueOnce({
        data: { kind: 'refused', code, fields: ['graceDays', 7, 'interval'] },
      });
      const { gateway, invalidate } = setUp();

      const result = await gateway.publishStreakRule(call());

      expect(unwrapErr(result)).toEqual(refusal);
      expect(invalidate).not.toHaveBeenCalled();
    },
  );

  it('reads an «invalid» refusal’s legacy locators as the flat fields, in the order named', async () => {
    callableMock.mockResolvedValueOnce({
      data: {
        kind: 'refused',
        code: 'invalid',
        fields: [
          'interval.days',
          'graceDays',
          'bookingHold.maxDaysPastDue',
          'protections.startWith',
          'qualifier.serviceIds',
          'excuses',
          'scheduled.effectiveFrom',
          'name.bg',
          'effectiveFrom',
          'somethingNew',
        ],
      },
    });
    const { gateway } = setUp();

    const refusal = unwrapErr(await gateway.publishStreakRule(call()));

    expect(refusal).toEqual({
      errorCode: StreakPublishErrorCode.Invalid,
      fields: [
        StreakRuleField.IntervalDays,
        StreakRuleField.GraceDays,
        StreakRuleField.BookingHoldMaxDaysPastDue,
        StreakRuleField.ProtectionsStartWith,
        StreakRuleField.QualifierServiceIds,
        StreakRuleField.Excuses,
        StreakRuleField.ScheduledEffectiveFromLocalDate,
        StreakRuleField.NameBg,
        StreakRuleField.EffectiveFromLocalDate,
        'somethingNew',
      ],
    });
  });

  it('reads «tooEarly» by its word, and carries the first day the server names', async () => {
    callableMock.mockResolvedValueOnce({
      data: {
        kind: 'refused',
        code: 'tooEarly',
        fields: ['effectiveFrom'],
        earliest: '2026-10-29',
      },
    });
    const { gateway } = setUp();

    const refusal = unwrapErr(await gateway.publishStreakRule(call()));

    expect(refusal).toEqual(
      StreakPublishError.tooEarly(ASKED_DAY, localDate('2026-10-29')),
    );
  });

  it('reads a «tooEarly» that names no day the wire can vouch for as the day the publish asked for', async () => {
    callableMock.mockResolvedValueOnce({
      data: { kind: 'refused', code: 'tooEarly', earliest: '2026-02-30' },
    });
    const { gateway } = setUp();

    const refusal = unwrapErr(await gateway.publishStreakRule(call()));

    expect(refusal).toEqual(StreakPublishError.tooEarly(ASKED_DAY, ASKED_DAY));
  });

  it('reads a refusal that names no field', async () => {
    callableMock.mockResolvedValueOnce({
      data: { kind: 'refused', code: 'stale' },
    });
    const { gateway } = setUp();

    const refusal = unwrapErr(
      await gateway.publishStreakRule(call({ baseVersion: 4 })),
    );

    expect(refusal).toEqual(StreakPublishError.stale(4, 4));
  });

  it.each([
    [
      'details.code',
      { details: { code: 'tooEarly', fields: ['effectiveFrom'] } },
    ],
    [
      'details.refusal',
      { details: { refusal: 'tooEarly', fields: ['effectiveFrom'] } },
    ],
  ])('reads a refusal that arrived thrown (%s)', async (_where, thrown) => {
    callableMock.mockRejectedValueOnce(
      Object.assign(new Error('failed-precondition'), {
        code: 'functions/failed-precondition',
        ...thrown,
      }),
    );
    const { gateway } = setUp();

    const refusal = unwrapErr(await gateway.publishStreakRule(call()));

    expect(refusal).toEqual(StreakPublishError.tooEarly(ASKED_DAY, ASKED_DAY));
  });

  it.each([
    // As the callable throws it when nobody is signed in.
    [
      'functions/unauthenticated',
      { code: 'loyalty.streak_publish.unauthenticated', params: {} },
    ],
    // As the platform throws it before the callable is reached.
    ['functions/permission-denied', undefined],
  ])(
    'reads the SDK’s own «%s» as the caller not being the admin pair',
    async (code, details) => {
      callableMock.mockRejectedValueOnce(
        Object.assign(new Error('no'), { code, details }),
      );
      const { gateway } = setUp();

      const refusal = unwrapErr(await gateway.publishStreakRule(call()));

      expect(refusal).toEqual(StreakPublishError.callerNotAdmin());
    },
  );

  it.each([
    [
      'offline',
      Object.assign(new Error('offline'), { code: 'functions/unavailable' }),
      'functions/unavailable',
    ],
    [
      'a timeout',
      Object.assign(new Error('late'), {
        code: 'functions/deadline-exceeded',
      }),
      'functions/deadline-exceeded',
    ],
    [
      'a write that fell over',
      Object.assign(new Error('boom'), {
        code: 'functions/internal',
        details: { code: 'loyalty.streak_publish.store_failed', params: {} },
      }),
      'functions/internal',
    ],
    [
      'a request the server could not read',
      Object.assign(new Error('Invalid rhythm rule request: requestId'), {
        code: 'functions/invalid-argument',
        details: {
          code: 'loyalty.streak_publish.invalid_input',
          params: { field: 'requestId' },
        },
      }),
      'functions/invalid-argument',
    ],
    ['something that is no error', 'nope', null],
  ])(
    'tells %s apart from a refusal: the request got no answer',
    async (_what, thrown, reason) => {
      callableMock.mockRejectedValueOnce(thrown);
      const { gateway, invalidate } = setUp();

      const failure = unwrapErr(await gateway.publishStreakRule(call()));

      expect(failure).toEqual({
        errorCode: RepositoryErrorCode.WriteFailed,
        path: 'streakDefinitions/cadence',
        reason,
      });
      expect(invalidate).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['nothing', undefined],
    ['null', null],
    ['a word', 'published'],
    ['a list', [PUBLISHED]],
    ['a kind nobody knows', { kind: 'queued' }],
    ['a publish with no number', { ...PUBLISHED, version: undefined }],
    ['a publish numbered zero', { ...PUBLISHED, version: 0 }],
    ['a publish numbered in halves', { ...PUBLISHED, version: 2.5 }],
    ['a day that is no day', { ...PUBLISHED, effectiveFrom: '2026-02-30' }],
    [
      'an instant for a day',
      { ...PUBLISHED, effectiveFrom: '2026-10-05T00:00:00.000Z' },
    ],
    ['a verdict nobody knows', { ...PUBLISHED, direction: 'kinder' }],
    ['a refusal in a word nobody knows', { kind: 'refused', code: 'busy' }],
    ['a withdrawal, to a publish', { kind: 'withdrawn', version: 2 }],
  ])(
    'never reports a publish on %s: it is no answer at all',
    async (_what, data) => {
      callableMock.mockResolvedValueOnce({ data });
      const { gateway, invalidate } = setUp();

      const failure = unwrapErr(await gateway.publishStreakRule(call()));

      expect(failure).toMatchObject({
        errorCode: RepositoryErrorCode.Malformed,
        path: 'streakDefinitions/cadence',
      });
      expect(invalidate).not.toHaveBeenCalled();
    },
  );
});

describe('streakPublishGatewayPorts — withdraw, through the same callable', () => {
  beforeEach(() => {
    callableMock.mockReset();
    httpsCallableMock.mockClear();
  });

  it('names the version it calls off', async () => {
    callableMock.mockResolvedValueOnce({
      data: { kind: 'withdrawn', version: 2 },
    });
    const { gateway } = setUp();

    const result = await gateway.withdrawStreakRule(withdrawal());

    expect(httpsCallableMock).toHaveBeenCalledWith(
      FUNCTIONS,
      'publishStreakDefinition',
    );
    expect(sent()).toEqual({
      op: 'withdraw',
      requestId: 'req-undo',
      streakId: 'cadence',
      version: 2,
    });
    expect(unwrapOk(result)).toBeUndefined();
  });

  it('drops the session’s copy of the catalogue once the version is called off', async () => {
    callableMock.mockResolvedValueOnce({
      data: { kind: 'withdrawn', version: 2 },
    });
    const { gateway, invalidate } = setUp();

    await gateway.withdrawStreakRule(withdrawal());

    expect(invalidate).toHaveBeenCalledTimes(1);
  });

  it('hands over «stale» when the version no longer waits', async () => {
    callableMock.mockResolvedValueOnce({
      data: { kind: 'refused', code: 'stale', fields: [] },
    });
    const { gateway, invalidate } = setUp();

    const refusal = unwrapErr(await gateway.withdrawStreakRule(withdrawal()));

    expect(refusal).toEqual(StreakPublishError.stale(2, 2));
    expect(invalidate).not.toHaveBeenCalled();
  });

  it.each([
    ['another version', { kind: 'withdrawn', version: 3 }],
    ['a publish', PUBLISHED],
    ['nothing', undefined],
    // A withdrawal asks for no day: a «tooEarly» naming none is no refusal it can carry.
    ['a «tooEarly» naming no day', { kind: 'refused', code: 'tooEarly' }],
  ])('never reports a withdrawal on an answer for %s', async (_what, data) => {
    callableMock.mockResolvedValueOnce({ data });
    const { gateway, invalidate } = setUp();

    const failure = unwrapErr(await gateway.withdrawStreakRule(withdrawal()));

    expect(failure).toMatchObject({
      errorCode: RepositoryErrorCode.Malformed,
      path: 'streakDefinitions/cadence',
    });
    expect(invalidate).not.toHaveBeenCalled();
  });

  it('tells a request that got no answer apart from a refusal', async () => {
    callableMock.mockRejectedValueOnce(
      Object.assign(new Error('offline'), { code: 'functions/unavailable' }),
    );
    const { gateway } = setUp();

    const failure = unwrapErr(await gateway.withdrawStreakRule(withdrawal()));

    expect(failure).toEqual({
      errorCode: RepositoryErrorCode.WriteFailed,
      path: 'streakDefinitions/cadence',
      reason: 'functions/unavailable',
    });
  });
});
