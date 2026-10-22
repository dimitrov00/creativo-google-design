import type { LoyaltyCatalogMemo } from '@creativo/infrastructure/firebase-app';
import { StreakPublishCall, StreakPublishOutcome } from '@core/components';
import {
  type LocalDate,
  type PipelineError,
  PipelineErrorCode,
  RepositoryError,
  Result,
  type StreakDefinitionId,
  StreakPublishError,
  StreakPublishErrorCode,
} from '@core/primitives';
import { Collections } from '@core/entities';
import {
  Callables,
  type GatewayPorts,
  type StreakPublishGatewayPorts,
} from '@core/ports';

/**
 * The SDK statuses of "you may not": the callable throws the first when
 * nobody is signed in (a session that ended while the draft was open), the
 * platform the second before the callable is reached. Both read as the
 * caller not being the admin pair — the other failure would tell them to
 * try again, which cannot help.
 */
const NOT_ALLOWED_STATUSES: ReadonlySet<string | null> = new Set([
  'unauthenticated',
  'permission-denied',
]);

const pathOf = (streakId: StreakDefinitionId): string =>
  `${Collections.StreakDefinitions}/${streakId}`;

/** An answer that is none the call expects — reporting a write that may not have happened is worse than none. */
const unusable = (path: string, why: string): RepositoryError =>
  RepositoryError.malformed(
    path,
    `${Callables.PublishStreakDefinition} answered nothing usable: ${why}`,
  );

/**
 * A call that came back as a `PipelineError`: the caller not allowed, an
 * answer the call could not use (decoded as nothing usable, no wire status),
 * or a request that got no answer (offline, a timeout, a request the server
 * could not read, a write that fell over) — the failure trying again fixes.
 */
function failureOf(
  error: PipelineError,
  path: string,
): StreakPublishError | RepositoryError {
  if (
    error.serverErrorCode === StreakPublishErrorCode.CallerNotAdmin ||
    NOT_ALLOWED_STATUSES.has(error.wireStatus)
  ) {
    return StreakPublishError.callerNotAdmin();
  }
  return error.wireStatus === null &&
    error.errorCode === PipelineErrorCode.Unknown
    ? unusable(path, 'the answer is none it knows')
    : RepositoryError.writeFailed(path, error.wireStatus);
}

/**
 * THE RHYTHM'S PUBLISH AND WITHDRAWAL through the admin-only callable
 * (flip 3, plan §3.4; client-card-revision-3.md §4.4; Phase 4a §3.10) —
 * composed over the ONE typed callable client (`gateway.callableClient`):
 * the call goes as the `StreakPublishCall` it is, the answer comes back
 * decoded by `StreakPublishCall.decodeAnswer` (`PUBLISHED` / `WITHDRAWN` /
 * `REFUSED`). The frozen wire's locator tables are gone with it.
 *
 * A refusal is an ordinary answer and a `StreakPublishError`, never a
 * throw — rebuilt by `StreakPublishCall.refusalOf` as the web always rebuilt
 * it (a `STALE` restates the version the call named; a `TOO_EARLY` without
 * a day the answer vouches for is the day the publish asked for). A request
 * that got no answer is a `RepositoryError` — the OTHER failure, the one
 * trying again fixes — and so is an answer that is none the call expects: a
 * withdrawal answered to a publish, a withdrawal answered for another
 * version or as a publish, a `TOO_EARLY` answered to a withdrawal (which
 * asks no day).
 *
 * After a write that landed and passed those checks — and only then — the
 * session's copy of the catalogue (`memo`, the root
 * `LOYALTY_CATALOG_MEMO`) is dropped, so the next card opened in this
 * session reads the rule that was just published.
 */
export const streakPublishPorts = (
  gateway: GatewayPorts,
  memo: LoyaltyCatalogMemo,
): StreakPublishGatewayPorts => {
  const publish = gateway.callableClient(Callables.PublishStreakDefinition);

  /** A refused answer as the call's own refusal, or a fault when it names none it can carry. */
  const refusedAs = (
    refused: StreakPublishCall.Refused,
    askedVersion: number,
    askedDay: LocalDate | null,
    path: string,
  ): StreakPublishError | RepositoryError =>
    StreakPublishCall.refusalOf(refused, askedVersion, askedDay) ??
    unusable(path, 'a refusal that names no day the call asked');

  return {
    publishStreakRule: async (call) => {
      const path = pathOf(call.streakId);
      const sent = await publish(call);
      if (!sent.ok) return Result.err(failureOf(sent.error, path));
      const answer = sent.value;
      switch (answer.streakPublishOutcome) {
        case StreakPublishOutcome.Published:
          memo.invalidate();
          return Result.ok(
            StreakPublishCall.receipt(
              answer.version,
              answer.effectiveFromLocalDate,
              answer.streakRuleDirection,
            ),
          );
        case StreakPublishOutcome.Refused:
          return Result.err(
            refusedAs(
              answer,
              call.baseVersion,
              call.rule.effectiveFromLocalDate,
              path,
            ),
          );
        case StreakPublishOutcome.Withdrawn:
          return Result.err(
            unusable(path, 'a publish was answered as a withdrawal'),
          );
      }
    },

    withdrawStreakRule: async (call) => {
      const path = pathOf(call.streakId);
      const sent = await publish(call);
      if (!sent.ok) return Result.err(failureOf(sent.error, path));
      const answer = sent.value;
      switch (answer.streakPublishOutcome) {
        case StreakPublishOutcome.Withdrawn:
          if (answer.version !== call.version) {
            return Result.err(
              unusable(path, 'a withdrawal was answered for another version'),
            );
          }
          memo.invalidate();
          return Result.ok(undefined);
        case StreakPublishOutcome.Refused:
          return Result.err(refusedAs(answer, call.version, null, path));
        case StreakPublishOutcome.Published:
          return Result.err(
            unusable(path, 'a withdrawal was answered as a publish'),
          );
      }
    },
  };
};
