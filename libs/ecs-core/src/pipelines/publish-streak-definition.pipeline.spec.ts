import { describe, expect, it } from 'vitest';
import {
  Actor,
  AuditAction,
  FlagName,
  HeadRole,
  StreakExcuse,
  StreakInterval,
  StreakQualifier,
  StreakRule,
  StreakRuleDirection,
  StreakRuleParameter,
  StreakTransition,
  WriteOp,
  type StreakHeadRule,
  type StreakRuleInput,
} from '@core/components';
import {
  AuditResourceId,
  PublishRequestId,
  RepositoryError,
  Result,
  ServiceId,
  StreakDefinitionId,
  StreakDefinitionVersionId,
  StreakPublishError,
  StreakRuleField,
  UserId,
  type UtcEpochMs,
} from '@core/primitives';
import {
  Collections,
  QueryOp,
  type StreakDefinitionVersion,
  Subcollections,
} from '@core/entities';
import { AuditSystem } from '@core/systems';
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
  streakDefinitionFixture,
  streakDefinitionVersionFixture,
  type StreakWorld,
  utcMs,
} from '@core/testing';
import {
  type PublishStreakDefinitionCommand,
  type PublishStreakDefinitionPorts,
  publishStreakDefinition,
  type WithdrawStreakDefinitionCommand,
  withdrawStreakDefinition,
} from './publish-streak-definition.pipeline';

/*
 * `publishStreakDefinition` / `withdrawStreakDefinition` (loyalty flip (3),
 * F3-8) over the in-memory commit: the exact `WriteOp[]` each act commits,
 * the read set, the replay and every refusal in today's order. Successor of
 * the deleted functions specs of the publish use case (the decision over a
 * store) and of its Firestore store (what is written where) — the
 * decision's math itself is
 * `streak-publish.system.spec.ts`'s, the wire's words `loyalty.wire.spec.ts`'s.
 * Every day and instant is pinned; nothing reads the wall clock.
 */

const CADENCE = StreakRule.DEFAULT_DEFINITION_ID;
const TODAY = localDate('2026-09-28');
const TOMORROW = localDate('2026-09-29');
const NEXT_WEEK = localDate('2026-10-05');
const NEXT_MONTH = localDate('2026-10-28');
/** 09:00 in Sofia on the fixtures' day. */
const NOW: UtcEpochMs = utcMs('2026-09-28T09:00:00.000+03:00');

const FADE = ServiceId.of('svc-fade');
const BEARD = ServiceId.of('svc-beard');
const OWNER = UserId.of('dev-staff-ivan');
const OWNER_ACTOR = Actor.forCaller(OWNER, ['barber', 'admin']);
const VENDOR = UserId.of('vendor-1');
const VENDOR_ACTOR = Actor.forCaller(VENDOR, ['sysadmin']);

const HEAD_PATH = [Collections.StreakDefinitions, CADENCE];
const versionPath = (version: number): readonly string[] => [
  Collections.StreakDefinitions,
  CADENCE,
  Subcollections.Versions,
  StreakDefinitionVersionId.forVersion(version),
];
const storeKey = (path: readonly string[]): string => path.join('/');
const rowPath = (action: AuditAction, requestId: string): readonly string[] => [
  Collections.AuditLog,
  fixtureHash(
    AuditSystem.rowBasis(
      action,
      AuditResourceId.forStreakDefinition(CADENCE),
      null,
      requestId,
    ),
  ),
];

/** The recommended rule with `patch` over it: a version of its own. */
function rule(patch: Partial<StreakRule> = {}): StreakRule {
  const parsed = StreakRule.parse({
    ...StreakRule.DEFAULT,
    ...patch,
  } as StreakRule);
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.error));
  return parsed.value;
}

const asCurrent = (r: StreakRule): StreakHeadRule => ({
  ...StreakRule.of(r),
  headRole: HeadRole.Current,
  streakTransition: null,
});

const asScheduled = (r: StreakRule): StreakHeadRule => ({
  ...StreakRule.of(r),
  headRole: HeadRole.Scheduled,
  streakTransition: StreakTransition.Grandfather,
});

/** Version 2 — ten days of grace — waiting for next week. */
const V2 = rule({
  version: 2,
  effectiveFromLocalDate: NEXT_WEEK,
  graceDays: 10,
});

/** Version 2's document, as the publish that scheduled it wrote it. */
const V2_DOC: StreakDefinitionVersion = {
  ...StreakRule.of(V2),
  id: StreakDefinitionVersionId.forVersion(2),
  publishedAtUtcMs: utcMs('2026-09-20T10:00:00.000+03:00'),
  publishedByUserId: OWNER,
  streakTransition: StreakTransition.Grandfather,
  streakRuleDirection: StreakRuleDirection.Looser,
  changed: [StreakRuleParameter.GraceDays],
  requestId: PublishRequestId.of('request-that-scheduled-2'),
  withdrawnAtUtcMs: null,
};

/** The shop as the seed leaves it: the recommended rule in force, its one version. */
function seeded(): StreakWorld {
  return memoryStreakWorld({
    heads: [streakDefinitionFixture()],
    versions: [
      { streakId: CADENCE, version: streakDefinitionVersionFixture() },
    ],
  });
}

/** The same shop with version 2 waiting for next week — its document there, or not. */
function waiting(withDocument = true): StreakWorld {
  return memoryStreakWorld({
    heads: [
      streakDefinitionFixture({
        rules: [asCurrent(rule()), asScheduled(V2)],
        updatedAtUtcMs: V2_DOC.publishedAtUtcMs,
      }),
    ],
    versions: [
      { streakId: CADENCE, version: streakDefinitionVersionFixture() },
      ...(withDocument ? [{ streakId: CADENCE, version: V2_DOC }] : []),
    ],
  });
}

/**
 * The shop day's clock (Law 7.2, F-4 — a rhythm names no shop): the
 * default location's, the fixture shop on `FIXTURE_TIME_ZONE`.
 */
const ZONE_PORTS = {
  ...memoryLocationLoadPorts(
    memoryProgramsWorld({ locations: [locationFixture()] }),
  ),
  ...memoryDefaultLocationPorts(),
};

function rig(
  world: StreakWorld,
  options: {
    readonly now?: UtcEpochMs;
    readonly clientsSeeRhythm?: boolean;
  } = {},
) {
  const tx = memoryTxPorts(world.store, {
    nowUtcMs: pinnedNowUtcMs(options.now ?? NOW),
    hash: fixtureHash,
  });
  const ports: PublishStreakDefinitionPorts = {
    ...tx,
    flagOn: (key) =>
      key === FlagName.LoyaltySelfView && options.clientsSeeRhythm === true,
    ...ZONE_PORTS,
  };
  return {
    tx,
    store: world.store,
    publish: publishStreakDefinition(ports),
    withdraw: withdrawStreakDefinition(ports),
  };
}

let intents = 0;
const nextIntent = (): PublishRequestId =>
  PublishRequestId.of(`request-${String((intents += 1)).padStart(12, '0')}`);

/** The draft as the wire decodes it: the recommended rule with `patch` over it; its own number a placeholder. */
const draftOf = (patch: Partial<StreakRuleInput> = {}): StreakRuleInput =>
  ({ ...StreakRule.DEFAULT, version: 0, ...patch }) as StreakRuleInput;

function publishOf(
  patch: Partial<StreakRuleInput>,
  effectiveFrom: string,
  over: Partial<PublishStreakDefinitionCommand> = {},
): PublishStreakDefinitionCommand {
  return {
    callerUserId: OWNER,
    callerIsAdmin: true,
    callerActor: OWNER_ACTOR,
    requestId: nextIntent(),
    streakId: CADENCE,
    baseVersion: 1,
    draft: Result.ok(draftOf(patch)),
    effectiveFrom,
    streakTransition: StreakTransition.Grandfather,
    previewHash: null,
    ...over,
  };
}

function withdrawOf(
  version: number,
  over: Partial<WithdrawStreakDefinitionCommand> = {},
): WithdrawStreakDefinitionCommand {
  return {
    callerUserId: OWNER,
    callerIsAdmin: true,
    callerActor: OWNER_ACTOR,
    requestId: nextIntent(),
    streakId: CADENCE,
    version,
    ...over,
  };
}

const errorCodeOf = (result: {
  readonly ok: boolean;
  readonly error?: { readonly errorCode: string };
}): string | null => (result.ok ? null : (result.error?.errorCode ?? null));

describe('publishStreakDefinition — what one publish writes', () => {
  it('lets a later day WAIT: the version, the stamped head [CURRENT, SCHEDULED] and ONE row, in that order', async () => {
    const { tx, publish } = rig(seeded());
    const cmd = publishOf({ graceDays: 10, riskLeadDays: 3 }, NEXT_WEEK);

    expect(await publish(cmd)).toEqual(
      Result.ok({
        version: 2,
        effectiveFromLocalDate: NEXT_WEEK,
        streakRuleDirection: StreakRuleDirection.Looser,
      }),
    );
    const scheduled = rule({
      version: 2,
      effectiveFromLocalDate: NEXT_WEEK,
      graceDays: 10,
      riskLeadDays: 3,
    });
    expect(tx.plans).toEqual([
      [
        WriteOp.create(versionPath(2), {
          ...StreakRule.of(scheduled),
          publishedAtUtcMs: NOW,
          publishedByUserId: OWNER,
          streakTransition: StreakTransition.Grandfather,
          streakRuleDirection: StreakRuleDirection.Looser,
          changed: [
            StreakRuleParameter.GraceDays,
            StreakRuleParameter.RiskLeadDays,
          ],
          requestId: cmd.requestId,
          withdrawnAtUtcMs: null,
        }),
        WriteOp.set(HEAD_PATH, {
          name: StreakRule.DEFAULT_NAME,
          rules: [asCurrent(rule()), asScheduled(scheduled)],
          updatedAtUtcMs: NOW,
        }),
        // The flat AuditEntry body (F1-8): the owner as ADMIN, every fact a root key, in codes.
        WriteOp.create(
          rowPath(AuditAction.LoyaltyStreakDefinitionPublished, cmd.requestId),
          {
            recordedAtUtcMs: NOW,
            resourceId: 'streakDefinitions/cadence',
            actorRole: 'ADMIN',
            actorAdminUserId: OWNER,
            auditAction: AuditAction.LoyaltyStreakDefinitionPublished,
            streakFromVersion: 1,
            streakToVersion: 2,
            streakEffectiveFrom: NEXT_WEEK,
            streakTransition: StreakTransition.Grandfather,
            streakRuleDirection: StreakRuleDirection.Looser,
            streakChanged: [
              StreakRuleParameter.GraceDays,
              StreakRuleParameter.RiskLeadDays,
            ],
            streakReplacedVersion: null,
            // The rule is the shop's: the row is about no one client.
            auditTarget: 'NONE',
          },
        ),
      ],
    ]);
  });

  it('leaves exactly those documents: the first version is nobody’s to rewrite', async () => {
    const world = seeded();
    const before = world.store.get(storeKey(versionPath(1)));
    const { store, publish } = rig(world);
    await publish(publishOf({ graceDays: 10 }, NEXT_WEEK));
    expect(store.get(storeKey(versionPath(1)))).toEqual(before);
    expect(
      [...store.keys()].filter((key) => key.startsWith('auditLog/')),
    ).toHaveLength(1);
    expect(store.size).toBe(4);
  });

  it('puts a version effective today in force at once: the head holds it alone', async () => {
    const { tx, store, publish } = rig(seeded());
    // The staff's cue alone moves nothing for a client: it may start today.
    expect(await publish(publishOf({ riskLeadDays: 3 }, TODAY))).toEqual(
      Result.ok({
        version: 2,
        effectiveFromLocalDate: TODAY,
        streakRuleDirection: StreakRuleDirection.Neutral,
      }),
    );
    expect(store.get(storeKey(HEAD_PATH))).toEqual({
      name: StreakRule.DEFAULT_NAME,
      rules: [
        asCurrent(
          rule({ version: 2, effectiveFromLocalDate: TODAY, riskLeadDays: 3 }),
        ),
      ],
      updatedAtUtcMs: NOW,
    });
    expect(tx.plans[0]?.map((op) => op.writeAction)).toEqual([
      'CREATE',
      'SET',
      'CREATE',
    ]);
  });

  it('replaces what waited and stamps its document; compared with the rule IN FORCE', async () => {
    const { tx, store, publish } = rig(waiting());
    const before = store.get(storeKey(versionPath(2)));
    const cmd = publishOf({ graceDays: 14 }, NEXT_MONTH, { baseVersion: 2 });

    expect(await publish(cmd)).toEqual(
      Result.ok({
        version: 3,
        effectiveFromLocalDate: NEXT_MONTH,
        streakRuleDirection: StreakRuleDirection.Looser,
      }),
    );
    const plan = tx.plans[0] ?? [];
    expect(plan[1]).toEqual(
      WriteOp.update(versionPath(2), { withdrawnAtUtcMs: NOW }),
    );
    expect(plan.map((op) => op.writeAction)).toEqual([
      'CREATE',
      'UPDATE',
      'SET',
      'CREATE',
    ]);
    expect(store.get(storeKey(versionPath(2)))).toEqual({
      ...before,
      withdrawnAtUtcMs: NOW,
    });
    expect(store.get(storeKey(HEAD_PATH))).toMatchObject({
      rules: [
        { version: 1, headRole: 'CURRENT' },
        { version: 3, graceDays: 14, headRole: 'SCHEDULED' },
      ],
    });
    expect(plan[3]).toMatchObject({
      body: {
        streakFromVersion: 1,
        streakToVersion: 3,
        streakReplacedVersion: 2,
      },
    });
  });

  it('has nothing to stamp when what waited has no document of its own', async () => {
    const { tx, store, publish } = rig(waiting(false));
    expect(
      (
        await publish(
          publishOf({ graceDays: 14 }, NEXT_MONTH, { baseVersion: 2 }),
        )
      ).ok,
    ).toBe(true);
    expect(tx.plans[0]?.map((op) => op.writeAction)).toEqual([
      'CREATE',
      'SET',
      'CREATE',
    ]);
    expect(store.has(storeKey(versionPath(2)))).toBe(false);
    expect(store.get(storeKey(versionPath(3)))).toMatchObject({ version: 3 });
  });

  it('keeps what came into force by date as the rule in force of the new head, and stamps nothing', async () => {
    // Version 2 waited for next week, and next week has come.
    const { tx, publish } = rig(waiting(), {
      now: utcMs('2026-10-06T09:00:00.000+03:00'),
    });
    expect(
      await publish(
        publishOf({ graceDays: 14 }, NEXT_MONTH, { baseVersion: 2 }),
      ),
    ).toMatchObject({ ok: true, value: { version: 3 } });
    const plan = tx.plans[0] ?? [];
    expect(plan.map((op) => op.writeAction)).toEqual([
      'CREATE',
      'SET',
      'CREATE',
    ]);
    expect(plan[1]).toMatchObject({
      body: {
        rules: [
          {
            version: 2,
            graceDays: 10,
            headRole: 'CURRENT',
            streakTransition: null,
          },
          { version: 3, graceDays: 14, headRole: 'SCHEDULED' },
        ],
      },
    });
    expect(plan[2]).toMatchObject({
      body: { streakFromVersion: 2, streakReplacedVersion: null },
    });
  });

  it('opens a shop’s first rule on nothing: head, version 1 and its row; in force whatever its day', async () => {
    const world = memoryStreakWorld();
    const { store, publish } = rig(world);
    const cmd = publishOf({}, NEXT_MONTH, { baseVersion: 0 });

    expect(await publish(cmd)).toEqual(
      Result.ok({
        version: 1,
        effectiveFromLocalDate: NEXT_MONTH,
        streakRuleDirection: StreakRuleDirection.Neutral,
      }),
    );
    expect([...store.keys()].sort()).toEqual(
      [
        storeKey(HEAD_PATH),
        storeKey(versionPath(1)),
        storeKey(
          rowPath(AuditAction.LoyaltyStreakDefinitionPublished, cmd.requestId),
        ),
      ].sort(),
    );
    // The name is the recommended rule's: a draft carries none.
    expect(store.get(storeKey(HEAD_PATH))).toEqual({
      name: StreakRule.DEFAULT_NAME,
      rules: [asCurrent(rule({ effectiveFromLocalDate: NEXT_MONTH }))],
      updatedAtUtcMs: NOW,
    });
    expect(store.get(storeKey(versionPath(1)))).toMatchObject({ changed: [] });
    expect(
      store.get(
        storeKey(
          rowPath(AuditAction.LoyaltyStreakDefinitionPublished, cmd.requestId),
        ),
      ),
    ).toMatchObject({ streakFromVersion: 0, streakToVersion: 1 });
  });

  it('keeps the name the head holds, and lists what moved against it', async () => {
    const named = memoryStreakWorld({
      heads: [
        streakDefinitionFixture({ name: { bg: 'Ритъмът', en: 'The rhythm' } }),
      ],
    });
    const { store, publish } = rig(named);
    await publish(publishOf({ graceDays: 10 }, TOMORROW));
    expect(store.get(storeKey(HEAD_PATH))).toMatchObject({
      name: { bg: 'Ритъмът', en: 'The rhythm' },
    });
    expect(store.get(storeKey(versionPath(2)))).toMatchObject({
      changed: [StreakRuleParameter.GraceDays],
    });
  });

  it('signs the version with the vendor, and the row names them as STAFF: the owner’s act told from the vendor’s', async () => {
    const { store, publish } = rig(seeded());
    const cmd = publishOf({ graceDays: 10 }, TOMORROW, {
      callerUserId: VENDOR,
      callerActor: VENDOR_ACTOR,
    });
    await publish(cmd);
    expect(store.get(storeKey(versionPath(2)))).toMatchObject({
      publishedByUserId: VENDOR,
    });
    expect(
      store.get(
        storeKey(
          rowPath(AuditAction.LoyaltyStreakDefinitionPublished, cmd.requestId),
        ),
      ),
    ).toMatchObject({
      actorRole: 'STAFF',
      actorUserId: VENDOR,
      actorRoles: ['sysadmin'],
    });
  });

  it('stores the rule flat and as parsed: a services qualifier de-duplicated, the excuses in the vocabulary’s order', async () => {
    const { store, publish } = rig(seeded());
    await publish(
      publishOf(
        {
          streakQualifier: StreakQualifier.Services,
          qualifierServiceIds: [FADE, BEARD, FADE],
          streakInterval: StreakInterval.Personal,
          intervalTolerancePct: 25,
          intervalMinDays: 28,
          intervalMaxDays: 56,
          intervalFallbackDays: 42,
          excuses: [StreakExcuse.ClosedDays, StreakExcuse.ShopClosure],
        },
        NEXT_WEEK,
      ),
    );
    expect(store.get(storeKey(versionPath(2)))).toMatchObject({
      streakQualifier: StreakQualifier.Services,
      qualifierServiceIds: ['svc-fade', 'svc-beard'],
      streakInterval: StreakInterval.Personal,
      intervalTolerancePct: 25,
      excuses: [StreakExcuse.ShopClosure, StreakExcuse.ClosedDays],
      changed: [
        StreakRuleParameter.Qualifier,
        StreakRuleParameter.Interval,
        StreakRuleParameter.Excuses,
      ],
    });
  });
});

describe('publishStreakDefinition — the version’s number', () => {
  it('numbers the version itself: the draft’s number is a proposal', async () => {
    const { publish } = rig(seeded());
    expect(
      await publish(publishOf({ graceDays: 10, version: 41 }, TOMORROW)),
    ).toMatchObject({ ok: true, value: { version: 2 } });
  });

  it('never gives a called-off version’s number away: one above the highest ever written', async () => {
    const world = waiting();
    const { publish, withdraw, store } = rig(world);
    expect((await withdraw(withdrawOf(2))).ok).toBe(true);
    const calledOff = store.get(storeKey(versionPath(2)));
    // The head is back on version 1: the next draft is made on 1 and proposes 2, which is taken.
    expect(
      await publish(publishOf({ graceDays: 14 }, NEXT_WEEK)),
    ).toMatchObject({
      ok: true,
      value: { version: 3 },
    });
    expect(store.get(storeKey(versionPath(2)))).toEqual(calledOff);
    expect(store.get(storeKey(versionPath(3)))).toMatchObject({
      graceDays: 14,
    });
  });

  it('takes the day from the request, never from the draft', async () => {
    const { publish } = rig(seeded());
    expect(
      await publish(
        publishOf(
          { graceDays: 10, effectiveFromLocalDate: '2020-01-01' },
          NEXT_WEEK,
        ),
      ),
    ).toMatchObject({ ok: true, value: { effectiveFromLocalDate: NEXT_WEEK } });
  });

  it('never rewrites a version: a number that is taken fails the act with the commit’s ALREADY_EXISTS, nothing written', async () => {
    // A document under 000002 that says it is version 1 — the id == version
    // invariant broken — so the highest number read is 1 and 2 is proposed.
    const world = seeded();
    world.store.set(storeKey(versionPath(2)), {
      ...world.store.get(storeKey(versionPath(1))),
    });
    const before = new Map(world.store);
    const { publish } = rig(world);
    expect(await publish(publishOf({ graceDays: 10 }, NEXT_WEEK))).toEqual(
      Result.err(RepositoryError.alreadyExists(storeKey(versionPath(2)))),
    );
    expect(world.store).toEqual(before);
  });
});

describe('publishStreakDefinition — what it refuses, in today’s order', () => {
  it('refuses nobody — no uid, a blank uid, no verified actor — before anything is read', async () => {
    for (const over of [
      { callerUserId: null, callerActor: null },
      { callerUserId: UserId.of(' ') },
      { callerActor: null },
    ] as const) {
      const { tx, publish } = rig(seeded());
      expect(
        errorCodeOf(
          await publish(publishOf({ graceDays: 10 }, TOMORROW, over)),
        ),
      ).toBe('LOYALTY_STREAK_PUBLISH_CALLER_UNAUTHENTICATED');
      expect(tx.transactions).toEqual([]);
    }
  });

  it('refuses anyone but the admin pair as CALLER_NOT_ADMIN, and never reaches the store', async () => {
    const { tx, publish } = rig(seeded());
    expect(
      await publish(
        publishOf({ graceDays: 10 }, TOMORROW, { callerIsAdmin: false }),
      ),
    ).toEqual(Result.err(StreakPublishError.callerNotAdmin()));
    expect(tx.transactions).toEqual([]);
  });

  it('refuses a head that moved (stale), a recompute, a preview — before the draft is judged', async () => {
    const broken: PublishStreakDefinitionCommand['draft'] = Result.err(
      StreakPublishError.invalid(['interval.days']),
    );
    const { tx, publish } = rig(waiting());
    expect(
      await publish(
        publishOf({ graceDays: 14 }, NEXT_MONTH, {
          baseVersion: 1,
          draft: broken,
        }),
      ),
    ).toEqual(Result.err(StreakPublishError.stale(1, 2)));
    expect(
      await publish(
        publishOf({}, NEXT_MONTH, {
          baseVersion: 2,
          streakTransition: StreakTransition.Recompute,
          draft: broken,
        }),
      ),
    ).toEqual(Result.err(StreakPublishError.recomputeNeedsEngine()));
    expect(
      await publish(
        publishOf({}, NEXT_MONTH, {
          baseVersion: 2,
          previewHash: 'sha256-abc',
          draft: broken,
        }),
      ),
    ).toEqual(Result.err(StreakPublishError.previewStale()));
    expect(tx.plans).toEqual([]);
  });

  it('refuses a base the shop never had, and judges the base by the head, not by the history', async () => {
    expect(
      errorCodeOf(
        await rig(memoryStreakWorld()).publish(publishOf({}, TOMORROW)),
      ),
    ).toBe('LOYALTY_STREAK_PUBLISH_STALE');
    // Version 2 was published and called off: the head is back on 1, its document still there.
    const world = memoryStreakWorld({
      heads: [streakDefinitionFixture()],
      versions: [
        { streakId: CADENCE, version: streakDefinitionVersionFixture() },
        { streakId: CADENCE, version: { ...V2_DOC, withdrawnAtUtcMs: NOW } },
      ],
    });
    expect(
      await rig(world).publish(
        publishOf({ graceDays: 10 }, TOMORROW, { baseVersion: 2 }),
      ),
    ).toEqual(Result.err(StreakPublishError.stale(2, 1)));
  });

  it('opens no rule but the business’s one: another id names nothing', async () => {
    const { tx, publish } = rig(memoryStreakWorld());
    expect(
      await publish(
        publishOf({}, TOMORROW, {
          baseVersion: 0,
          streakId: StreakDefinitionId.of('weekly'),
        }),
      ),
    ).toEqual(Result.err(StreakPublishError.invalid([StreakRuleField.Id])));
    expect(tx.plans).toEqual([]);
  });

  it('answers the wire’s own draft fault as it is, once the head is admitted', async () => {
    const { publish } = rig(seeded());
    expect(
      await publish(
        publishOf({}, TOMORROW, {
          draft: Result.err(StreakPublishError.invalid(['interval.days'])),
        }),
      ),
    ).toEqual(Result.err(StreakPublishError.invalid(['interval.days'])));
  });

  it('names every flat field the rule refuses, at once, each once, in the rule’s order', async () => {
    const { tx, publish } = rig(seeded());
    expect(
      await publish(
        publishOf(
          {
            graceDays: 60,
            protectionsMaxBanked: 2,
            protectionsStartWith: 4,
            repairWindowDays: 0,
            repairPerYear: 9,
          },
          TOMORROW,
        ),
      ),
    ).toEqual(
      Result.err(
        StreakPublishError.invalid([
          StreakRuleField.GraceDays,
          StreakRuleField.ProtectionsStartWith,
          StreakRuleField.RepairWindowDays,
          StreakRuleField.RepairPerYear,
        ]),
      ),
    );
    expect(
      await publish(publishOf({ intervalDays: 14, graceDays: 14 }, TOMORROW)),
    ).toEqual(
      Result.err(StreakPublishError.invalid([StreakRuleField.GraceDays])),
    );
    expect(tx.plans).toEqual([]);
  });

  it.each([['next week'], ['2026-02-30'], ['2026-9-29'], ['']])(
    'refuses a day that is none: %j',
    async (day) => {
      expect(await rig(seeded()).publish(publishOf({}, day))).toEqual(
        Result.err(
          StreakPublishError.invalid([StreakRuleField.EffectiveFromLocalDate]),
        ),
      );
    },
  );

  it('refuses a day the change may not start on yet, and says the first it may', async () => {
    const { tx, publish } = rig(seeded());
    // More grace favours the client: tomorrow, never today.
    expect(await publish(publishOf({ graceDays: 10 }, TODAY))).toEqual(
      Result.err(StreakPublishError.tooEarly(TODAY, TOMORROW)),
    );
    expect(
      errorCodeOf(await publish(publishOf({ riskLeadDays: 3 }, '2026-09-27'))),
    ).toBe('LOYALTY_STREAK_PUBLISH_TOO_EARLY');
    expect(tx.plans).toEqual([]);
  });

  it.each([
    ['looser', { graceDays: 10 }, StreakRuleDirection.Looser],
    ['stricter', { graceDays: 3 }, StreakRuleDirection.Stricter],
    ['mixed', { graceDays: 10, minGapDays: 10 }, StreakRuleDirection.Mixed],
  ] as const)(
    'lets a %s rule start tomorrow while no client sees the rhythm',
    async (_direction, patch, direction) => {
      expect(
        await rig(seeded()).publish(publishOf(patch, TOMORROW)),
      ).toMatchObject({ ok: true, value: { streakRuleDirection: direction } });
    },
  );

  it('owes the clients who see the rhythm (`loyalty.selfView`) thirty days’ notice of a stricter rule', async () => {
    const seen = { clientsSeeRhythm: true } as const;
    expect(
      await rig(seeded(), seen).publish(publishOf({ graceDays: 3 }, TOMORROW)),
    ).toEqual(Result.err(StreakPublishError.tooEarly(TOMORROW, NEXT_MONTH)));
    expect(
      await rig(seeded(), seen).publish(
        publishOf({ graceDays: 3 }, NEXT_MONTH),
      ),
    ).toMatchObject({ ok: true, value: { streakRuleDirection: 'STRICTER' } });
    // What favours them owes no notice.
    expect(
      (
        await rig(seeded(), seen).publish(
          publishOf({ graceDays: 10 }, TOMORROW),
        )
      ).ok,
    ).toBe(true);
    expect(StreakRule.RULE_CHANGE_NOTICE_DAYS).toBe(30);
  });

  it('refuses a scheduled version that would not start after the rule in force', async () => {
    // A first rule is in force whatever its day: this one starts next month.
    const ahead = memoryStreakWorld({
      heads: [
        streakDefinitionFixture({
          rules: [asCurrent(rule({ effectiveFromLocalDate: NEXT_MONTH }))],
        }),
      ],
    });
    expect(
      await rig(ahead).publish(publishOf({ graceDays: 10 }, NEXT_WEEK)),
    ).toEqual(
      Result.err(
        StreakPublishError.invalid([
          StreakRuleField.ScheduledEffectiveFromLocalDate,
        ]),
      ),
    );
  });
});

describe('withdrawStreakDefinition', () => {
  it('stamps what waited, holds the rule in force alone and writes ONE row; adds no version', async () => {
    const { tx, store, withdraw } = rig(waiting());
    const before = store.get(storeKey(versionPath(2)));
    const cmd = withdrawOf(2);

    expect(await withdraw(cmd)).toEqual(Result.ok({ version: 2 }));
    expect(tx.plans).toEqual([
      [
        WriteOp.update(versionPath(2), { withdrawnAtUtcMs: NOW }),
        WriteOp.set(HEAD_PATH, {
          name: StreakRule.DEFAULT_NAME,
          rules: [asCurrent(rule())],
          updatedAtUtcMs: NOW,
        }),
        WriteOp.create(
          rowPath(AuditAction.LoyaltyStreakDefinitionWithdrawn, cmd.requestId),
          {
            recordedAtUtcMs: NOW,
            resourceId: 'streakDefinitions/cadence',
            actorRole: 'ADMIN',
            actorAdminUserId: OWNER,
            auditAction: AuditAction.LoyaltyStreakDefinitionWithdrawn,
            streakFromVersion: 2,
            streakToVersion: 1,
            streakEffectiveFrom: NEXT_WEEK,
            streakTransition: StreakTransition.Grandfather,
            auditTarget: 'NONE',
          },
        ),
      ],
    ]);
    expect(store.get(storeKey(versionPath(2)))).toEqual({
      ...before,
      withdrawnAtUtcMs: NOW,
    });
    expect(store.has(storeKey(versionPath(3)))).toBe(false);
  });

  it('has nothing to stamp when what waits has no document', async () => {
    const { tx, withdraw } = rig(waiting(false));
    expect((await withdraw(withdrawOf(2))).ok).toBe(true);
    expect(tx.plans[0]?.map((op) => op.writeAction)).toEqual(['SET', 'CREATE']);
  });

  it('refuses what no longer waits: another version, nothing, a day that came, no rule, the rule in force', async () => {
    const cases: readonly [StreakWorld, number, UtcEpochMs, number][] = [
      [waiting(), 3, NOW, 2],
      [seeded(), 2, NOW, 0],
      [waiting(), 2, utcMs('2026-10-05T09:00:00.000+03:00'), 0],
      [memoryStreakWorld(), 1, NOW, 0],
      [waiting(), 1, NOW, 2],
    ];
    for (const [world, version, now, actual] of cases) {
      const { tx, withdraw } = rig(world, { now });
      expect(await withdraw(withdrawOf(version))).toEqual(
        Result.err(StreakPublishError.stale(version, actual)),
      );
      expect(tx.plans).toEqual([]);
    }
  });

  it('judges the caller by the same gate, before anything is read', async () => {
    const { tx, withdraw } = rig(waiting());
    expect(
      errorCodeOf(await withdraw(withdrawOf(2, { callerIsAdmin: false }))),
    ).toBe('LOYALTY_STREAK_PUBLISH_CALLER_NOT_ADMIN');
    expect(
      errorCodeOf(
        await withdraw(
          withdrawOf(2, { callerUserId: null, callerActor: null }),
        ),
      ),
    ).toBe('LOYALTY_STREAK_PUBLISH_CALLER_UNAUTHENTICATED');
    expect(tx.transactions).toEqual([]);
  });
});

describe('a retry writes nothing, and answers as it did', () => {
  it('answers the retry of a publish with the ORIGINAL receipt, a day later, from the version it wrote', async () => {
    const world = seeded();
    const cmd = publishOf({ graceDays: 10 }, NEXT_WEEK);
    const first = await rig(world).publish(cmd);
    const written = new Map(world.store);
    // The head moved with the first attempt, and a day has passed.
    const again = rig(world, { now: utcMs('2026-09-29T09:00:00.000+03:00') });
    expect(await again.publish(cmd)).toEqual(first);
    expect(world.store).toEqual(written);
    expect(again.tx.plans).toEqual([[]]);
  });

  it('finds its own write before it decides anything: no admit, no stale', async () => {
    const { tx, publish } = rig(waiting());
    expect(
      await publish(
        publishOf({ graceDays: 99 }, TODAY, {
          requestId: V2_DOC.requestId,
          baseVersion: 7,
        }),
      ),
    ).toEqual(
      Result.ok({
        version: 2,
        effectiveFromLocalDate: NEXT_WEEK,
        streakRuleDirection: StreakRuleDirection.Looser,
      }),
    );
    expect(tx.plans).toEqual([[]]);
  });

  it('answers the retry of a withdrawal as it did, though nothing waits any more', async () => {
    const world = waiting();
    const cmd = withdrawOf(2);
    expect(await rig(world).withdraw(cmd)).toEqual(Result.ok({ version: 2 }));
    const written = new Map(world.store);
    const again = rig(world);
    expect(await again.withdraw(cmd)).toEqual(Result.ok({ version: 2 }));
    expect(world.store).toEqual(written);
    expect(again.tx.plans).toEqual([[]]);
  });

  it('takes another intent for what it is: the same act asked anew is decided anew', async () => {
    const world = waiting();
    expect((await rig(world).withdraw(withdrawOf(2))).ok).toBe(true);
    expect(await rig(world).withdraw(withdrawOf(2))).toEqual(
      Result.err(StreakPublishError.stale(2, 0)),
    );
  });

  it('keeps a publish and a withdrawal apart, even under one name', async () => {
    const world = seeded();
    const cmd = publishOf({ graceDays: 10 }, NEXT_WEEK);
    expect((await rig(world).publish(cmd)).ok).toBe(true);
    expect(
      await rig(world).withdraw(withdrawOf(2, { requestId: cmd.requestId })),
    ).toEqual(Result.ok({ version: 2 }));
  });
});

describe('the read set, and the shop’s calendar', () => {
  it('reads the head, this intent’s version, the highest version and the waiting version’s document — nothing else', async () => {
    const { tx, publish } = rig(waiting());
    const cmd = publishOf({ graceDays: 14 }, NEXT_MONTH, { baseVersion: 2 });
    await publish(cmd);
    const [read] = tx.transactions;
    const versions = [
      Collections.StreakDefinitions,
      CADENCE,
      Subcollections.Versions,
    ];
    expect(read?.reads).toEqual([HEAD_PATH, versionPath(2)]);
    expect(read?.queries).toEqual([
      {
        collection: versions,
        where: [{ field: 'requestId', op: QueryOp.Eq, value: cmd.requestId }],
        orderBy: [],
        limit: 1,
      },
      {
        collection: versions,
        where: [],
        orderBy: [{ field: 'version', descending: true }],
        limit: 1,
      },
    ]);
  });

  it('reads a withdrawal’s head, its own audit row and the named version — the row found first stops the read', async () => {
    const world = waiting();
    const cmd = withdrawOf(2);
    const first = rig(world);
    await first.withdraw(cmd);
    expect(first.tx.transactions[0]?.reads).toEqual([
      HEAD_PATH,
      rowPath(AuditAction.LoyaltyStreakDefinitionWithdrawn, cmd.requestId),
      versionPath(2),
    ]);
    const again = rig(world);
    await again.withdraw(cmd);
    expect(again.tx.transactions[0]?.reads).toEqual([
      HEAD_PATH,
      rowPath(AuditAction.LoyaltyStreakDefinitionWithdrawn, cmd.requestId),
    ]);
  });

  it('reads the day off the SHOP’s calendar: half past one at night in Sofia is already tomorrow', async () => {
    // 22:30 UTC on the 28th is 01:30 on the 29th in Sofia.
    const at = utcMs('2026-09-28T22:30:00.000Z');
    const { tx, publish } = rig(seeded(), { now: at });
    // The cue alone may start today, and today is the 29th: in force at once.
    expect(
      await publish(publishOf({ riskLeadDays: 3 }, TOMORROW)),
    ).toMatchObject({ ok: true });
    expect(tx.plans[0]?.[1]).toMatchObject({
      body: {
        rules: [{ version: 2, headRole: 'CURRENT' }],
        updatedAtUtcMs: at,
      },
    });
  });

  it('answers a commit failure as the commit answers it', async () => {
    const world = seeded();
    const { tx } = rig(world);
    const down = RepositoryError.writeFailed(null, 'Error: deadline exceeded');
    const ports: PublishStreakDefinitionPorts = {
      ...tx,
      commit: async () => Result.err(down),
      flagOn: () => false,
      ...ZONE_PORTS,
    };
    expect(
      await publishStreakDefinition(ports)(
        publishOf({ graceDays: 10 }, TOMORROW),
      ),
    ).toEqual(Result.err(down));
    expect(await withdrawStreakDefinition(ports)(withdrawOf(2))).toEqual(
      Result.err(down),
    );
  });

  it('answers a shop day it cannot read as its store failure — after the caller, before any write (4A-2 (e))', async () => {
    const world = seeded();
    const { tx } = rig(world);
    const failed = RepositoryError.readFailed('locations/loc-center', 'down');
    const ports: PublishStreakDefinitionPorts = {
      ...tx,
      flagOn: () => false,
      ...memoryDefaultLocationPorts(),
      loadLocation: async () => Result.err(failed),
    };
    expect(
      await publishStreakDefinition(ports)(
        publishOf({ graceDays: 10 }, TOMORROW),
      ),
    ).toEqual(Result.err(failed));
    expect(await withdrawStreakDefinition(ports)(withdrawOf(2))).toEqual(
      Result.err(failed),
    );
    expect(tx.transactions).toEqual([]);
  });
});
