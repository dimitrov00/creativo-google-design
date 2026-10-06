import { type Observable, map } from 'rxjs';
import { type Result, fail, ok } from '@creativo/domain/kernel';
import {
  StreakDefinition,
  StreakDefinitionSchedule,
} from '@creativo/domain/engagement';
import { RepositoryError } from '@creativo/application/shared';
import type {
  StreakDefinitionRepository,
  StreakDefinitionVersion,
} from '../ports/streak-definition.port';

/** The rule as its editor opens it. */
export interface ObservedStreakDefinition {
  /**
   * The head: the rule in force and the one that waits. Where the shop
   * has published none, the RECOMMENDED rule, with nothing waiting.
   */
  readonly schedule: StreakDefinitionSchedule;
  /**
   * `false`: nothing is published yet and `schedule` is the
   * recommendation. The first publish then has nothing to be stale
   * against (`baseVersion` 0) and is numbered 1.
   */
  readonly published: boolean;
}

/** How much of the history the editor lists unless told otherwise. */
export const STREAK_HISTORY_LIMIT = 20;

/**
 * The rule, for the page that edits it (client-card-revision-3.md §4.4):
 * the head as a live stream, and its history on request.
 *
 * What it adds to the port is the EMPTY case. A shop that never published
 * a rule has no document, and its editor must still open on something:
 * the recommended rule (`StreakDefinition.default()`), said to be
 * unpublished, so the page can word it («Още няма правило») and the first
 * «Запази» publishes version 1.
 */
export class ObserveStreakDefinitionUseCase {
  constructor(private readonly definitions: StreakDefinitionRepository) {}

  execute(
    streakId: string,
  ): Observable<Result<ObservedStreakDefinition, RepositoryError>> {
    return this.definitions
      .observe(streakId)
      .pipe(map((head) => observedOf(streakId, head)));
  }

  /** The rule's versions, newest first: what «История» lists. */
  history(
    streakId: string,
    limit: number = STREAK_HISTORY_LIMIT,
  ): Promise<Result<readonly StreakDefinitionVersion[], RepositoryError>> {
    return this.definitions.listVersions(
      streakId,
      Math.max(1, Math.floor(limit)),
    );
  }
}

function observedOf(
  streakId: string,
  head: Result<StreakDefinitionSchedule | null, RepositoryError>,
): Result<ObservedStreakDefinition, RepositoryError> {
  if (head.isFailure()) return fail(head.error);
  if (head.value !== null) {
    return ok({ schedule: head.value, published: true });
  }
  const recommended = recommendedFor(streakId);
  return recommended.isFailure()
    ? fail(recommended.error)
    : ok({ schedule: recommended.value, published: false });
}

/** The recommended rule under this id, as a head with nothing waiting. */
function recommendedFor(
  streakId: string,
): Result<StreakDefinitionSchedule, RepositoryError> {
  const recommended = StreakDefinition.default();
  const current =
    streakId === recommended.id
      ? ok<StreakDefinition, never>(recommended)
      : StreakDefinition.create({ ...recommended.toProps(), id: streakId });
  if (current.isFailure()) {
    return fail(
      new RepositoryError(
        `No rhythm rule can be named "${streakId}"`,
        current.error,
      ),
    );
  }
  const schedule = StreakDefinitionSchedule.create({
    current: current.value,
    scheduled: null,
  });
  // Unreachable: a head with nothing waiting has nothing to be refused for.
  return schedule.isFailure()
    ? fail(
        new RepositoryError('Unreachable: an empty schedule', schedule.error),
      )
    : ok(schedule.value);
}
