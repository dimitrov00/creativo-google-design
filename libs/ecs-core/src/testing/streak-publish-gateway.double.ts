import { Actor, FlagName, StreakRule } from '@core/components';
import { Result, UserId } from '@core/primitives';
import { type RepositoryError, type StreakPublishError } from '@core/errors';
import type { NowUtcMs, StreakPublishGatewayPorts } from '@core/ports';
import type { StreakNoticePolicy } from '@core/systems';
import {
  type PublishStreakDefinitionPorts,
  publishStreakDefinition,
  withdrawStreakDefinition,
} from '@core/pipelines';
import { locationFixture } from './booking-core.fixtures';
import {
  memoryDefaultLocationPorts,
  memoryLocationLoadPorts,
  memoryProgramsWorld,
  type StreakWorld,
} from './port-doubles';
import { fixtureHash, memoryTxPorts, pinnedNowUtcMs } from './test-support';

/** The admin who sends every call the double carries — the dev shop's owner. */
export const GATEWAY_ADMIN: UserId = UserId.of('dev-staff-ivan');

/** How a {@link memoryStreakPublishGatewayPorts} answers — every part optional. */
export type StreakPublishGatewayOptions = {
  /** The server's clock (default: the fixtures' pinned instant). */
  readonly nowUtcMs?: NowUtcMs;
  /**
   * Whether clients see the rhythm — the `loyalty.selfView` flag the server
   * reads (default: they do not). The notice itself is the server's one
   * constant, `StreakRule.RULE_CHANGE_NOTICE_DAYS`.
   */
  readonly policy?: StreakNoticePolicy;
  /** Every call is refused in these words, and nothing is written. */
  readonly refuse?: StreakPublishError | null;
  /** Every call fails as a request that got no answer, and nothing is written. */
  readonly fail?: RepositoryError | null;
};

/**
 * `STREAK_PUBLISH_PORTS` over a {@link StreakWorld} — the admin page's
 * gateway, run over the REAL `publishStreakDefinition` /
 * `withdrawStreakDefinition` of `@core/pipelines` (the callable's own
 * decision order: the page's specs exercise what the server decides), on
 * the in-memory commit over the world's store (`memoryTxPorts`, the
 * fixtures' hash), the fixture shop as the default location (its zone the
 * shop day's, F-4) and the flag the policy names. A THIN
 * closure: it translates a `StreakPublishCall` into the command an admin's
 * request decodes to — the rule as the draft, its own day as the day asked
 * — and the pipeline's answer back, then tells the head streams the store
 * moved (`world.changed()`, after a call that answered). It decides nothing
 * of its own; `refuse`/`fail` script a refusal or a failure instead.
 */
export function memoryStreakPublishGatewayPorts(
  world: StreakWorld,
  options: StreakPublishGatewayOptions = {},
): StreakPublishGatewayPorts {
  const policy = options.policy ?? {
    clientsSeeRhythm: false,
    noticeDays: StreakRule.RULE_CHANGE_NOTICE_DAYS,
  };
  if (policy.noticeDays !== StreakRule.RULE_CHANGE_NOTICE_DAYS) {
    throw new Error(
      `the server's notice is ${StreakRule.RULE_CHANGE_NOTICE_DAYS} days, not ${policy.noticeDays}`,
    );
  }
  const tx = memoryTxPorts(world.store, {
    nowUtcMs: options.nowUtcMs ?? pinnedNowUtcMs(),
    hash: fixtureHash,
  });
  const ports: PublishStreakDefinitionPorts = {
    commit: tx.commit,
    nowUtcMs: tx.nowUtcMs,
    hash: tx.hash,
    flagOn: (key) =>
      key === FlagName.LoyaltySelfView && policy.clientsSeeRhythm,
    ...memoryLocationLoadPorts(
      memoryProgramsWorld({ locations: [locationFixture()] }),
    ),
    ...memoryDefaultLocationPorts(),
  };
  const caller = {
    callerUserId: GATEWAY_ADMIN,
    callerIsAdmin: true,
    callerActor: Actor.forCaller(GATEWAY_ADMIN, ['admin']),
  } as const;
  const scripted = (): Result<
    never,
    StreakPublishError | RepositoryError
  > | null => {
    if (options.fail !== undefined && options.fail !== null) {
      return Result.err(options.fail);
    }
    if (options.refuse !== undefined && options.refuse !== null) {
      return Result.err(options.refuse);
    }
    return null;
  };
  return {
    publishStreakRule: async (call) => {
      const script = scripted();
      if (script !== null) return script;
      const answered = await publishStreakDefinition(ports)({
        ...caller,
        requestId: call.requestId,
        streakId: call.streakId,
        baseVersion: call.baseVersion,
        draft: Result.ok(call.rule),
        effectiveFrom: call.rule.effectiveFromLocalDate,
        streakTransition: call.streakTransition,
        previewHash: call.previewHash,
      });
      if (answered.ok) world.changed();
      return answered;
    },
    withdrawStreakRule: async (call) => {
      const script = scripted();
      if (script !== null) return script;
      const answered = await withdrawStreakDefinition(ports)({
        ...caller,
        requestId: call.requestId,
        streakId: call.streakId,
        version: call.version,
      });
      if (!answered.ok) return answered;
      world.changed();
      return Result.ok(undefined);
    },
  };
}
