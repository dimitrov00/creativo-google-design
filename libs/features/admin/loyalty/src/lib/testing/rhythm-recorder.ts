import { BehaviorSubject, Observable, combineLatest } from 'rxjs';
import { map } from 'rxjs/operators';
import type { StreakPublishCall } from '@core/components';
import type { StreakDefinition } from '@core/entities';
import type {
  StreakDefinitionPorts,
  StreakPublishGatewayPorts,
} from '@core/ports';
import { Result, type StreakDefinitionId } from '@core/primitives';
import { RepositoryError, type StreakPublishError } from '@core/errors';

/*
 * THE RHYTHM'S TWO BUNDLES, RECORDED AND HELD — test support for the admin
 * page's specs (the store, the page, its sheets), never imported by the
 * page itself. It wraps a `StreakDefinitionPorts` and a
 * `StreakPublishGatewayPorts` (the `@core/testing` doubles: the head over a
 * `StreakWorld`, the gateway over the real publish pipeline) and adds what
 * a page spec plays with: what was asked, holds that let either order the
 * real adapters answer in be played (the head before a write's answer, or
 * after it), a failure and a scripted refusal switched on and off, and the
 * head said again (the server's day moved). It decides nothing itself:
 * every answer that is not scripted is the wrapped double's.
 */

/** The rhythm's bundles behind a recorder; `ports` is what a spec binds to both tokens. */
export type RhythmRecorder = {
  /** `STREAK_DEFINITION_PORTS` and `STREAK_PUBLISH_PORTS`, one object (a spec may spy on a member). */
  readonly ports: StreakDefinitionPorts & StreakPublishGatewayPorts;
  /** Every publish the page sent, in order — scripted or held ones included. */
  readonly published: StreakPublishCall[];
  /** Every withdrawal the page sent, in order. */
  readonly withdrawn: StreakPublishCall.Withdraw[];
  /** Every head stream the page opened. */
  readonly observations: StreakDefinitionId[];
  /** Every head (or failure) a stream said, held ones included — what the page was told, however often. */
  readonly heard: StreakDefinitionId[];
  /** Every history read the page made. */
  readonly historyReads: StreakDefinitionId[];
  /** Heads wait here until `tellHeads()`. */
  readonly holdHeads: () => RhythmRecorder;
  readonly tellHeads: () => void;
  /** Writes wait here, unanswered, until `answerWrites()`. */
  readonly holdWrites: () => RhythmRecorder;
  readonly answerWrites: () => void;
  /** Every read and write fails with this error until `recover()`; every watcher hears it. */
  readonly failWith: (error?: RepositoryError) => RhythmRecorder;
  /** Every write is refused so until `recover()`; reads go on answering. */
  readonly refuseWith: (refusal: StreakPublishError) => RhythmRecorder;
  /** Neither failure nor refusal; every watcher hears the head again. */
  readonly recover: () => RhythmRecorder;
  /** Every watcher hears the head again (the server's day moved, nothing was written). */
  readonly tell: () => void;
};

export function rhythmRecorder(
  reads: StreakDefinitionPorts,
  gateway: StreakPublishGatewayPorts,
): RhythmRecorder {
  const told = new BehaviorSubject(0);
  const heldHeads: (() => void)[] = [];
  let holdingHeads = false;
  let gate: Promise<void> | null = null;
  let open: (() => void) | null = null;
  let failure: RepositoryError | null = null;
  let refusal: StreakPublishError | null = null;

  const unable = (): StreakPublishError | RepositoryError | null =>
    failure ?? refusal;

  const recorder: RhythmRecorder = {
    published: [],
    withdrawn: [],
    observations: [],
    heard: [],
    historyReads: [],
    ports: {
      observeStreakDefinitionHead: (id) => {
        recorder.observations.push(id);
        return new Observable<Result<StreakDefinition | null, RepositoryError>>(
          (subscriber) => {
            const inner = combineLatest([
              reads.observeStreakDefinitionHead(id),
              told,
            ])
              .pipe(
                map(([head]) => {
                  recorder.heard.push(id);
                  return failure === null ? head : Result.err(failure);
                }),
              )
              .subscribe((head) => {
                if (holdingHeads) heldHeads.push(() => subscriber.next(head));
                else subscriber.next(head);
              });
            return () => inner.unsubscribe();
          },
        );
      },
      listStreakDefinitionVersions: async (id, limit) => {
        recorder.historyReads.push(id);
        if (failure !== null) return Result.err(failure);
        return reads.listStreakDefinitionVersions(id, limit);
      },
      publishStreakRule: async (call) => {
        recorder.published.push(call);
        if (gate !== null) await gate;
        const scripted = unable();
        if (scripted !== null) return Result.err(scripted);
        return gateway.publishStreakRule(call);
      },
      withdrawStreakRule: async (call) => {
        recorder.withdrawn.push(call);
        if (gate !== null) await gate;
        const scripted = unable();
        if (scripted !== null) return Result.err(scripted);
        return gateway.withdrawStreakRule(call);
      },
    },
    holdHeads: () => {
      holdingHeads = true;
      return recorder;
    },
    tellHeads: () => {
      holdingHeads = false;
      for (const tell of heldHeads.splice(0)) tell();
    },
    holdWrites: () => {
      gate = new Promise((resolve) => {
        open = resolve;
      });
      return recorder;
    },
    answerWrites: () => {
      open?.();
      gate = null;
      open = null;
    },
    failWith: (error = RepositoryError.unavailable()) => {
      failure = error;
      told.next(told.value + 1);
      return recorder;
    },
    refuseWith: (scripted) => {
      refusal = scripted;
      return recorder;
    },
    recover: () => {
      failure = null;
      refusal = null;
      told.next(told.value + 1);
      return recorder;
    },
    tell: () => told.next(told.value + 1),
  };
  return recorder;
}
