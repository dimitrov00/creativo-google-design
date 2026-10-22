import { HttpsError } from 'firebase-functions/v2/https';
import {
  Actor,
  AuditAction,
  FlagName,
  HeadRole,
  StreakExcuse,
  StreakInterval,
  StreakOnBreak,
  StreakPublishOutcome,
  StreakQualifier,
  StreakRule,
  StreakRuleDirection,
  StreakTransition,
} from '@core/components';
import {
  type LocalDate,
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
  locationFixture,
  memoryDefaultLocationPorts,
  memoryLocationLoadPorts,
  memoryProgramsWorld,
  memoryStreakWorld,
  memoryTxPorts,
  pinnedNowUtcMs,
  recordingTelemetry,
  streakDefinitionFixture,
  streakDefinitionVersionFixture,
  type StreakWorld,
  utcMs,
} from '@core/testing';
import { type EdgeError, isAnswered, toHttpsError, wireRuleOf } from '../edge';
import {
  answerStreakPublish,
  decodeRule,
  decodeStreakCaller,
  decodeStreakPublish,
  decodeStreakRequest,
  publishStreakRefusal,
  type StreakCaller,
  type StreakPublishAnswer,
  StreakPublishOp,
} from './loyalty.wire';

/*
 * THE STREAK PUBLISH'S FLIPPED WIRE (Phase 4a 4A-4): the request is the call
 * component `StreakPublishCall` (the rule FLAT, its own
 * `effectiveFromLocalDate` the day asked; a withdrawal is the call that
 * carries no `rule`), the answer `StreakPublishCall.Answer`
 * (`streakPublishOutcome: 'PUBLISHED' | 'WITHDRAWN' | 'REFUSED'`), the
 * thrown faults the ecs-core structs projected by the shared table. The
 * order (the caller before the envelope) and the whole callable over the
 * REAL pipelines on the in-memory commit are pinned as before; what a
 * rejected commit answers is `main.spec.ts`'s; the exact `WriteOp[]` is the
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

/** The recommended rule with `patch` over it — the FLAT body the admin page sends. */
const ruleWith = (
  patch: Readonly<Record<string, unknown>> = {},
): Record<string, unknown> => ({ ...StreakRule.DEFAULT, ...patch });

let intents = 0;
const nextIntent = (): string =>
  `intent-${String((intents += 1)).padStart(12, '0')}`;

/** A publish, as the browser's gateway makes it of the call component. */
function publishRequest(
  patch: Readonly<Record<string, unknown>>,
  effectiveFrom: unknown,
  over: Readonly<Record<string, unknown>> = {},
): Record<string, unknown> {
  return {
    requestId: nextIntent(),
    streakId: CADENCE,
    baseVersion: 1,
    rule: ruleWith({
      ...patch,
      version: 2,
      effectiveFromLocalDate: effectiveFrom,
    }),
    streakTransition: StreakTransition.Grandfather,
    previewHash: null,
    ...over,
  };
}

/** A withdrawal: the call that carries no rule. */
const withdrawRequest = (
  version: number,
  requestId: string = nextIntent(),
) => ({
  requestId,
  streakId: CADENCE,
  version,
});

/** The answered refusal, every field of `StreakPublishCall.Refused`. */
const refused = (
  errorCode: StreakPublishCall_AnsweredCode,
  fields: readonly string[] = [],
  earliest: LocalDate | null = null,
  effectiveFromLocalDate: LocalDate | null = null,
) => ({
  streakPublishOutcome: StreakPublishOutcome.Refused,
  errorCode,
  fields,
  earliest,
  effectiveFromLocalDate,
});
type StreakPublishCall_AnsweredCode = Extract<
  StreakPublishAnswer,
  { readonly streakPublishOutcome: 'REFUSED' }
>['errorCode'];

const published = (
  version: number,
  effectiveFromLocalDate: LocalDate,
  streakRuleDirection: StreakRuleDirection,
) => ({
  streakPublishOutcome: StreakPublishOutcome.Published,
  version,
  effectiveFromLocalDate,
  streakRuleDirection,
});

const withdrawn = (version: number) => ({
  streakPublishOutcome: StreakPublishOutcome.Withdrawn,
  version,
});

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
      // The shop's day is the default location's (4A-11) — the fixture shop.
      ...memoryLocationLoadPorts(
        memoryProgramsWorld({ locations: [locationFixture()] }),
      ),
      ...memoryDefaultLocationPorts(),
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
    expect(refusal?.message).toBe(StreakPublishErrorCode.CallerUnauthenticated);
    expect(refusal?.details).toEqual({
      errorCode: StreakPublishErrorCode.CallerUnauthenticated,
    });
    expect(store).toEqual(before);
  });

  it.each([
    ['a barber', ['barber']],
    ['the front desk', ['receptionist']],
    ['a content manager', ['content_manager']],
    ['a client', ['client']],
    ['a caller with no role', []],
  ])('ANSWERS %s CALLER_NOT_ADMIN, and writes nothing', async (_who, roles) => {
    const { call, store, built } = rig();
    const before = new Map(store);
    const answer = await call(publishRequest({ graceDays: 10 }, TOMORROW), {
      uid: 'somebody',
      token: { roles },
    });
    expect(answer).toStrictEqual(
      refused(StreakPublishErrorCode.CallerNotAdmin),
    );
    expect(store).toEqual(before);
    expect(built()).toBe(0);
  });

  it('judges the caller before it reads the request: a stranger never learns what was wrong with the asking', async () => {
    const { call } = rig();
    expect(await call({ nonsense: true }, barber)).toStrictEqual(
      refused(StreakPublishErrorCode.CallerNotAdmin),
    );
    expect(await call(null, barber)).toMatchObject({
      errorCode: StreakPublishErrorCode.CallerNotAdmin,
    });
    expect((await thrownBy(call(null, NOBODY)))?.code).toBe('unauthenticated');
    // The admin pair is told what was wrong.
    expect((await thrownBy(call(null, owner)))?.details).toEqual({
      errorCode: StreakPublishErrorCode.InvalidInput,
      field: 'request',
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
    expect(answer).toMatchObject({
      streakPublishOutcome: StreakPublishOutcome.Refused,
      errorCode: StreakPublishErrorCode.CallerNotAdmin,
    });
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
    expect(answer).toMatchObject({
      streakPublishOutcome: StreakPublishOutcome.Published,
      version: 2,
    });
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
      Result.err(StreakPublishError.invalidInput('request')),
    );
    expect(
      decodeStreakPublish(request(withdrawRequest(2, 'intent-000000000001'))),
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

  it('reads the call component into the publish’s command, the FLAT rule into the rule’s input, its own day the day asked', () => {
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

  it('reads a call that carries no rule as a withdrawal — a `null` rule too', () => {
    for (const rule of [undefined, null]) {
      expect(
        decodeStreakRequest(
          { ...withdrawRequest(2, 'intent-000000000001'), rule },
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
    }
  });

  it('reads the legacy `op` as nothing: a call with a rule is a publish, whatever it says', () => {
    const read = decodeStreakRequest({ ...sound(), op: 'withdraw' }, caller);
    expect(read.ok && read.value.streakPublishOp).toBe(StreakPublishOp.Publish);
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
    ['a rule that is a list', { rule: [] }, 'rule'],
    ['a rule that is text', { rule: '{}' }, 'rule'],
    [
      'a rule nobody could call one for its size',
      {
        rule: ruleWith({
          streakQualifier: StreakQualifier.Services,
          qualifierServiceIds: Array.from(
            { length: 2000 },
            (_, i) => `svc-${i}`,
          ),
        }),
      },
      'rule',
    ],
    [
      'a transition nobody knows',
      { streakTransition: 'FORGET' },
      'streakTransition',
    ],
    [
      'a transition in the legacy words',
      { streakTransition: 'grandfather' },
      'streakTransition',
    ],
    ['no transition', { streakTransition: undefined }, 'streakTransition'],
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
        requestId: 'intent-000000000001',
        streakId: CADENCE,
        version,
      }),
    ).toBe('version');
  });

  it('reads a publish whose rule is missing as a withdrawal with no version — refused by `version`', () => {
    expect(fieldOf({ ...sound(), rule: undefined })).toBe('version');
  });

  it('reads an absent preview as none, and a recompute as the system’s word', () => {
    const raw = Object.fromEntries(
      Object.entries(sound()).filter(([key]) => key !== 'previewHash'),
    );
    const read = decodeStreakRequest(
      { ...raw, streakTransition: StreakTransition.Recompute },
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

  it('leaves the RULE to the pipeline: a rule of the wrong kinds is its `INVALID`, a day that is no text reads as none', () => {
    const read = decodeStreakRequest(
      {
        ...sound(),
        rule: { graceDays: '7', effectiveFromLocalDate: 20261001 },
      },
      caller,
    );
    expect(read).toMatchObject({
      ok: true,
      value: {
        publish: {
          draft: Result.err(
            StreakPublishError.invalid([
              StreakRuleField.EffectiveFromLocalDate,
            ]),
          ),
          effectiveFrom: '',
        },
      },
    });
  });
});

describe('decodeRule — the FLAT rule, field by field', () => {
  const fieldsOf = (
    patch: Readonly<Record<string, unknown>>,
    effectiveFrom: string = TOMORROW,
  ) => {
    const read = decodeRule(ruleWith(patch), effectiveFrom);
    return read.ok ? null : read.error.fields;
  };

  it('reads the recommended rule as its own flat input, its own number and day never read', () => {
    expect(
      decodeRule(
        ruleWith({ version: 41, effectiveFromLocalDate: '2020-01-01' }),
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
      decodeRule(
        ruleWith({
          streakQualifier: StreakQualifier.Services,
          qualifierServiceIds: ['svc-fade', 'svc-beard'],
          streakInterval: StreakInterval.Personal,
          intervalTolerancePct: 25,
          intervalMinDays: 28,
          intervalMaxDays: 56,
          intervalFallbackDays: 42,
          excuses: [StreakExcuse.ClosedDays, StreakExcuse.ShopClosure],
          onBreak: StreakOnBreak.Hold,
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
      decodeRule(
        ruleWith({
          streakQualifier: StreakQualifier.Categories,
          qualifierCategoryIds: ['cat-cuts'],
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

  it('reads nothing a rule has no business saying: an id and a name of its own are not the rule’s', () => {
    expect(
      decodeRule(
        ruleWith({ id: 'other', nameBg: 'Друго', nameEn: 'Other' }),
        TOMORROW,
      ),
    ).toEqual(decodeRule(ruleWith(), TOMORROW));
  });

  it.each([
    ['a figure sent as text', { graceDays: '7' }, StreakRuleField.GraceDays],
    ['a fraction of a day', { minGapDays: 1.5 }, StreakRuleField.MinGapDays],
    [
      'a figure below nothing',
      { riskLeadDays: -1 },
      StreakRuleField.RiskLeadDays,
    ],
    ['a switch that is no boolean', { enabled: 'yes' }, 'enabled'],
    [
      'an interval with no days',
      { intervalDays: undefined },
      StreakRuleField.IntervalDays,
    ],
    [
      'an interval of no kind',
      { streakInterval: undefined },
      StreakRuleField.IntervalKind,
    ],
    [
      'an interval in the legacy words',
      { streakInterval: 'fixed' },
      StreakRuleField.IntervalKind,
    ],
    [
      'a personal interval with a floor of text',
      {
        streakInterval: StreakInterval.Personal,
        intervalTolerancePct: 25,
        intervalMinDays: '28',
        intervalMaxDays: 56,
        intervalFallbackDays: 42,
      },
      StreakRuleField.IntervalMinDays,
    ],
    [
      'a hold switch that is a figure',
      { bookingHoldEnabled: 14 },
      'bookingHoldEnabled',
    ],
    [
      'a pause with no switch',
      { clientPauseEnabled: undefined },
      'clientPauseEnabled',
    ],
    [
      'a reserve with no cap',
      { protectionsMaxBanked: undefined },
      StreakRuleField.ProtectionsMaxBanked,
    ],
    [
      'an excuse nobody knows',
      { excuses: [StreakExcuse.ShopClosure, 'RAIN'] },
      StreakRuleField.Excuses,
    ],
    [
      'an excuse in the legacy words',
      { excuses: ['shopClosure'] },
      StreakRuleField.Excuses,
    ],
    [
      'excuses that are no list',
      { excuses: StreakExcuse.ShopClosure },
      StreakRuleField.Excuses,
    ],
    [
      'a list of services with a blank in it',
      {
        streakQualifier: StreakQualifier.Services,
        qualifierServiceIds: ['svc-fade', ' '],
      },
      StreakRuleField.QualifierServiceIds,
    ],
    [
      'a qualifier of no kind',
      { streakQualifier: undefined },
      StreakRuleField.QualifierKind,
    ],
    [
      'a miss that does something unknown',
      { onBreak: 'FORGIVE' },
      StreakRuleField.OnBreak,
    ],
    ['a part left out', { repairEnabled: undefined }, 'repairEnabled'],
  ])('names the flat field of %s', (_what, patch, field) => {
    expect(fieldsOf(patch)).toEqual([field]);
  });

  it('names the FIRST field the reader stopped at, never a later one', () => {
    expect(
      fieldsOf({ enabled: 'yes', graceDays: '7', onBreak: 'FORGIVE' }),
    ).toEqual(['enabled']);
    expect(fieldsOf({ streakInterval: 7, repairEnabled: undefined })).toEqual([
      StreakRuleField.IntervalKind,
    ]);
  });

  it('refuses a rule that holds nothing at its first field', () => {
    const read = decodeRule({}, TOMORROW);
    expect(read.ok ? null : read.error.fields).toEqual(['enabled']);
  });

  it.each([['next week'], ['2026-02-30'], ['2026-9-29'], ['']])(
    'refuses a day that is none, before any part of the rule: %j',
    (day) => {
      expect(fieldsOf({}, day)).toEqual([
        StreakRuleField.EffectiveFromLocalDate,
      ]);
      expect(fieldsOf({ enabled: 'yes' }, day)).toEqual([
        StreakRuleField.EffectiveFromLocalDate,
      ]);
    },
  );

  it('leaves a figure of the right kind to the rule: a grace of 60 days reads', () => {
    expect(decodeRule(ruleWith({ graceDays: 60 }), TOMORROW).ok).toBe(true);
    expect(
      decodeRule(
        ruleWith({
          streakQualifier: StreakQualifier.Services,
          qualifierServiceIds: [],
        }),
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
    return {
      status: error.code,
      message: error.message,
      details: error.details,
    };
  };

  it('answers INVALID with each flat field as the rule names it — no legacy locator', () => {
    expect(
      answered(
        StreakPublishError.invalid([
          StreakRuleField.IntervalDays,
          StreakRuleField.ScheduledEffectiveFromLocalDate,
          StreakRuleField.GraceDays,
        ]),
      ),
    ).toStrictEqual(
      Result.ok(
        refused(StreakPublishErrorCode.Invalid, [
          'intervalDays',
          'scheduledEffectiveFromLocalDate',
          'graceDays',
        ]),
      ),
    );
  });

  it('answers TOO_EARLY with the day asked and the first day it may start', () => {
    expect(
      answered(StreakPublishError.tooEarly(TODAY, TOMORROW)),
    ).toStrictEqual(
      Result.ok(refused(StreakPublishErrorCode.TooEarly, [], TOMORROW, TODAY)),
    );
  });

  it.each([
    [StreakPublishError.stale(1, 2)],
    [StreakPublishError.recomputeNeedsEngine()],
    [StreakPublishError.previewStale()],
    [StreakPublishError.callerNotAdmin()],
  ] as const)('answers %j with its code, no field and no day', (error) => {
    expect(answered(error)).toStrictEqual(Result.ok(refused(error.errorCode)));
  });

  it('throws CALLER_UNAUTHENTICATED as itself, `unauthenticated`', () => {
    expect(
      thrown(answered(StreakPublishError.callerUnauthenticated())),
    ).toEqual({
      status: 'unauthenticated',
      message: StreakPublishErrorCode.CallerUnauthenticated,
      details: { errorCode: StreakPublishErrorCode.CallerUnauthenticated },
    });
  });

  it('throws an envelope refusal as LOYALTY_STREAK_PUBLISH_INVALID_INPUT, by field', () => {
    expect(
      thrown(answered(StreakPublishError.invalidInput('baseVersion'))),
    ).toEqual({
      status: 'invalid-argument',
      message: StreakPublishErrorCode.InvalidInput,
      details: {
        errorCode: StreakPublishErrorCode.InvalidInput,
        field: 'baseVersion',
      },
    });
  });

  it('logs a failed write’s cause where alerting can find it, and throws STORE_FAILED without it', () => {
    const telemetry = log();
    const result = publishStreakRefusal(
      RepositoryError.writeFailed(null, 'Error: deadline exceeded'),
      telemetry,
    );
    const fault = thrown(result);
    expect(fault).toEqual({
      status: 'internal',
      message: StreakPublishErrorCode.StoreFailed,
      details: { errorCode: StreakPublishErrorCode.StoreFailed },
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

describe('the statuses (the deleted handler’s table on 6d43e1c, by successor code)', () => {
  // Three thrown faults and six answered refusals; their statuses stand.
  it.each([
    [StreakPublishErrorCode.CallerUnauthenticated, 'unauthenticated'],
    [StreakPublishErrorCode.InvalidInput, 'invalid-argument'],
    [StreakPublishErrorCode.StoreFailed, 'internal'],
  ])('throws %s as %s', (code, status) => {
    const rule = wireRuleOf(code);
    expect(isAnswered(code)).toBe(false);
    expect('httpsStatus' in rule ? rule.httpsStatus : null).toBe(status);
  });

  it.each([
    [StreakPublishErrorCode.CallerNotAdmin],
    [StreakPublishErrorCode.Invalid],
    [StreakPublishErrorCode.Stale],
    [StreakPublishErrorCode.TooEarly],
    [StreakPublishErrorCode.RecomputeNeedsEngine],
    [StreakPublishErrorCode.PreviewStale],
  ])('answers %s — never thrown', (code) => {
    expect(isAnswered(code)).toBe(true);
  });
});

describe('publishStreakDefinition — the answers, end to end', () => {
  it('publishes: the receipt, the documents and the row', async () => {
    const { call, store } = rig();
    expect(
      await call(publishRequest({ graceDays: 10 }, NEXT_WEEK)),
    ).toStrictEqual(published(2, NEXT_WEEK, StreakRuleDirection.Looser));
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

  it('publishes on the base it is told, one after the other', async () => {
    const { call } = rig();
    expect(
      await call(publishRequest({ graceDays: 10 }, TOMORROW)),
    ).toMatchObject({ streakPublishOutcome: StreakPublishOutcome.Published });
    expect(
      await call(
        publishRequest({ graceDays: 14 }, NEXT_WEEK, { baseVersion: 2 }),
      ),
    ).toMatchObject({
      streakPublishOutcome: StreakPublishOutcome.Published,
      version: 3,
    });
  });

  it('withdraws: the version that waits is called off by its number', async () => {
    const { call, store } = rig();
    await call(publishRequest({ graceDays: 10 }, NEXT_WEEK));
    expect(await call(withdrawRequest(2))).toStrictEqual(withdrawn(2));
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
      {
        graceDays: 60,
        repairEnabled: true,
        repairWindowDays: 0,
        repairPerYear: 1,
      },
      [StreakRuleField.GraceDays, StreakRuleField.RepairWindowDays],
    ],
    [
      'every fault the rule names, at once, in the rule’s order',
      {
        graceDays: 60,
        protectionsEnabled: true,
        protectionsMaxBanked: 2,
        protectionsEarnEvery: 5,
        protectionsStartWith: 4,
        repairEnabled: true,
        repairWindowDays: 0,
        repairPerYear: 9,
      },
      [
        StreakRuleField.GraceDays,
        StreakRuleField.ProtectionsStartWith,
        StreakRuleField.RepairWindowDays,
        StreakRuleField.RepairPerYear,
      ],
    ],
    [
      'a grace no shorter than the interval',
      {
        streakInterval: StreakInterval.Fixed,
        intervalDays: 14,
        graceDays: 14,
      },
      [StreakRuleField.GraceDays],
    ],
    [
      'a list of no services',
      { streakQualifier: StreakQualifier.Services, qualifierServiceIds: [] },
      [StreakRuleField.QualifierServiceIds],
    ],
    [
      'a personal interval whose floor is above its ceiling',
      {
        streakInterval: StreakInterval.Personal,
        intervalTolerancePct: 25,
        intervalMinDays: 56,
        intervalMaxDays: 28,
        intervalFallbackDays: 42,
      },
      [StreakRuleField.IntervalMinDays],
    ],
    ['a figure sent as text', { graceDays: '7' }, [StreakRuleField.GraceDays]],
    ['a part left out', { repairEnabled: undefined }, ['repairEnabled']],
  ])(
    'answers a rule that is no rule — %s — with its flat fields',
    async (_what, patch, fields) => {
      const { call, store } = rig();
      const before = new Map(store);
      expect(await call(publishRequest(patch, TOMORROW))).toStrictEqual(
        refused(StreakPublishErrorCode.Invalid, fields),
      );
      expect(store).toEqual(before);
    },
  );

  it('answers a rule that is wrong, and throws at an envelope that is: the page words one and not the other', async () => {
    const { call } = rig();
    expect(
      await call(publishRequest({ graceDays: 60 }, 20261001)),
    ).toStrictEqual(
      refused(StreakPublishErrorCode.Invalid, [
        StreakRuleField.EffectiveFromLocalDate,
      ]),
    );
    const envelope = await thrownBy(
      call({
        ...publishRequest({ graceDays: 10 }, TOMORROW),
        baseVersion: '1',
      }),
    );
    expect(envelope?.code).toBe('invalid-argument');
    expect(envelope?.details).toEqual({
      errorCode: StreakPublishErrorCode.InvalidInput,
      field: 'baseVersion',
    });
  });

  it('answers a day too early with the day asked and the first day the change may start', async () => {
    expect(
      await rig().call(publishRequest({ graceDays: 10 }, TODAY)),
    ).toStrictEqual(
      refused(StreakPublishErrorCode.TooEarly, [], TOMORROW, TODAY),
    );
  });

  it('holds a stricter rule to thirty days of notice once clients see their rhythm', async () => {
    const quiet = rig();
    expect(
      await quiet.call(publishRequest({ graceDays: 3 }, TOMORROW)),
    ).toMatchObject({
      streakPublishOutcome: StreakPublishOutcome.Published,
      streakRuleDirection: StreakRuleDirection.Stricter,
    });
    const seen = rig(seeded(), { clientsSeeRhythm: true });
    expect(
      await seen.call(publishRequest({ graceDays: 2 }, TOMORROW)),
    ).toStrictEqual(
      refused(StreakPublishErrorCode.TooEarly, [], NEXT_MONTH, TOMORROW),
    );
  });

  it('answers the other refusals with their codes, no field, and writes no row', async () => {
    const { call, store } = rig();
    expect(
      await call(
        publishRequest({ graceDays: 10 }, TOMORROW, { baseVersion: 4 }),
      ),
    ).toStrictEqual(refused(StreakPublishErrorCode.Stale));
    expect(
      await call(
        publishRequest({ graceDays: 10 }, TOMORROW, {
          streakTransition: StreakTransition.Recompute,
        }),
      ),
    ).toStrictEqual(refused(StreakPublishErrorCode.RecomputeNeedsEngine));
    expect(
      await call(
        publishRequest({ graceDays: 10 }, TOMORROW, { previewHash: 'abc' }),
      ),
    ).toStrictEqual(refused(StreakPublishErrorCode.PreviewStale));
    expect(await call(withdrawRequest(2))).toStrictEqual(
      refused(StreakPublishErrorCode.Stale),
    );
    expect(auditRows(store)).toEqual([]);
  });

  it('answers a scheduled version that would not start after the rule in force by its flat field', async () => {
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
    ).toStrictEqual(
      refused(StreakPublishErrorCode.Invalid, [
        StreakRuleField.ScheduledEffectiveFromLocalDate,
      ]),
    );
  });

  it('opens no rule but the business’s one: another id names nothing', async () => {
    expect(
      await rig(memoryStreakWorld()).call(
        publishRequest({}, TOMORROW, { baseVersion: 0, streakId: 'weekly' }),
      ),
    ).toStrictEqual(
      refused(StreakPublishErrorCode.Invalid, [StreakRuleField.Id]),
    );
  });

  it('writes nothing twice for a retry, and answers as it did', async () => {
    const { call, store } = rig();
    const asked = publishRequest({ graceDays: 10 }, NEXT_WEEK);
    const first = await call(asked);
    const written = new Map(store);
    expect(await call(asked)).toEqual(first);
    expect(store).toEqual(written);
    expect(auditRows(store)).toHaveLength(1);
  });
});

describe('publishStreakDefinition — the directions, and the notice nobody is owed yet', () => {
  it.each([
    [StreakRuleDirection.Looser, { graceDays: 10 }],
    [StreakRuleDirection.Stricter, { graceDays: 3 }],
    [StreakRuleDirection.Switch, { enabled: false }],
    [StreakRuleDirection.Mixed, { graceDays: 10, minGapDays: 10 }],
  ])(
    'lets a %s rule start tomorrow while no client sees the rhythm',
    async (direction, patch) => {
      expect(await rig().call(publishRequest(patch, TOMORROW))).toMatchObject({
        streakPublishOutcome: StreakPublishOutcome.Published,
        streakRuleDirection: direction,
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
        'a rule drawn before that: stale',
        publishRequest({ graceDays: 12 }, NEXT_WEEK),
      ],
      [
        'a longer interval from next month: it replaces what waited',
        publishRequest(
          { streakInterval: StreakInterval.Fixed, intervalDays: 49 },
          NEXT_MONTH,
          { baseVersion: 2 },
        ),
      ],
      ['the undo: what waits is called off', withdrawRequest(3, undo)],
      ['the undo, asked again: answered as it was', withdrawRequest(3, undo)],
      ['an undo of what no longer waits: stale', withdrawRequest(3)],
      [
        'the next rule proposes 2, which is taken: it is numbered 4',
        publishRequest(
          {
            protectionsEnabled: true,
            protectionsMaxBanked: 3,
            protectionsEarnEvery: 4,
            protectionsStartWith: 1,
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
          streakTransition: StreakTransition.Recompute,
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
      published(2, NEXT_WEEK, StreakRuleDirection.Looser),
      refused(StreakPublishErrorCode.Stale),
      published(3, NEXT_MONTH, StreakRuleDirection.Looser),
      withdrawn(3),
      withdrawn(3),
      refused(StreakPublishErrorCode.Stale),
      published(4, TOMORROW, StreakRuleDirection.Looser),
      refused(StreakPublishErrorCode.TooEarly, [], TOMORROW, TODAY),
      refused(StreakPublishErrorCode.RecomputeNeedsEngine),
      published(5, TODAY, StreakRuleDirection.Neutral),
      published(5, TODAY, StreakRuleDirection.Neutral),
      published(6, TOMORROW, StreakRuleDirection.Switch),
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
    ).toStrictEqual(published(1, NEXT_MONTH, StreakRuleDirection.Neutral));
    expect(
      [...store.keys()].filter((key) => key.startsWith(HEAD)).sort(),
    ).toEqual([HEAD, `${HEAD}/versions/000001`]);
    expect(auditRows(store)).toHaveLength(1);
  });
});
