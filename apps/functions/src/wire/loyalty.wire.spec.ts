import { HttpsError } from 'firebase-functions/v2/https';
import {
  Actor,
  AuditAction,
  FlagName,
  HeadRole,
  StreakExcuse,
  StreakInterval,
  StreakOnBreak,
  StreakQualifier,
  StreakRule,
  StreakRuleDirection,
  StreakTransition,
} from '@core/components';
import {
  RepositoryError,
  Result,
  ServiceId,
  StreakPublishError,
  StreakPublishErrorCode,
  StreakRuleField,
  UserId,
  type UtcEpochMs,
} from '@core/primitives';
import type { PublishStreakDefinitionPorts } from '@core/pipelines';
import {
  fixtureHash,
  localDate,
  memoryStreakWorld,
  memoryTxPorts,
  pinnedNowUtcMs,
  recordingTelemetry,
  streakDefinitionFixture,
  streakDefinitionVersionFixture,
  type StreakWorld,
  utcMs,
} from '@core/testing';
import {
  type EdgeError,
  isAnswered,
  LegacyWireCode,
  toHttpsError,
  WIRE_ZONE,
  WireShape,
  wireRuleOf,
} from '../edge';
import {
  answerStreakPublish,
  decodeDraft,
  decodeStreakCaller,
  decodeStreakPublish,
  decodeStreakRequest,
  encodeStreakPublishAnswer,
  encodeStreakWithdrawAnswer,
  publishStreakRefusal,
  type StreakCaller,
  type StreakPublishAnswer,
  StreakPublishOp,
} from './loyalty.wire';

/*
 * THE STREAK PUBLISH'S FROZEN WIRE (loyalty flip (3), F3-3), written from
 * the deleted callable handler's spec ("the wire, and the whole behind it")
 * and the deleted use case's
 * caller, refusal and draft cases: every status, `details` and answered
 * field byte for byte, the order (the caller before the envelope), the
 * draft's legacy locators, and the whole callable over the REAL pipelines
 * on the in-memory commit. What a rejected commit answers is `main.spec.ts`'s
 * (the composition root settles it); the exact `WriteOp[]` is the
 * pipeline spec's.
 */

const CADENCE = StreakRule.DEFAULT_DEFINITION_ID;
/** The fixtures' one day pin, the day the seeded rule is read on. */
const TODAY = localDate('2026-09-28');
const TOMORROW = localDate('2026-09-29');
const NEXT_WEEK = localDate('2026-10-05');
const NEXT_MONTH = localDate('2026-10-28');
/** Noon in Sofia on the fixtures' day. */
const NOW: UtcEpochMs = utcMs('2026-09-28T12:00:00.000+03:00');

type Auth = { readonly uid: string; readonly token: object };
const owner: Auth = {
  uid: 'dev-staff-ivan',
  token: { roles: ['barber', 'admin'] },
};
const vendor: Auth = { uid: 'vendor-1', token: { roles: ['sysadmin'] } };
const barber: Auth = { uid: 'dev-staff-petar', token: { roles: ['barber'] } };
/** Nobody signed in: a request with no `auth` at all. */
const NOBODY = null;

const request = (data: unknown, auth: Auth | null = owner) =>
  auth === null ? { data } : { data, auth };

/**
 * The recommended rule as today's admin page sends it — the NESTED legacy
 * body the legacy mapper wrote for the recommended rule (recorded before
 * the mapper was deleted).
 */
const DEFAULT_DRAFT = {
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
} as const;

/** The recommended draft with `patch` over it (a part replaced whole). */
const draftWith = (
  patch: Readonly<Record<string, unknown>> = {},
): Record<string, unknown> => ({ ...DEFAULT_DRAFT, ...patch });

let intents = 0;
const nextIntent = (): string =>
  `intent-${String((intents += 1)).padStart(12, '0')}`;

/** §4.4's request, as the browser's adapter makes it of the port's. */
function publishRequest(
  patch: Readonly<Record<string, unknown>>,
  effectiveFrom: string,
  over: Readonly<Record<string, unknown>> = {},
): Record<string, unknown> {
  return {
    requestId: nextIntent(),
    streakId: CADENCE,
    baseVersion: 1,
    draft: draftWith({ ...patch, version: 2, effectiveFrom }),
    effectiveFrom,
    transition: 'grandfather',
    previewHash: null,
    ...over,
  };
}

/** The shop as the seed leaves it: the recommended rule in force, its one version. */
function seeded(): StreakWorld {
  return memoryStreakWorld({
    heads: [streakDefinitionFixture()],
    versions: [
      { streakId: CADENCE, version: streakDefinitionVersionFixture() },
    ],
  });
}

/** The whole callable over the real pipelines and the in-memory commit. */
function rig(
  world: StreakWorld = seeded(),
  options: { readonly clientsSeeRhythm?: boolean } = {},
) {
  const telemetry = recordingTelemetry();
  const tx = memoryTxPorts(world.store, {
    nowUtcMs: pinnedNowUtcMs(NOW),
    hash: fixtureHash,
  });
  let built = 0;
  const ports = (): PublishStreakDefinitionPorts => {
    built += 1;
    return {
      ...tx,
      flagOn: (key) =>
        key === FlagName.LoyaltySelfView && options.clientsSeeRhythm === true,
      tenantTimeZone: WIRE_ZONE,
    };
  };
  /** What the callable answers — or the HttpsError it throws. */
  const call = async (
    data: unknown,
    auth: Auth | null = owner,
  ): Promise<StreakPublishAnswer> => {
    const answered = await answerStreakPublish(
      request(data, auth),
      ports,
      telemetry,
    );
    if (answered.ok) return answered.value;
    throw toHttpsError(answered.error);
  };
  return {
    call,
    store: world.store,
    lines: telemetry.lines,
    built: () => built,
  };
}

/** The error a call was refused with, or `null` when it answered. */
async function thrownBy(run: Promise<unknown>): Promise<HttpsError | null> {
  return run.then(
    () => null,
    (error: unknown) => {
      if (error instanceof HttpsError) return error;
      throw error;
    },
  );
}

const auditRows = (store: ReadonlyMap<string, Record<string, unknown>>) =>
  [...store]
    .filter(([path]) => path.startsWith('auditLog/'))
    .map(([, row]) => row);

const HEAD = `streakDefinitions/${CADENCE}`;

describe('publishStreakDefinition — who may ask', () => {
  it('throws unauthenticated at nobody, and writes nothing', async () => {
    const { call, store } = rig();
    const before = new Map(store);
    const refusal = await thrownBy(
      call(publishRequest({ graceDays: 10 }, TOMORROW), NOBODY),
    );
    expect(refusal?.code).toBe('unauthenticated');
    expect(refusal?.details).toEqual({
      code: 'loyalty.streak_publish.unauthenticated',
      params: {},
    });
    expect(store).toEqual(before);
  });

  it.each([
    ['a barber', ['barber']],
    ['the front desk', ['receptionist']],
    ['a content manager', ['content_manager']],
    ['a client', ['client']],
    ['a caller with no role', []],
  ])('ANSWERS %s notAdmin, and writes nothing', async (_who, roles) => {
    const { call, store, built } = rig();
    const before = new Map(store);
    const answer = await call(publishRequest({ graceDays: 10 }, TOMORROW), {
      uid: 'somebody',
      token: { roles },
    });
    expect(answer).toStrictEqual({
      kind: 'refused',
      code: 'notAdmin',
      fields: [],
    });
    expect(store).toEqual(before);
    expect(built()).toBe(0);
  });

  it('judges the caller before it reads the request: a stranger never learns what was wrong with the asking', async () => {
    const { call } = rig();
    expect(await call({ nonsense: true }, barber)).toStrictEqual({
      kind: 'refused',
      code: 'notAdmin',
      fields: [],
    });
    expect(await call(null, barber)).toMatchObject({ code: 'notAdmin' });
    expect((await thrownBy(call(null, NOBODY)))?.code).toBe('unauthenticated');
    // The admin pair is told what was wrong.
    expect((await thrownBy(call(null, owner)))?.details).toEqual({
      code: 'loyalty.streak_publish.invalid_input',
      params: { field: 'request' },
    });
  });

  it('reads the role off the token, never off the payload', async () => {
    const { call } = rig();
    const answer = await call(
      {
        ...publishRequest({ graceDays: 10 }, TOMORROW),
        roles: ['admin'],
        caller: { uid: 'dev-staff-ivan', isAdmin: true },
      },
      barber,
    );
    expect(answer).toMatchObject({ kind: 'refused', code: 'notAdmin' });
  });

  it.each([
    [
      'the owner',
      owner,
      { actorRole: 'ADMIN', actorAdminUserId: 'dev-staff-ivan' },
    ],
    [
      'the vendor',
      vendor,
      { actorRole: 'STAFF', actorUserId: 'vendor-1', actorRoles: ['sysadmin'] },
    ],
  ])('admits %s, and the row names them', async (_who, auth, actor) => {
    const { call, store } = rig();
    const answer = await call(
      publishRequest({ graceDays: 10 }, TOMORROW),
      auth,
    );
    expect(answer).toMatchObject({ kind: 'published', version: 2 });
    // The flat row's actor slice (F1-8): the owner's override told from the vendor's act.
    expect(auditRows(store)).toEqual([expect.objectContaining(actor)]);
    expect(store.get(`${HEAD}/versions/000002`)?.['publishedByUserId']).toBe(
      auth.uid,
    );
  });
});

describe('decodeStreakCaller — the caller, off the verified token', () => {
  it.each([
    [
      'an owner who cuts hair',
      ['barber', 'admin'],
      true,
      { actorRole: 'ADMIN', actorAdminUserId: 'u-1' },
    ],
    [
      'the owner',
      ['admin'],
      true,
      { actorRole: 'ADMIN', actorAdminUserId: 'u-1' },
    ],
    [
      'the vendor alone',
      ['sysadmin'],
      true,
      { actorRole: 'STAFF', actorUserId: 'u-1', actorRoles: ['sysadmin'] },
    ],
    [
      'a barber alone',
      ['barber'],
      false,
      { actorRole: 'STAFF', actorUserId: 'u-1', actorRoles: ['barber'] },
    ],
    ['a client', ['client'], false, { actorRole: 'USER', actorUserId: 'u-1' }],
    ['no claim at all', [], false, { actorRole: 'USER', actorUserId: 'u-1' }],
  ])('reads %s', (_who, roles, isAdmin, actor) => {
    expect(
      decodeStreakCaller(request({}, { uid: 'u-1', token: { roles } })),
    ).toEqual({
      callerUserId: 'u-1',
      callerIsAdmin: isAdmin,
      callerActor: actor,
    });
  });

  it('reads nobody without a uid, or with a blank one, whatever the claim says', () => {
    const nobody: StreakCaller = {
      callerUserId: null,
      callerIsAdmin: false,
      callerActor: null,
    };
    expect(decodeStreakCaller({ data: {} })).toEqual(nobody);
    expect(
      decodeStreakCaller(request({}, { uid: '', token: { roles: ['admin'] } })),
    ).toEqual(nobody);
    expect(
      decodeStreakCaller(
        request({}, { uid: '  ', token: { roles: ['admin'] } }),
      ),
    ).toEqual(nobody);
  });

  it('admits only a role spelt as the rules spell it — a list inside the claim manages nothing, and is still attributed as today', () => {
    expect(
      decodeStreakCaller(
        request({}, { uid: 'u-1', token: { roles: [['admin']] } }),
      ),
    ).toEqual({
      callerUserId: 'u-1',
      callerIsAdmin: false,
      callerActor: Actor.admin(UserId.of('u-1')),
    });
  });
});

describe('decodeStreakPublish — the caller, then the envelope', () => {
  it('refuses nobody and a non-admin before the envelope, and reads an admin’s request', () => {
    expect(decodeStreakPublish(request('nonsense', NOBODY))).toEqual(
      Result.err(StreakPublishError.callerUnauthenticated()),
    );
    expect(decodeStreakPublish(request('nonsense', barber))).toEqual(
      Result.err(StreakPublishError.callerNotAdmin()),
    );
    expect(decodeStreakPublish(request('nonsense', owner))).toEqual(
      Result.err({
        code: LegacyWireCode.StreakPublishInvalidInput,
        field: 'request',
      }),
    );
    expect(
      decodeStreakPublish(
        request({
          op: 'withdraw',
          requestId: 'intent-000000000001',
          streakId: CADENCE,
          version: 2,
        }),
      ),
    ).toEqual(
      Result.ok({
        streakPublishOp: StreakPublishOp.Withdraw,
        withdraw: {
          callerUserId: 'dev-staff-ivan',
          callerIsAdmin: true,
          callerActor: {
            actorRole: 'ADMIN',
            actorAdminUserId: 'dev-staff-ivan',
          },
          requestId: 'intent-000000000001',
          streakId: CADENCE,
          version: 2,
        },
      }),
    );
  });
});

describe('decodeStreakRequest — the envelope', () => {
  const caller = decodeStreakCaller(request({}, owner));
  const sound = (): Record<string, unknown> =>
    publishRequest({ graceDays: 10 }, TOMORROW);
  const fieldOf = (raw: unknown): string | null => {
    const read = decodeStreakRequest(raw, caller);
    return read.ok ? null : read.error.field;
  };

  it('reads §4.4’s request into the publish’s command, the draft into the rule’s flat input', () => {
    const raw = sound();
    expect(decodeStreakRequest(raw, caller)).toEqual(
      Result.ok({
        streakPublishOp: StreakPublishOp.Publish,
        publish: {
          ...caller,
          requestId: raw['requestId'],
          streakId: CADENCE,
          baseVersion: 1,
          draft: Result.ok({
            ...StreakRule.DEFAULT,
            version: 0,
            effectiveFromLocalDate: TOMORROW,
            graceDays: 10,
          }),
          effectiveFrom: TOMORROW,
          streakTransition: StreakTransition.Grandfather,
          previewHash: null,
        },
      }),
    );
  });

  it('reads a withdrawal, and nothing of a publish off it', () => {
    expect(
      decodeStreakRequest(
        {
          op: 'withdraw',
          requestId: 'intent-000000000001',
          streakId: CADENCE,
          version: 2,
          draft: 'ignored',
        },
        caller,
      ),
    ).toEqual(
      Result.ok({
        streakPublishOp: StreakPublishOp.Withdraw,
        withdraw: {
          ...caller,
          requestId: 'intent-000000000001',
          streakId: CADENCE,
          version: 2,
        },
      }),
    );
  });

  it('takes a request that names no op — or a null one — for a publish, as §4.4 draws it', () => {
    for (const op of [undefined, null, 'publish']) {
      const read = decodeStreakRequest({ ...sound(), op }, caller);
      expect(read.ok && read.value.streakPublishOp).toBe(
        StreakPublishOp.Publish,
      );
    }
  });

  it.each([
    ['nothing', undefined],
    ['null', null],
    ['a text', 'publish'],
    ['a list', [{}]],
  ])('refuses %s as no request', (_what, raw) => {
    expect(fieldOf(raw)).toBe('request');
  });

  it.each([
    ['an op nobody knows', { op: 'delete' }, 'op'],
    ['an op that is no text', { op: 1 }, 'op'],
    ['no intent', { requestId: undefined }, 'requestId'],
    ['an intent too short to be one', { requestId: 'abc' }, 'requestId'],
    [
      'an intent that could not be an id',
      { requestId: 'a/b'.repeat(8) },
      'requestId',
    ],
    ['no rule named', { streakId: undefined }, 'streakId'],
    ['a rule named by a path', { streakId: 'cadence/versions' }, 'streakId'],
    ['a blank rule', { streakId: '' }, 'streakId'],
    ['a base that is text', { baseVersion: '1' }, 'baseVersion'],
    ['a base below nothing', { baseVersion: -1 }, 'baseVersion'],
    ['a base that is a fraction', { baseVersion: 1.5 }, 'baseVersion'],
    ['no base', { baseVersion: undefined }, 'baseVersion'],
    ['no draft', { draft: undefined }, 'draft'],
    ['a draft that is a list', { draft: [] }, 'draft'],
    ['a draft that is text', { draft: '{}' }, 'draft'],
    [
      'a draft nobody could call a rule for its size',
      {
        draft: {
          qualifier: {
            kind: 'services',
            serviceIds: Array.from({ length: 2000 }, (_, i) => `svc-${i}`),
          },
        },
      },
      'draft',
    ],
    ['a transition nobody knows', { transition: 'forget' }, 'transition'],
    [
      'a transition in the system’s words',
      { transition: 'GRANDFATHER' },
      'transition',
    ],
    ['no transition', { transition: undefined }, 'transition'],
    ['a preview that is no text', { previewHash: 7 }, 'previewHash'],
    ['a blank preview', { previewHash: '' }, 'previewHash'],
    [
      'a preview too long to be a hash',
      { previewHash: 'a'.repeat(129) },
      'previewHash',
    ],
  ])('refuses %s, by name', (_what, over, field) => {
    expect(fieldOf({ ...sound(), ...over })).toBe(field);
  });

  it.each([
    ['text', '2'],
    ['nothing', undefined],
    ['none', 0],
    ['a fraction', 2.5],
  ])('refuses a withdrawal whose version is %s', (_what, version) => {
    expect(
      fieldOf({
        op: 'withdraw',
        requestId: 'intent-000000000001',
        streakId: CADENCE,
        version,
      }),
    ).toBe('version');
  });

  it('reads an absent preview as none, and a recompute as the system’s word', () => {
    const raw = Object.fromEntries(
      Object.entries(sound()).filter(([key]) => key !== 'previewHash'),
    );
    const read = decodeStreakRequest(
      { ...raw, transition: 'recompute' },
      caller,
    );
    expect(read).toMatchObject({
      ok: true,
      value: {
        publish: {
          previewHash: null,
          streakTransition: StreakTransition.Recompute,
        },
      },
    });
  });

  it('leaves the RULE to the pipeline: a draft of the wrong kinds is its `invalid`, a day that is no text reads as none', () => {
    const read = decodeStreakRequest(
      {
        ...sound(),
        draft: { graceDays: '7', anything: ['at', 'all'] },
        effectiveFrom: 20261001,
      },
      caller,
    );
    expect(read).toMatchObject({
      ok: true,
      value: {
        publish: {
          draft: Result.err(StreakPublishError.invalid(['effectiveFrom'])),
          effectiveFrom: '',
        },
      },
    });
  });
});

describe('decodeDraft — the nested legacy draft, field by field', () => {
  const fieldsOf = (
    patch: Readonly<Record<string, unknown>>,
    effectiveFrom: string = TOMORROW,
  ) => {
    const read = decodeDraft(draftWith(patch), effectiveFrom);
    return read.ok ? null : read.error.fields;
  };

  it('reads the recommended draft as the recommended rule’s flat input, its own number and day never read', () => {
    expect(
      decodeDraft(
        draftWith({ version: 41, effectiveFrom: '2020-01-01' }),
        NEXT_WEEK,
      ),
    ).toEqual(
      Result.ok({
        ...StreakRule.DEFAULT,
        version: 0,
        effectiveFromLocalDate: NEXT_WEEK,
      }),
    );
  });

  it('reads every part in the system’s words', () => {
    expect(
      decodeDraft(
        draftWith({
          qualifier: {
            kind: 'services',
            serviceIds: ['svc-fade', 'svc-beard'],
          },
          interval: {
            kind: 'personal',
            tolerancePct: 25,
            minDays: 28,
            maxDays: 56,
            fallbackDays: 42,
          },
          excuses: ['closedDays', 'shopClosure'],
          onBreak: 'hold',
        }),
        NEXT_WEEK,
      ),
    ).toMatchObject({
      ok: true,
      value: {
        streakQualifier: StreakQualifier.Services,
        qualifierServiceIds: [
          ServiceId.of('svc-fade'),
          ServiceId.of('svc-beard'),
        ],
        streakInterval: StreakInterval.Personal,
        intervalTolerancePct: 25,
        intervalMinDays: 28,
        intervalMaxDays: 56,
        intervalFallbackDays: 42,
        excuses: [StreakExcuse.ClosedDays, StreakExcuse.ShopClosure],
        onBreak: StreakOnBreak.Hold,
      },
    });
    expect(
      decodeDraft(
        draftWith({
          qualifier: { kind: 'categories', categoryIds: ['cat-cuts'] },
        }),
        NEXT_WEEK,
      ),
    ).toMatchObject({
      ok: true,
      value: {
        streakQualifier: StreakQualifier.Categories,
        qualifierCategoryIds: ['cat-cuts'],
      },
    });
  });

  it('reads nothing a draft has no business saying: an id and a name of its own are not the rule’s', () => {
    expect(
      decodeDraft(
        draftWith({ id: 'other', name: { bg: 'Друго', en: 'Other' } }),
        TOMORROW,
      ),
    ).toEqual(decodeDraft(draftWith(), TOMORROW));
  });

  it.each([
    ['a figure sent as text', { graceDays: '7' }, 'graceDays'],
    ['a fraction of a day', { minGapDays: 1.5 }, 'minGapDays'],
    ['a figure below nothing', { riskLeadDays: -1 }, 'riskLeadDays'],
    ['a switch that is no boolean', { enabled: 'yes' }, 'enabled'],
    [
      'an interval with no days',
      { interval: { kind: 'fixed' } },
      'interval.days',
    ],
    ['an interval of no kind', { interval: { days: 42 } }, 'interval.kind'],
    [
      'a personal interval with a floor of text',
      {
        interval: {
          kind: 'personal',
          tolerancePct: 25,
          minDays: '28',
          maxDays: 56,
          fallbackDays: 42,
        },
      },
      'interval.minDays',
    ],
    ['a part that is no object', { bookingHold: 14 }, 'bookingHold'],
    [
      'a part with no switch',
      { clientPause: { maxDaysPerYear: 90 } },
      'clientPause.enabled',
    ],
    [
      'a reserve with no cap',
      { protections: { enabled: true, earnEvery: 5, startWith: 0 } },
      'protections.maxBanked',
    ],
    ['an excuse nobody knows', { excuses: ['shopClosure', 'rain'] }, 'excuses'],
    [
      'an excuse in the system’s words',
      { excuses: ['SHOP_CLOSURE'] },
      'excuses',
    ],
    ['excuses that are no list', { excuses: 'shopClosure' }, 'excuses'],
    [
      'a list of services with a blank in it',
      { qualifier: { kind: 'services', serviceIds: ['svc-fade', ' '] } },
      'qualifier.serviceIds',
    ],
    ['a qualifier of no kind', { qualifier: {} }, 'qualifier.kind'],
    ['a miss that does something unknown', { onBreak: 'forgive' }, 'onBreak'],
    ['a part left out', { repair: undefined }, 'repair'],
  ])('names the field of %s', (_what, patch, field) => {
    expect(fieldsOf(patch)).toEqual([field]);
  });

  it('names the FIRST field the legacy reader stopped at, never a later one', () => {
    expect(
      fieldsOf({ enabled: 'yes', graceDays: '7', onBreak: 'forgive' }),
    ).toEqual(['enabled']);
    expect(fieldsOf({ interval: 7, repair: undefined })).toEqual(['interval']);
  });

  it('refuses a draft that holds nothing at its first field', () => {
    const read = decodeDraft({}, TOMORROW);
    expect(read.ok ? null : read.error.fields).toEqual(['enabled']);
  });

  it.each([['next week'], ['2026-02-30'], ['2026-9-29'], ['']])(
    'refuses a day that is none, before any part of the draft: %j',
    (day) => {
      expect(fieldsOf({}, day)).toEqual(['effectiveFrom']);
      expect(fieldsOf({ enabled: 'yes' }, day)).toEqual(['effectiveFrom']);
    },
  );

  it('leaves a figure of the right kind to the rule: a grace of 60 days reads', () => {
    expect(decodeDraft(draftWith({ graceDays: 60 }), TOMORROW).ok).toBe(true);
    expect(
      decodeDraft(
        draftWith({ qualifier: { kind: 'services', serviceIds: [] } }),
        TOMORROW,
      ).ok,
    ).toBe(true);
  });
});

describe('publishStreakRefusal — the per-code table, literally', () => {
  const log = () => recordingTelemetry();
  const answered = (failure: Parameters<typeof publishStreakRefusal>[0]) =>
    publishStreakRefusal(failure, log());
  const thrown = (result: Result<unknown, EdgeError>) => {
    if (result.ok) throw new Error('expected a fault');
    const error = toHttpsError(result.error);
    return { status: error.code, details: error.details };
  };

  it('answers INVALID with each flat field as its legacy locator, an unknown one as written, each once', () => {
    expect(
      answered(
        StreakPublishError.invalid([
          StreakRuleField.IntervalDays,
          StreakRuleField.ScheduledEffectiveFromLocalDate,
          'interval.days',
          'bookingHold.enabled',
          StreakRuleField.GraceDays,
        ]),
      ),
    ).toStrictEqual(
      Result.ok({
        kind: 'refused',
        code: 'invalid',
        fields: [
          'interval.days',
          'scheduled.effectiveFrom',
          'bookingHold.enabled',
          'graceDays',
        ],
      }),
    );
  });

  it('answers TOO_EARLY with today’s fields and the first day it may start', () => {
    expect(
      answered(StreakPublishError.tooEarly(TODAY, TOMORROW)),
    ).toStrictEqual(
      Result.ok({
        kind: 'refused',
        code: 'tooEarly',
        fields: ['effectiveFrom'],
        earliest: TOMORROW,
      }),
    );
  });

  it.each([
    [StreakPublishError.stale(1, 2), 'stale'],
    [StreakPublishError.recomputeNeedsEngine(), 'recomputeNeedsEngine'],
    [StreakPublishError.previewStale(), 'previewStale'],
    [StreakPublishError.callerNotAdmin(), 'notAdmin'],
  ] as const)('answers %j as %s, with no field and no day', (error, code) => {
    expect(answered(error)).toStrictEqual(
      Result.ok({ kind: 'refused', code, fields: [] }),
    );
  });

  it('throws CALLER_UNAUTHENTICATED as today’s unauthenticated fault', () => {
    expect(
      thrown(answered(StreakPublishError.callerUnauthenticated())),
    ).toEqual({
      status: 'unauthenticated',
      details: { code: 'loyalty.streak_publish.unauthenticated', params: {} },
    });
  });

  it('throws an envelope refusal as today’s invalid_input, by field', () => {
    expect(
      thrown(
        answered({
          code: LegacyWireCode.StreakPublishInvalidInput,
          field: 'baseVersion',
        }),
      ),
    ).toEqual({
      status: 'invalid-argument',
      details: {
        code: 'loyalty.streak_publish.invalid_input',
        params: { field: 'baseVersion' },
      },
    });
  });

  it('logs a failed write’s cause where alerting can find it, and throws store_failed without it', () => {
    const telemetry = log();
    const result = publishStreakRefusal(
      RepositoryError.writeFailed(null, 'Error: deadline exceeded'),
      telemetry,
    );
    const fault = thrown(result);
    expect(fault).toEqual({
      status: 'internal',
      details: { code: 'loyalty.streak_publish.store_failed', params: {} },
    });
    expect(JSON.stringify(fault.details)).not.toContain('deadline');
    expect(telemetry.lines).toEqual([
      {
        level: 'error',
        msg: 'rhythm rule write failed',
        fields: { error: 'Error: deadline exceeded' },
      },
    ]);
  });

  it('logs a version number a concurrent writer took by its code and path (F3-1 (c))', () => {
    const telemetry = log();
    thrown(
      publishStreakRefusal(
        RepositoryError.alreadyExists(
          'streakDefinitions/cadence/versions/000002',
        ),
        telemetry,
      ),
    );
    expect(telemetry.lines).toEqual([
      {
        level: 'error',
        msg: 'rhythm rule write failed',
        fields: {
          error:
            'REPOSITORY_ALREADY_EXISTS streakDefinitions/cadence/versions/000002',
        },
      },
    ]);
  });
});

describe('the deleted handler’s statuses (the edge scanner’s table on 6d43e1c)', () => {
  // 2 throw sites (`toHttpsError`'s switch) and 9 error classes
  // (`use-cases/publish-streak-definition.errors.ts`): three thrown faults,
  // six answered refusals. Their wire codes and statuses stand, now spelt by
  // the codes the wire answers with.
  it.each([
    [
      LegacyWireCode.StreakPublishUnauthenticated,
      'loyalty.streak_publish.unauthenticated',
      'unauthenticated',
    ],
    [
      LegacyWireCode.StreakPublishInvalidInput,
      'loyalty.streak_publish.invalid_input',
      'invalid-argument',
    ],
    [
      LegacyWireCode.StreakPublishStoreFailed,
      'loyalty.streak_publish.store_failed',
      'internal',
    ],
  ])('throws %s as %s, %s', (code, wireCode, status) => {
    const rule = wireRuleOf(code);
    expect(rule.wireCode).toBe(wireCode);
    expect(rule.wireShape).toBe(WireShape.CodeAndParams);
    expect(
      rule.wireShape === WireShape.Answered ? null : rule.httpsStatus,
    ).toBe(status);
  });

  it.each([
    [LegacyWireCode.StreakPublishNotAdmin, 'loyalty.streak_publish.not_admin'],
    [
      StreakPublishErrorCode.CallerNotAdmin,
      'loyalty.streak_publish.caller_not_admin',
    ],
    [StreakPublishErrorCode.Invalid, 'loyalty.streak_publish.invalid'],
    [StreakPublishErrorCode.Stale, 'loyalty.streak_publish.stale'],
    [StreakPublishErrorCode.TooEarly, 'loyalty.streak_publish.too_early'],
    [
      StreakPublishErrorCode.RecomputeNeedsEngine,
      'loyalty.streak_publish.recompute_needs_engine',
    ],
    [
      StreakPublishErrorCode.PreviewStale,
      'loyalty.streak_publish.preview_stale',
    ],
  ])('answers %s (%s) — never thrown', (code, wireCode) => {
    expect(wireRuleOf(code).wireCode).toBe(wireCode);
    expect(isAnswered(code)).toBe(true);
  });

  it('throws a caller without a session on its NEW dotted code only inside the edge — the wire answers today’s', () => {
    expect(
      wireRuleOf(StreakPublishErrorCode.CallerUnauthenticated).wireCode,
    ).toBe('loyalty.streak_publish.caller_unauthenticated');
    const fault = publishStreakRefusal(
      StreakPublishError.callerUnauthenticated(),
      recordingTelemetry(),
    );
    expect(fault).toEqual(
      Result.err({ code: LegacyWireCode.StreakPublishUnauthenticated }),
    );
  });
});

describe('the encoders — today’s answer, key for key', () => {
  it.each([
    [StreakRuleDirection.Looser, 'looser'],
    [StreakRuleDirection.Stricter, 'stricter'],
    [StreakRuleDirection.Mixed, 'mixed'],
    [StreakRuleDirection.Neutral, 'neutral'],
    [StreakRuleDirection.Switch, 'switch'],
  ] as const)('publishes %s as %s', (direction, word) => {
    expect(
      encodeStreakPublishAnswer({
        version: 2,
        effectiveFromLocalDate: NEXT_WEEK,
        streakRuleDirection: direction,
      }),
    ).toStrictEqual({
      kind: 'published',
      version: 2,
      effectiveFrom: NEXT_WEEK,
      direction: word,
    });
  });

  it('withdraws by the version called off', () => {
    expect(encodeStreakWithdrawAnswer({ version: 2 })).toStrictEqual({
      kind: 'withdrawn',
      version: 2,
    });
  });
});

describe('publishStreakDefinition — the answers, end to end', () => {
  it('publishes: the receipt, the documents and the row', async () => {
    const { call, store } = rig();
    expect(
      await call(publishRequest({ graceDays: 10 }, NEXT_WEEK)),
    ).toStrictEqual({
      kind: 'published',
      version: 2,
      effectiveFrom: NEXT_WEEK,
      direction: 'looser',
    });
    expect(store.get(HEAD)).toMatchObject({
      rules: [
        { version: 1, headRole: HeadRole.Current },
        {
          version: 2,
          graceDays: 10,
          headRole: HeadRole.Scheduled,
          streakTransition: StreakTransition.Grandfather,
        },
      ],
      updatedAtUtcMs: NOW,
    });
    expect(auditRows(store)).toEqual([
      expect.objectContaining({
        auditAction: AuditAction.LoyaltyStreakDefinitionPublished,
        resourceId: 'streakDefinitions/cadence',
        auditTarget: 'NONE',
        streakFromVersion: 1,
        streakToVersion: 2,
        streakEffectiveFrom: NEXT_WEEK,
        streakTransition: 'GRANDFATHER',
        streakRuleDirection: 'LOOSER',
        streakChanged: ['GRACE_DAYS'],
        streakReplacedVersion: null,
      }),
    ]);
  });

  it('takes a request that names no op for a publish, and one that says so', async () => {
    const { call } = rig();
    const request = publishRequest({ graceDays: 10 }, TOMORROW);
    expect(request).not.toHaveProperty('op');
    expect(await call(request)).toMatchObject({ kind: 'published' });
    expect(
      await call({
        ...publishRequest({ graceDays: 14 }, NEXT_WEEK),
        op: 'publish',
        baseVersion: 2,
      }),
    ).toMatchObject({ kind: 'published', version: 3 });
  });

  it('withdraws: the version that waits is called off by its number', async () => {
    const { call, store } = rig();
    await call(publishRequest({ graceDays: 10 }, NEXT_WEEK));
    expect(
      await call({
        op: 'withdraw',
        requestId: nextIntent(),
        streakId: CADENCE,
        version: 2,
      }),
    ).toStrictEqual({ kind: 'withdrawn', version: 2 });
    expect(store.get(HEAD)).toMatchObject({
      rules: [{ version: 1, headRole: HeadRole.Current }],
    });
    expect(store.get(`${HEAD}/versions/000002`)).toMatchObject({
      withdrawnAtUtcMs: NOW,
    });
    expect(auditRows(store).map((row) => row['auditAction'])).toEqual(
      expect.arrayContaining([
        AuditAction.LoyaltyStreakDefinitionPublished,
        AuditAction.LoyaltyStreakDefinitionWithdrawn,
      ]),
    );
    expect(auditRows(store)).toHaveLength(2);
  });

  it.each([
    [
      'a grace longer than the rule allows, and a repair window of none',
      { graceDays: 60, repair: { enabled: true, windowDays: 0, perYear: 1 } },
      ['graceDays', 'repair.windowDays'],
    ],
    [
      'every fault the rule names, at once, in today’s order',
      {
        graceDays: 60,
        protections: {
          enabled: true,
          maxBanked: 2,
          earnEvery: 5,
          startWith: 4,
        },
        repair: { enabled: true, windowDays: 0, perYear: 9 },
      },
      [
        'graceDays',
        'protections.startWith',
        'repair.windowDays',
        'repair.perYear',
      ],
    ],
    [
      'a grace no shorter than the interval',
      { interval: { kind: 'fixed', days: 14 }, graceDays: 14 },
      ['graceDays'],
    ],
    [
      'a list of no services',
      { qualifier: { kind: 'services', serviceIds: [] } },
      ['qualifier.serviceIds'],
    ],
    [
      'a personal interval whose floor is above its ceiling',
      {
        interval: {
          kind: 'personal',
          tolerancePct: 25,
          minDays: 56,
          maxDays: 28,
          fallbackDays: 42,
        },
      },
      ['interval.minDays'],
    ],
    ['a figure sent as text', { graceDays: '7' }, ['graceDays']],
    ['a part left out', { repair: undefined }, ['repair']],
  ])(
    'answers a draft that is no rule — %s — with its fields',
    async (_what, patch, fields) => {
      const { call, store } = rig();
      const before = new Map(store);
      const request = publishRequest({}, TOMORROW);
      expect(
        await call({
          ...request,
          draft: { ...(request['draft'] as object), ...patch },
        }),
      ).toStrictEqual({ kind: 'refused', code: 'invalid', fields });
      expect(store).toEqual(before);
    },
  );

  it('answers a rule that is wrong, and throws at an envelope that is: the page words one and not the other', async () => {
    const { call } = rig();
    expect(
      await call({
        ...publishRequest({ graceDays: 60 }, TOMORROW),
        effectiveFrom: 20261001,
      }),
    ).toStrictEqual({
      kind: 'refused',
      code: 'invalid',
      fields: ['effectiveFrom'],
    });
    const envelope = await thrownBy(
      call({
        ...publishRequest({ graceDays: 10 }, TOMORROW),
        baseVersion: '1',
      }),
    );
    expect(envelope?.code).toBe('invalid-argument');
    expect(envelope?.details).toEqual({
      code: 'loyalty.streak_publish.invalid_input',
      params: { field: 'baseVersion' },
    });
  });

  it('answers a day too early with the first day the change may start', async () => {
    expect(
      await rig().call(publishRequest({ graceDays: 10 }, TODAY)),
    ).toStrictEqual({
      kind: 'refused',
      code: 'tooEarly',
      fields: ['effectiveFrom'],
      earliest: TOMORROW,
    });
  });

  it('holds a stricter rule to thirty days of notice once clients see their rhythm', async () => {
    const quiet = rig();
    expect(
      await quiet.call(publishRequest({ graceDays: 3 }, TOMORROW)),
    ).toMatchObject({
      kind: 'published',
      direction: 'stricter',
    });
    const seen = rig(seeded(), { clientsSeeRhythm: true });
    expect(
      await seen.call(publishRequest({ graceDays: 2 }, TOMORROW)),
    ).toStrictEqual({
      kind: 'refused',
      code: 'tooEarly',
      fields: ['effectiveFrom'],
      earliest: NEXT_MONTH,
    });
  });

  it('answers the other refusals in the page’s words, with no field, and writes no row', async () => {
    const { call, store } = rig();
    expect(
      await call(
        publishRequest({ graceDays: 10 }, TOMORROW, { baseVersion: 4 }),
      ),
    ).toStrictEqual({ kind: 'refused', code: 'stale', fields: [] });
    expect(
      await call(
        publishRequest({ graceDays: 10 }, TOMORROW, {
          transition: 'recompute',
        }),
      ),
    ).toStrictEqual({
      kind: 'refused',
      code: 'recomputeNeedsEngine',
      fields: [],
    });
    expect(
      await call(
        publishRequest({ graceDays: 10 }, TOMORROW, { previewHash: 'abc' }),
      ),
    ).toStrictEqual({ kind: 'refused', code: 'previewStale', fields: [] });
    expect(
      await call({
        op: 'withdraw',
        requestId: nextIntent(),
        streakId: CADENCE,
        version: 2,
      }),
    ).toStrictEqual({ kind: 'refused', code: 'stale', fields: [] });
    expect(auditRows(store)).toEqual([]);
  });

  it('answers a scheduled version that would not start after the rule in force with today’s locator', async () => {
    const ahead = memoryStreakWorld({
      heads: [
        streakDefinitionFixture({
          rules: [
            {
              ...StreakRule.DEFAULT,
              effectiveFromLocalDate: NEXT_MONTH,
              headRole: HeadRole.Current,
              streakTransition: null,
            },
          ],
        }),
      ],
    });
    expect(
      await rig(ahead).call(publishRequest({ graceDays: 10 }, NEXT_WEEK)),
    ).toStrictEqual({
      kind: 'refused',
      code: 'invalid',
      fields: ['scheduled.effectiveFrom'],
    });
  });

  it('opens no rule but the business’s one: another id names nothing', async () => {
    expect(
      await rig(memoryStreakWorld()).call(
        publishRequest({}, TOMORROW, { baseVersion: 0, streakId: 'weekly' }),
      ),
    ).toStrictEqual({ kind: 'refused', code: 'invalid', fields: ['id'] });
  });

  it('writes nothing twice for a retry, and answers as it did', async () => {
    const { call, store } = rig();
    const request = publishRequest({ graceDays: 10 }, NEXT_WEEK);
    const first = await call(request);
    const written = new Map(store);
    expect(await call(request)).toEqual(first);
    expect(store).toEqual(written);
    expect(auditRows(store)).toHaveLength(1);
  });
});

describe('publishStreakDefinition — the directions, and the notice nobody is owed yet', () => {
  it.each([
    ['looser', { graceDays: 10 }],
    ['stricter', { graceDays: 3 }],
    ['switch', { enabled: false }],
    ['mixed', { graceDays: 10, minGapDays: 10 }],
  ])(
    'lets a %s rule start tomorrow while no client sees the rhythm',
    async (direction, patch) => {
      expect(await rig().call(publishRequest(patch, TOMORROW))).toMatchObject({
        kind: 'published',
        direction,
      });
    },
  );
});

/**
 * THE REFERENCE STORY of the deleted callable spec ("agrees with the page’s
 * reference"): the page's specs run the same pipeline through the gateway
 * double, so the story, walked through the wire, pins the answers and the
 * documents the page and the callable share.
 */
describe('publishStreakDefinition — the page’s reference story', () => {
  it('answers every step as the reference did, and holds the documents it held', async () => {
    const { call, store } = rig();
    const undo = nextIntent();
    const twice = nextIntent();
    const withdrawal = (version: number, requestId: string = nextIntent()) => ({
      op: 'withdraw',
      requestId,
      streakId: CADENCE,
      version,
    });
    const cue = publishRequest({ riskLeadDays: 3 }, TODAY, {
      baseVersion: 4,
      requestId: twice,
    });
    const story: readonly (readonly [string, unknown])[] = [
      [
        'more grace from next week: it waits',
        publishRequest({ graceDays: 10 }, NEXT_WEEK),
      ],
      [
        'a draft made before that: stale',
        publishRequest({ graceDays: 12 }, NEXT_WEEK),
      ],
      [
        'a longer interval from next month: it replaces what waited',
        publishRequest({ interval: { kind: 'fixed', days: 49 } }, NEXT_MONTH, {
          baseVersion: 2,
        }),
      ],
      ['the undo: what waits is called off', withdrawal(3, undo)],
      ['the undo, asked again: answered as it was', withdrawal(3, undo)],
      ['an undo of what no longer waits: stale', withdrawal(3)],
      [
        'the next draft proposes 2, which is taken: it is numbered 4',
        publishRequest(
          {
            protections: {
              enabled: true,
              maxBanked: 3,
              earnEvery: 4,
              startWith: 1,
            },
          },
          TOMORROW,
        ),
      ],
      [
        'more grace from today: too early',
        publishRequest({ graceDays: 14 }, TODAY, { baseVersion: 4 }),
      ],
      [
        'a recompute: it needs the engine',
        publishRequest({ graceDays: 14 }, NEXT_WEEK, {
          baseVersion: 4,
          transition: 'recompute',
        }),
      ],
      [
        'the cue alone, from today: in force at once, what waited called off',
        cue,
      ],
      ['the same intent again: answered as it was', cue],
      [
        'the rhythm switched off, from tomorrow',
        publishRequest({ riskLeadDays: 3, enabled: false }, TOMORROW, {
          baseVersion: 5,
        }),
      ],
    ];
    const answers: StreakPublishAnswer[] = [];
    for (const [, data] of story) answers.push(await call(data));

    expect(answers).toStrictEqual([
      {
        kind: 'published',
        version: 2,
        effectiveFrom: NEXT_WEEK,
        direction: 'looser',
      },
      { kind: 'refused', code: 'stale', fields: [] },
      {
        kind: 'published',
        version: 3,
        effectiveFrom: NEXT_MONTH,
        direction: 'looser',
      },
      { kind: 'withdrawn', version: 3 },
      { kind: 'withdrawn', version: 3 },
      { kind: 'refused', code: 'stale', fields: [] },
      {
        kind: 'published',
        version: 4,
        effectiveFrom: TOMORROW,
        direction: 'looser',
      },
      {
        kind: 'refused',
        code: 'tooEarly',
        fields: ['effectiveFrom'],
        earliest: TOMORROW,
      },
      { kind: 'refused', code: 'recomputeNeedsEngine', fields: [] },
      {
        kind: 'published',
        version: 5,
        effectiveFrom: TODAY,
        direction: 'neutral',
      },
      {
        kind: 'published',
        version: 5,
        effectiveFrom: TODAY,
        direction: 'neutral',
      },
      {
        kind: 'published',
        version: 6,
        effectiveFrom: TOMORROW,
        direction: 'switch',
      },
    ]);
    // One row per act that was written: five publishes, one withdrawal.
    expect(
      auditRows(store)
        .map((row) => row['auditAction'])
        .sort(),
    ).toEqual([
      ...Array.from(
        { length: 5 },
        () => AuditAction.LoyaltyStreakDefinitionPublished,
      ),
      AuditAction.LoyaltyStreakDefinitionWithdrawn,
    ]);
    // Six versions, written once each; the called-off three stamped.
    const versions = [...store.keys()]
      .filter((key) => key.startsWith(`${HEAD}/versions/`))
      .sort();
    expect(versions).toEqual(
      ['000001', '000002', '000003', '000004', '000005', '000006'].map(
        (id) => `${HEAD}/versions/${id}`,
      ),
    );
    for (const called of ['000002', '000003', '000004']) {
      expect(store.get(`${HEAD}/versions/${called}`)).toMatchObject({
        withdrawnAtUtcMs: NOW,
      });
    }
    expect(store.get(HEAD)).toMatchObject({
      rules: [
        { version: 5, riskLeadDays: 3, headRole: HeadRole.Current },
        { version: 6, headRole: HeadRole.Scheduled },
      ],
    });
  });

  it('opens a shop’s first rule as the reference did: head, version 1 and its row, on nothing', async () => {
    const { call, store } = rig(memoryStreakWorld());
    expect(
      await call(publishRequest({}, NEXT_MONTH, { baseVersion: 0 })),
    ).toStrictEqual({
      kind: 'published',
      version: 1,
      effectiveFrom: NEXT_MONTH,
      direction: 'neutral',
    });
    expect(
      [...store.keys()].filter((key) => key.startsWith(HEAD)).sort(),
    ).toEqual([HEAD, `${HEAD}/versions/000001`]);
    expect(auditRows(store)).toHaveLength(1);
  });
});
