import { InjectionToken } from '@angular/core';
import type { Observable } from 'rxjs';
import { DomainError, type Result } from '@creativo/domain/kernel';
import type {
  IsoDate,
  StreakDefinition,
  StreakDefinitionSchedule,
  StreakRuleDirection,
  StreakTransition,
} from '@creativo/domain/engagement';
import { RepositoryError } from '@creativo/application/shared';
import type { StreakDefinitionVersionRecord } from './loyalty-document';

/**
 * One published version of the rule and how it came to be: what the
 * admin's «История» lists. The shape is the wire mapper's
 * (`streakDefinitionVersionFromDocument`); this is the name the port and
 * the features know it by.
 */
export type StreakDefinitionVersion = StreakDefinitionVersionRecord;

/**
 * A publish, as the application asks for it: the next version of the rule
 * as a VALIDATED model, never a bag of fields. The adapter turns it into
 * the callable's request (`streakDefinitionToDocument(definition)` is its
 * `draft`, `definition.id` its `streakId`, `definition.effectiveFrom` its
 * `effectiveFrom`).
 */
export interface PublishStreakDefinition {
  /**
   * One per INTENT, kept across retries of it: a retry whose first attempt
   * was written answers as that attempt did and writes nothing.
   */
  readonly requestId: string;
  /**
   * The newest version the head held when the draft was made: the one that
   * waits, or else the one in force; `0` when the shop has published none.
   * A head that moved since is refused (`stale`), never overwritten.
   */
  readonly baseVersion: number;
  /**
   * The rule proposed, effective on its own `effectiveFrom` and numbered
   * `baseVersion + 1`. The number is a PROPOSAL: the writer numbers the
   * version it writes, one above the highest ever written (after a
   * withdrawal that is more than `baseVersion + 1`), and the answer says
   * which number it got.
   */
  readonly definition: StreakDefinition;
  /** What the new rule does to the runs that exist. */
  readonly transition: StreakTransition;
  /** The exact preview this publish was confirmed on; `null` until the server has one. */
  readonly previewHash: string | null;
}

/** What was written. */
export interface PublishedStreakDefinition {
  /** The number the writer gave the version. */
  readonly version: number;
  /** The first Europe/Sofia day the version judges by. */
  readonly effectiveFrom: IsoDate;
  /** Whom the change favours, as the SERVER classed it. */
  readonly direction: StreakRuleDirection;
}

/**
 * Why the server would not write, in its own six words:
 *
 * - `notAdmin`: the caller is neither `admin` nor `sysadmin`;
 * - `invalid`: the draft is no rule (`fields` names what is wrong);
 * - `stale`: the head moved since `baseVersion` was read, or the version
 *   to withdraw no longer waits;
 * - `tooEarly`: the change may not take effect on that day yet;
 * - `recomputeNeedsEngine`: `transition: 'recompute'`, before the engine;
 * - `previewStale`: the preview confirmed is no longer the preview.
 */
export const STREAK_PUBLISH_REFUSALS = [
  'notAdmin',
  'invalid',
  'stale',
  'tooEarly',
  'recomputeNeedsEngine',
  'previewStale',
] as const;
export type StreakPublishRefusal = (typeof STREAK_PUBLISH_REFUSALS)[number];

/**
 * The server read the request and said no. An ordinary answer, not an
 * accident: the page words it by `refusal`, and by `fields` where the
 * refusal names any (paths into the rule, spelled as
 * `StreakDefinitionField` spells them).
 */
export class StreakPublishRefusedError extends DomainError {
  readonly code = 'engagement.streak_publish.refused' as const;

  constructor(
    readonly refusal: StreakPublishRefusal,
    readonly fields: readonly string[] = [],
  ) {
    super(`The rhythm's rule was not written: ${refusal}`, { refusal, fields });
  }
}

/** The request never got its answer: offline, a timeout, a server that fell over. Trying again is the fix. */
export class StreakPublishFailedError extends DomainError {
  readonly code = 'engagement.streak_publish.failed' as const;

  constructor(public override readonly cause: RepositoryError) {
    super("The rhythm's rule could not be sent");
  }
}

export type PublishStreakDefinitionError =
  StreakPublishRefusedError | StreakPublishFailedError;

/**
 * THE RHYTHM'S RULE, read and published (client-card-revision-3.md §4.4).
 *
 * Its own port, not a method on the catalogue reader: the catalogue is
 * read once a session by every card, the rule is WATCHED by the one page
 * that edits it, and the catalogue reader's fakes live in several libs.
 *
 * The read is the head document (`streakDefinitions/{id}`): the version
 * in force and at most one that waits. Which of the two judges a day is
 * the model's to say (`inForceOn(today)`), so nothing here takes a date.
 * The writes go through the server (`publishStreakDefinition`), the only
 * writer the rules allow; a refusal is a failed `Result`, never a throw.
 */
export interface StreakDefinitionRepository {
  /**
   * The head, and again whenever it changes. `null` = the shop has
   * published no rule yet: an ordinary answer, not an error (the editor
   * then opens on `StreakDefinition.default()`). The stream stays open
   * after a failed read and answers again when the next one succeeds.
   */
  observe(
    streakId: string,
  ): Observable<Result<StreakDefinitionSchedule | null, RepositoryError>>;

  /**
   * The rule's history, NEWEST FIRST, `limit` of it at most: every
   * publish, the withdrawn ones among them. The admin pair's alone: for
   * anyone else the rules refuse the read, which is a failed `Result`.
   */
  listVersions(
    streakId: string,
    limit: number,
  ): Promise<Result<readonly StreakDefinitionVersion[], RepositoryError>>;

  /**
   * Publishes the next version. Effective today or earlier it is the rule
   * in force at once; later, it WAITS for its day, in place of whatever
   * waited before it (which is then withdrawn).
   */
  publish(
    request: PublishStreakDefinition,
  ): Promise<Result<PublishedStreakDefinition, PublishStreakDefinitionError>>;

  /**
   * Calls off the version that waits, before its day. `version` names it,
   * so an undo that arrives after the head moved on is refused (`stale`)
   * instead of calling off something else. `requestId` as on a publish.
   */
  withdraw(
    streakId: string,
    version: number,
    requestId: string,
  ): Promise<Result<void, PublishStreakDefinitionError>>;
}

export const STREAK_DEFINITION_REPOSITORY =
  new InjectionToken<StreakDefinitionRepository>('StreakDefinitionRepository');
