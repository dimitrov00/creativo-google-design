import {
  type LocalDate,
  type PublishRequestId,
  Result,
  type StreakDefinitionId,
} from '@core/primitives';
import {
  RepositoryError,
  StreakPublishError,
  StreakPublishErrorCode,
} from '@core/errors';
import { StreakPublishCall, type StreakTransition } from '@core/components';
import type { StreakPublishGatewayPorts } from '@core/ports';
import {
  type StreakDraftAssessment,
  type StreakNoticePolicy,
  StreakPublishSystem,
  type StreakSchedule,
} from '@core/systems';

/*
 * THE ADMIN'S «ЗАПАЗИ» AND «ОТМЕНИ» (client-card revision 3 §2.6.4, §4.4) —
 * the browser use cases of the rhythm page, moved out of its store (Law
 * 8.4): read nothing (the page holds the head and the draft), decide
 * (`StreakPublishSystem.gate` / `waitingOn`), call the gateway, and answer
 * in the page's terms. Never throws: a port that throws is a request that
 * got no answer (`RepositoryError.writeFailed(null, 'threw')`). What stays
 * the store's: the intent ids, the generation, the floor, rebase / adopt
 * and settling the head the stream says.
 */

/** The gateway the two acts call — the bundle `STREAK_PUBLISH_PORTS` binds (Law 9). */
export type RhythmPublishPorts = StreakPublishGatewayPorts;

/**
 * A «Запази», as the page hands it over: the draft ASSESSED FOR THE DAY IT
 * IS TO BE PUBLISHED ON (`StreakPublishSystem.assess` with `effectiveFrom`
 * — the page's second assessment, so the overnight too-early guard is
 * judged on the day sent), whether the shop has published, the intent's
 * id, the rule's id, what the version does to the runs, that day, the
 * shop's today and the notice policy.
 */
export type PublishRhythmDraftCommand = {
  readonly assessment: StreakDraftAssessment;
  readonly published: boolean;
  readonly requestId: PublishRequestId;
  readonly streakId: StreakDefinitionId;
  readonly streakTransition: StreakTransition;
  readonly effectiveFrom: LocalDate;
  readonly today: LocalDate;
  readonly policy: StreakNoticePolicy;
};

/** A «Запази» that landed: the server's receipt, and whether its day is still to come (it can then be called off). */
export type RhythmDraftReceipt = StreakPublishCall.Receipt & {
  readonly waits: boolean;
};

/**
 * A «Запази» or an «Отмени» that did not land: the server's (or the page's
 * own) `StreakPublishError`, or a request that got no answer
 * (`RepositoryError`).
 */
export type RhythmPublishRefusal = StreakPublishError | RepositoryError;

/** What became of a «Запази»: the receipt; `null` when there was nothing to publish; or the refusal. */
export type RhythmPublishOutcome = Result<
  RhythmDraftReceipt | null,
  RhythmPublishRefusal
>;

/** An «Отмени», as the page hands it over: the head it stands on, whether the shop has published, the intent's id, the rule's id and the shop's today. */
export type WithdrawRhythmCommand = {
  readonly head: StreakSchedule;
  readonly published: boolean;
  readonly requestId: PublishRequestId;
  readonly streakId: StreakDefinitionId;
  readonly today: LocalDate;
};

/** What became of an «Отмени»: the version called off; `null` when nothing waits; or the refusal. */
export type RhythmWithdrawOutcome = Result<number | null, RhythmPublishRefusal>;

/**
 * «Запази»: the draft judged first (`StreakPublishSystem.gate` — no rule,
 * nothing to publish, a day too early: nothing is sent), else the publish
 * call and its answer — a receipt that says whether its day is still to
 * come; a refusal as the server said it, except `TOO_EARLY`, whose day the
 * page re-derives (`StreakPublishSystem.refusedEarliest`: the strictest
 * day the domain knows for this change, and always a later one than the
 * day refused), whatever day the server named.
 */
export const publishRhythmDraft =
  (ports: RhythmPublishPorts) =>
  async (command: PublishRhythmDraftCommand): Promise<RhythmPublishOutcome> => {
    const gated = StreakPublishSystem.gate(
      command.assessment,
      command.published,
      command.effectiveFrom,
    );
    if (!gated.ok) return gated;
    const draft = gated.value;
    if (draft === null) return Result.ok(null);
    let sent: Result<StreakPublishCall.Receipt, RhythmPublishRefusal>;
    try {
      sent = await ports.publishStreakRule({
        requestId: command.requestId,
        streakId: command.streakId,
        baseVersion: draft.baseVersion,
        rule: draft.rule,
        streakTransition: command.streakTransition,
        previewHash: null,
      });
    } catch {
      sent = Result.err(RepositoryError.writeFailed(null, 'threw'));
    }
    if (sent.ok) {
      return Result.ok({
        ...sent.value,
        waits: StreakPublishSystem.waits(sent.value, command.today),
      });
    }
    if (sent.error.errorCode !== StreakPublishErrorCode.TooEarly) return sent;
    return Result.err(
      StreakPublishError.tooEarly(
        command.effectiveFrom,
        StreakPublishSystem.refusedEarliest(
          draft.change.direction,
          command.effectiveFrom,
          command.today,
          command.policy,
        ),
      ),
    );
  };

/**
 * «Отмени»: the version that waits on `today` (`StreakPublishSystem.
 * waitingOn`) is called off by its own number; nothing is sent when
 * nothing waits. Answers the version called off, or the refusal as the
 * server said it.
 */
export const withdrawRhythm =
  (ports: RhythmPublishPorts) =>
  async (command: WithdrawRhythmCommand): Promise<RhythmWithdrawOutcome> => {
    const waiting = StreakPublishSystem.waitingOn(
      command.head,
      command.published,
      command.today,
    );
    if (waiting === null) return Result.ok(null);
    const { version } = waiting;
    let sent: Result<void, RhythmPublishRefusal>;
    try {
      sent = await ports.withdrawStreakRule(
        StreakPublishCall.withdraw(
          command.requestId,
          command.streakId,
          version,
        ),
      );
    } catch {
      sent = Result.err(RepositoryError.writeFailed(null, 'threw'));
    }
    return sent.ok ? Result.ok(version) : sent;
  };
