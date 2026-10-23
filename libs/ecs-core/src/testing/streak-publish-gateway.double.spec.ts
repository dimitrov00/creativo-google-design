import { describe, expect, it } from 'vitest';
import { firstValueFrom } from 'rxjs';
import { skip, take, toArray } from 'rxjs/operators';
import {
  HeadRole,
  type StreakPublishCall,
  StreakRule,
  StreakRuleDirection,
  StreakTransition,
} from '@core/components';
import {
  PublishRequestId,
  Result,
  StreakDefinitionVersionId,
} from '@core/primitives';
import { RepositoryError, StreakPublishError } from '@core/errors';
import { Collections, Subcollections } from '@core/entities';
import {
  GATEWAY_ADMIN,
  memoryStreakPublishGatewayPorts,
} from './streak-publish-gateway.double';
import { memoryStreakDefinitionPorts, memoryStreakWorld } from './port-doubles';
import {
  streakDefinitionFixture,
  streakDefinitionVersionFixture,
} from './loyalty.fixtures';
import { localDate, pinnedNowUtcMs, utcMs } from './test-support';

/*
 * The admin page's gateway double (successor of the legacy in-memory
 * streak repository): a thin closure over the REAL publish pipeline, on the
 * world the head stream reads. Its contract: a call becomes an admin's
 * command, the pipeline's answer comes back as it is, the head stream hears
 * of a landed act, and `refuse`/`fail` script the rest.
 */

const CADENCE = StreakRule.DEFAULT_DEFINITION_ID;
const NEXT_WEEK = localDate('2026-10-05');
const NEXT_MONTH = localDate('2026-10-28');
const TOMORROW = localDate('2026-09-29');
const NOW = utcMs('2026-09-28T09:00:00.000+03:00');

function seeded() {
  return memoryStreakWorld({
    heads: [streakDefinitionFixture()],
    versions: [
      { streakId: CADENCE, version: streakDefinitionVersionFixture() },
    ],
  });
}

let intents = 0;
const nextIntent = (): PublishRequestId =>
  PublishRequestId.of(`intent-${String((intents += 1)).padStart(12, '0')}`);

/** The page's call: the recommended rule with `patch` over it, as the next version, on `day`. */
function callOf(
  patch: Partial<StreakRule>,
  day: string,
  over: Partial<StreakPublishCall> = {},
): StreakPublishCall {
  const rule = StreakRule.parse({
    ...StreakRule.DEFAULT,
    ...patch,
    version: 2,
    effectiveFromLocalDate: day,
  } as StreakRule);
  if (!rule.ok) throw new Error('a broken fixture rule');
  return {
    requestId: nextIntent(),
    streakId: CADENCE,
    baseVersion: 1,
    rule: rule.value,
    streakTransition: StreakTransition.Grandfather,
    previewHash: null,
    ...over,
  };
}

const versionKey = (version: number): string =>
  [
    Collections.StreakDefinitions,
    CADENCE,
    Subcollections.Versions,
    StreakDefinitionVersionId.forVersion(version),
  ].join('/');

describe('memoryStreakPublishGatewayPorts', () => {
  it('publishes through the pipeline as the shop’s admin: the receipt, the version signed by them', async () => {
    const world = seeded();
    const gateway = memoryStreakPublishGatewayPorts(world, {
      nowUtcMs: pinnedNowUtcMs(NOW),
    });
    expect(
      await gateway.publishStreakRule(callOf({ graceDays: 10 }, NEXT_WEEK)),
    ).toEqual(
      Result.ok({
        version: 2,
        effectiveFromLocalDate: NEXT_WEEK,
        streakRuleDirection: StreakRuleDirection.Looser,
      }),
    );
    expect(world.store.get(versionKey(2))).toMatchObject({
      graceDays: 10,
      publishedByUserId: GATEWAY_ADMIN,
      publishedAtUtcMs: NOW,
    });
  });

  it('lets the head stream hear of a landed publish and a withdrawal — the page observes what it sent', async () => {
    const world = seeded();
    const reads = memoryStreakDefinitionPorts(world);
    const gateway = memoryStreakPublishGatewayPorts(world);
    const heads = firstValueFrom(
      reads
        .observeStreakDefinitionHead(CADENCE)
        .pipe(skip(1), take(2), toArray()),
    );
    await gateway.publishStreakRule(callOf({ graceDays: 10 }, NEXT_WEEK));
    expect(
      await gateway.withdrawStreakRule({
        requestId: nextIntent(),
        streakId: CADENCE,
        version: 2,
      }),
    ).toEqual(Result.ok(undefined));
    const [published, withdrawn] = await heads;
    expect(published).toMatchObject({
      ok: true,
      value: {
        rules: [
          { version: 1, headRole: HeadRole.Current },
          { version: 2, headRole: HeadRole.Scheduled },
        ],
      },
    });
    expect(withdrawn).toMatchObject({
      ok: true,
      value: { rules: [{ version: 1, headRole: HeadRole.Current }] },
    });
    expect(world.store.get(versionKey(2))).toMatchObject({
      withdrawnAtUtcMs: expect.any(Number),
    });
  });

  it('answers the pipeline’s refusal as it is, and writes nothing', async () => {
    const world = seeded();
    const before = new Map(world.store);
    const gateway = memoryStreakPublishGatewayPorts(world);
    expect(
      await gateway.publishStreakRule(
        callOf({ graceDays: 10 }, NEXT_WEEK, { baseVersion: 4 }),
      ),
    ).toEqual(Result.err(StreakPublishError.stale(4, 1)));
    expect(
      await gateway.withdrawStreakRule({
        requestId: nextIntent(),
        streakId: CADENCE,
        version: 2,
      }),
    ).toEqual(Result.err(StreakPublishError.stale(2, 0)));
    expect(world.store).toEqual(before);
  });

  it('answers a retry of the same intent with the original receipt, and writes nothing twice', async () => {
    const world = seeded();
    const gateway = memoryStreakPublishGatewayPorts(world);
    const call = callOf({ graceDays: 10 }, NEXT_WEEK);
    const first = await gateway.publishStreakRule(call);
    const written = new Map(world.store);
    expect(await gateway.publishStreakRule(call)).toEqual(first);
    expect(world.store).toEqual(written);
  });

  it('holds a stricter rule to the server’s notice once clients see the rhythm', async () => {
    const quiet = memoryStreakPublishGatewayPorts(seeded());
    expect(
      (await quiet.publishStreakRule(callOf({ graceDays: 3 }, TOMORROW))).ok,
    ).toBe(true);
    const seen = memoryStreakPublishGatewayPorts(seeded(), {
      policy: {
        clientsSeeRhythm: true,
        noticeDays: StreakRule.RULE_CHANGE_NOTICE_DAYS,
      },
    });
    expect(
      await seen.publishStreakRule(callOf({ graceDays: 3 }, TOMORROW)),
    ).toEqual(Result.err(StreakPublishError.tooEarly(TOMORROW, NEXT_MONTH)));
    expect(() =>
      memoryStreakPublishGatewayPorts(seeded(), {
        policy: { clientsSeeRhythm: true, noticeDays: 7 },
      }),
    ).toThrow(/notice/);
  });

  it('scripts a refusal or a failure for every call, touching nothing', async () => {
    const world = seeded();
    const before = new Map(world.store);
    const refusing = memoryStreakPublishGatewayPorts(world, {
      refuse: StreakPublishError.callerNotAdmin(),
    });
    expect(
      await refusing.publishStreakRule(callOf({ graceDays: 10 }, NEXT_WEEK)),
    ).toEqual(Result.err(StreakPublishError.callerNotAdmin()));
    const failing = memoryStreakPublishGatewayPorts(world, {
      fail: RepositoryError.unavailable(),
    });
    expect(
      await failing.withdrawStreakRule({
        requestId: nextIntent(),
        streakId: CADENCE,
        version: 2,
      }),
    ).toEqual(Result.err(RepositoryError.unavailable()));
    expect(world.store).toEqual(before);
  });
});
