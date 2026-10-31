import { describe, expect, it } from 'vitest';
import {
  HeadRole,
  StreakPublishCall,
  StreakRule,
  StreakRuleDirection,
  StreakTransition,
  type StreakHeadRule,
} from '@core/components';
import { PublishRequestId, Result, type LocalDate } from '@core/primitives';
import {
  RepositoryError,
  RepositoryErrorCode,
  type PublishStreakDefinitionError,
  StreakPublishError,
  StreakRuleField,
} from '@core/errors';
import {
  type StreakNoticePolicy,
  StreakPublishSystem,
  type StreakSchedule,
} from '@core/systems';
import {
  localDate,
  memoryStreakPublishGatewayPorts,
  memoryStreakWorld,
  streakDefinitionFixture,
  streakDefinitionVersionFixture,
  utcMs,
} from '@core/testing';
import {
  type PublishRhythmDraftCommand,
  type RhythmPublishPorts,
  publishRhythmDraft,
  withdrawRhythm,
} from './rhythm-publish.pipeline';

/*
 * The admin rhythm page's «Запази» and «Отмени», moved out of
 * `admin-rhythm.store.ts` (`send`, `callOff`): the store's spec cases of
 * the answers (`admin-rhythm.store.spec.ts` «Запази» and «Отмени») restated
 * on the use case — what is judged before anything is sent, what reaches
 * the gateway, and how its answer comes back. The store's own behaviour
 * (intent ids, generation, floor, rebase / adopt) stays pinned by its spec.
 */

const TODAY = localDate('2026-09-28');
const TOMORROW = localDate('2026-09-29');
const NOTICE_DAY = localDate('2026-10-28');
const CADENCE = StreakRule.DEFAULT_DEFINITION_ID;
const REQUEST = PublishRequestId.of('request-000000000001');

/** Nobody sees the rhythm yet: a stricter rule may start tomorrow. */
const QUIET: StreakNoticePolicy = { clientsSeeRhythm: false, noticeDays: 30 };
/** Clients see it: a stricter rule is owed 30 days. */
const SEEN: StreakNoticePolicy = { clientsSeeRhythm: true, noticeDays: 30 };

/** The head the seed opens with: the recommended rule in force, nothing waiting. */
const RECOMMENDED: StreakSchedule = streakDefinitionFixture();

/** The recommended rule in force and version 2 (ten days of grace) waiting for next week. */
const WAITING: StreakSchedule = {
  rules: [
    ...RECOMMENDED.rules,
    {
      ...StreakRule.DEFAULT,
      version: 2,
      effectiveFromLocalDate: localDate('2026-10-05'),
      graceDays: 10,
      headRole: HeadRole.Scheduled,
      streakTransition: StreakTransition.Grandfather,
    } satisfies StreakHeadRule,
  ],
};

/** A «Запази» of `patch` over the rule in force, for `day`, as the page hands it over. */
function command(
  patch: Partial<StreakRule>,
  day: LocalDate = TOMORROW,
  more: {
    readonly published?: boolean;
    readonly policy?: StreakNoticePolicy;
    readonly head?: StreakSchedule;
  } = {},
): PublishRhythmDraftCommand {
  const head = more.head ?? RECOMMENDED;
  const published = more.published ?? true;
  const policy = more.policy ?? QUIET;
  return {
    assessment: StreakPublishSystem.assess(
      head,
      published,
      { ...StreakRule.DEFAULT, ...patch } as StreakRule,
      day,
      TODAY,
      policy,
    ),
    published,
    requestId: REQUEST,
    streakId: CADENCE,
    streakTransition: StreakTransition.Grandfather,
    effectiveFrom: day,
    today: TODAY,
    policy,
  };
}

const LOOSER = { intervalDays: 49 } as Partial<StreakRule>;
const STRICTER = { intervalDays: 35 } as Partial<StreakRule>;
const NEUTRAL: Partial<StreakRule> = { riskLeadDays: 3 };

/**
 * The gateway as plain closures: every call kept, each answered as scripted
 * (by default a receipt for the rule sent, and a withdrawal that landed).
 */
function gateway(
  script: {
    readonly publish?: () => Promise<
      Result<StreakPublishCall.Receipt, PublishStreakDefinitionError>
    >;
    readonly withdraw?: () => Promise<
      Result<void, PublishStreakDefinitionError>
    >;
  } = {},
) {
  const published: StreakPublishCall[] = [];
  const withdrawn: StreakPublishCall.Withdraw[] = [];
  const ports: RhythmPublishPorts = {
    publishStreakRule: (call) => {
      published.push(call);
      return script.publish !== undefined
        ? script.publish()
        : Promise.resolve(
            Result.ok(
              StreakPublishCall.receipt(
                call.rule.version,
                call.rule.effectiveFromLocalDate,
                StreakRuleDirection.Looser,
              ),
            ),
          );
    },
    withdrawStreakRule: (call) => {
      withdrawn.push(call);
      return script.withdraw !== undefined
        ? script.withdraw()
        : Promise.resolve(Result.ok(undefined));
    },
  };
  return { ports, published, withdrawn };
}

describe('publishRhythmDraft — «Запази»', () => {
  it('sends the draft as the next version, and answers the receipt of a version that waits', async () => {
    const rig = gateway();

    const outcome = await publishRhythmDraft(rig.ports)(command(LOOSER));

    expect(outcome).toEqual(
      Result.ok({
        version: 2,
        effectiveFromLocalDate: TOMORROW,
        streakRuleDirection: StreakRuleDirection.Looser,
        waits: true,
      }),
    );
    expect(rig.published).toHaveLength(1);
    expect(rig.published[0]).toMatchObject({
      requestId: REQUEST,
      streakId: CADENCE,
      baseVersion: 1,
      streakTransition: StreakTransition.Grandfather,
      previewHash: null,
    });
    expect(rig.published[0]?.rule).toMatchObject({
      version: 2,
      effectiveFromLocalDate: TOMORROW,
      intervalDays: 49,
    });
  });

  it('answers a version in force today as one that does not wait', async () => {
    const rig = gateway();

    const outcome = await publishRhythmDraft(rig.ports)(
      command(NEUTRAL, TODAY),
    );

    expect(outcome.ok && outcome.value).toMatchObject({
      effectiveFromLocalDate: TODAY,
      waits: false,
    });
  });

  it('bases the draft on what waits', async () => {
    const rig = gateway();

    await publishRhythmDraft(rig.ports)(
      command(STRICTER, localDate('2026-10-12'), { head: WAITING }),
    );

    expect(rig.published[0]).toMatchObject({ baseVersion: 2 });
    expect(rig.published[0]?.rule.version).toBe(3);
  });

  it('publishes a shop’s first rule as recommended, on nothing', async () => {
    const rig = gateway();

    const outcome = await publishRhythmDraft(rig.ports)(
      command({}, TOMORROW, { published: false }),
    );

    expect(outcome).toMatchObject({ ok: true, value: { version: 1 } });
    expect(rig.published[0]).toMatchObject({ baseVersion: 0 });
  });

  it('sends nothing for a form that was not touched', async () => {
    const rig = gateway();

    const outcome = await publishRhythmDraft(rig.ports)(command({}));

    expect(outcome).toEqual(Result.ok(null));
    expect(rig.published).toEqual([]);
  });

  it('sends nothing for a draft that is no rule, and names its fields', async () => {
    const rig = gateway();

    const outcome = await publishRhythmDraft(rig.ports)(
      command({ graceDays: 99 }),
    );

    expect(outcome).toEqual(
      Result.err(StreakPublishError.invalid([StreakRuleField.GraceDays])),
    );
    expect(rig.published).toEqual([]);
  });

  it('sends nothing for a day the change may not start on yet', async () => {
    const rig = gateway();

    const outcome = await publishRhythmDraft(rig.ports)(
      command(STRICTER, TOMORROW, { policy: SEEN }),
    );

    expect(outcome).toEqual(
      Result.err(StreakPublishError.tooEarly(TOMORROW, NOTICE_DAY)),
    );
    expect(rig.published).toEqual([]);
  });

  it('offers the strictest day it knows when the server says too early, whatever day the server named', async () => {
    const rig = gateway({
      publish: () =>
        Promise.resolve(
          Result.err(StreakPublishError.tooEarly(TOMORROW, TOMORROW)),
        ),
    });

    const outcome = await publishRhythmDraft(rig.ports)(command(STRICTER));

    expect(outcome).toEqual(
      Result.err(StreakPublishError.tooEarly(TOMORROW, NOTICE_DAY)),
    );
    expect(rig.published).toHaveLength(1);
  });

  it('offers a later day than the one refused for a change that owes no notice', async () => {
    const rig = gateway({
      publish: () =>
        Promise.resolve(
          Result.err(StreakPublishError.tooEarly(TOMORROW, TOMORROW)),
        ),
    });

    const outcome = await publishRhythmDraft(rig.ports)(command(LOOSER));

    expect(outcome).toEqual(
      Result.err(
        StreakPublishError.tooEarly(TOMORROW, localDate('2026-09-30')),
      ),
    );
  });

  it.each([
    StreakPublishError.callerNotAdmin(),
    StreakPublishError.invalid([StreakRuleField.GraceDays]),
    StreakPublishError.stale(1, 2),
    RepositoryError.unavailable(),
  ])('hands on the gateway’s refusal %j as it was said', async (refusal) => {
    const rig = gateway({
      publish: () => Promise.resolve(Result.err(refusal)),
    });

    const outcome = await publishRhythmDraft(rig.ports)(command(LOOSER));

    expect(outcome).toEqual(Result.err(refusal));
  });

  it('answers a port that throws, or rejects, as a save that failed', async () => {
    const throwing: RhythmPublishPorts = {
      ...gateway().ports,
      publishStreakRule: () => {
        throw new Error('no adapter');
      },
    };
    const rejecting = gateway({
      publish: () => Promise.reject(new Error('no adapter')),
    });

    for (const ports of [throwing, rejecting.ports]) {
      const outcome = await publishRhythmDraft(ports)(command(LOOSER));
      expect(outcome).toEqual(
        Result.err(RepositoryError.writeFailed(null, 'threw')),
      );
      expect(!outcome.ok && outcome.error.errorCode).toBe(
        RepositoryErrorCode.WriteFailed,
      );
    }
  });

  it('publishes through the real gateway: version 2 waits for tomorrow', async () => {
    const world = memoryStreakWorld({
      heads: [streakDefinitionFixture()],
      versions: [
        { streakId: CADENCE, version: streakDefinitionVersionFixture() },
      ],
    });
    const ports = memoryStreakPublishGatewayPorts(world, {
      nowUtcMs: () => utcMs('2026-09-28T09:00:00.000Z'),
      policy: QUIET,
    });

    const outcome = await publishRhythmDraft(ports)(command(LOOSER));

    expect(outcome).toEqual(
      Result.ok({
        version: 2,
        effectiveFromLocalDate: TOMORROW,
        streakRuleDirection: StreakRuleDirection.Looser,
        waits: true,
      }),
    );
  });
});

describe('withdrawRhythm — «Отмени»', () => {
  const withdrawal = (head: StreakSchedule, published = true) => ({
    head,
    published,
    requestId: REQUEST,
    streakId: CADENCE,
    today: TODAY,
  });

  it('calls off the version that waits, by its own number', async () => {
    const rig = gateway();

    const outcome = await withdrawRhythm(rig.ports)(withdrawal(WAITING));

    expect(outcome).toEqual(Result.ok(2));
    expect(rig.withdrawn).toEqual([
      StreakPublishCall.withdraw(REQUEST, CADENCE, 2),
    ]);
  });

  it('sends nothing when nothing waits, nor before the shop has published', async () => {
    const rig = gateway();

    await expect(
      withdrawRhythm(rig.ports)(withdrawal(RECOMMENDED)),
    ).resolves.toEqual(Result.ok(null));
    await expect(
      withdrawRhythm(rig.ports)(withdrawal(WAITING, false)),
    ).resolves.toEqual(Result.ok(null));
    expect(rig.withdrawn).toEqual([]);
  });

  it('hands on the server’s refusal', async () => {
    const stale = StreakPublishError.stale(2, 0);
    const rig = gateway({ withdraw: () => Promise.resolve(Result.err(stale)) });

    await expect(
      withdrawRhythm(rig.ports)(withdrawal(WAITING)),
    ).resolves.toEqual(Result.err(stale));
  });

  it('answers a port that throws, or rejects, as an «Отмени» that failed', async () => {
    const throwing: RhythmPublishPorts = {
      ...gateway().ports,
      withdrawStreakRule: () => {
        throw new Error('no adapter');
      },
    };
    const rejecting = gateway({
      withdraw: () => Promise.reject(new Error('no adapter')),
    });

    for (const ports of [throwing, rejecting.ports]) {
      await expect(withdrawRhythm(ports)(withdrawal(WAITING))).resolves.toEqual(
        Result.err(RepositoryError.writeFailed(null, 'threw')),
      );
    }
  });
});
