import { DomainError } from '@creativo/domain/kernel';
import type { IsoDate } from '@creativo/domain/engagement';
import type { StreakPublishRefusal } from '@creativo/application/engagement';

/**
 * Every way the rhythm's rule is not written (client-card-revision-3 §4.4).
 *
 * TWO KINDS, and the callable treats them differently:
 *
 * - a REFUSAL is an answer. The server read the request, understood it and
 *   said no, in one of the six words the page knows
 *   (`STREAK_PUBLISH_REFUSALS`); the callable RETURNS it
 *   (`{ kind: 'refused', code, fields }`) and the page words it;
 * - a FAULT is no answer: nobody is signed in, the request is not a
 *   request, the write fell over. The callable THROWS it, and the page
 *   says the rule could not be sent.
 */

/**
 * The server's no. `refusal` is the word on the wire; `fields` are the paths
 * into the rule the refusal is about, spelled as `StreakDefinitionField`
 * spells them, empty when it is about none.
 */
export abstract class PublishStreakDefinitionRefusal extends DomainError {
  abstract readonly refusal: StreakPublishRefusal;

  protected constructor(
    message: string,
    readonly fields: readonly string[] = [],
    params: Record<string, unknown> = {},
  ) {
    super(message, { fields, ...params });
  }
}

/**
 * The caller is signed in and is neither `admin` nor `sysadmin`.
 *
 * Said plainly, never masked as not-found: the endpoint is no secret, and
 * "you lack the role" is what the page has to tell a barber who found the
 * address.
 */
export class PublishStreakDefinitionNotAdminError extends PublishStreakDefinitionRefusal {
  readonly code = 'loyalty.streak_publish.not_admin' as const;
  readonly refusal = 'notAdmin' as const;

  constructor() {
    super("Only the shop's admins may change the rhythm's rule");
  }
}

/**
 * The draft is no rule: a field of the wrong kind, a figure outside its
 * range, a grace longer than the interval, a head that would not stand.
 * `fields` names what to fix.
 */
export class PublishStreakDefinitionInvalidError extends PublishStreakDefinitionRefusal {
  readonly code = 'loyalty.streak_publish.invalid' as const;
  readonly refusal = 'invalid' as const;

  constructor(fields: readonly string[]) {
    super(`The draft is no rhythm rule: ${fields.join(', ')}`, fields);
  }
}

/**
 * The head moved since the draft was made, or the version to call off no
 * longer waits. Never overwritten: the page shows the rule as it is now and
 * keeps the draft.
 */
export class PublishStreakDefinitionStaleError extends PublishStreakDefinitionRefusal {
  readonly code = 'loyalty.streak_publish.stale' as const;
  readonly refusal = 'stale' as const;

  constructor(
    readonly expected: number,
    readonly actual: number,
  ) {
    super(
      `The rhythm's rule moved on: the request names version ${expected}, the head holds ${actual}`,
      [],
      { expected: String(expected), actual: String(actual) },
    );
  }
}

/**
 * The change may not take effect on the day asked. `earliest` is the first
 * day it may, by the SERVER's notice policy, so the page can move the day
 * there and say so.
 */
export class PublishStreakDefinitionTooEarlyError extends PublishStreakDefinitionRefusal {
  readonly code = 'loyalty.streak_publish.too_early' as const;
  readonly refusal = 'tooEarly' as const;

  constructor(
    readonly effectiveFrom: IsoDate,
    readonly earliest: IsoDate,
  ) {
    super(
      `The change may start on ${earliest} at the earliest, not on ${effectiveFrom}`,
      ['effectiveFrom'],
      { effectiveFrom, earliest },
    );
  }
}

/**
 * `transition: 'recompute'` replays every client's history under the new
 * rule, and nothing here can: that is the engine's job, and there is no
 * engine yet. Refused rather than written as a promise nobody keeps.
 */
export class PublishStreakDefinitionRecomputeNeedsEngineError extends PublishStreakDefinitionRefusal {
  readonly code = 'loyalty.streak_publish.recompute_needs_engine' as const;
  readonly refusal = 'recomputeNeedsEngine' as const;

  constructor() {
    super('A recompute needs the rhythm engine, which does not exist yet');
  }
}

/**
 * The publish names a preview it was confirmed on, and that is not the
 * preview the server holds. Until the server HAS a preview it holds none,
 * so a request that names one was confirmed on something nobody can vouch
 * for.
 */
export class PublishStreakDefinitionPreviewStaleError extends PublishStreakDefinitionRefusal {
  readonly code = 'loyalty.streak_publish.preview_stale' as const;
  readonly refusal = 'previewStale' as const;

  constructor() {
    super('The preview this publish was confirmed on is not the preview');
  }
}

/** Nobody is signed in: there is no caller to judge, and nobody to name in the log. */
export class PublishStreakDefinitionUnauthenticatedError extends DomainError {
  readonly code = 'loyalty.streak_publish.unauthenticated' as const;

  constructor() {
    super("Changing the rhythm's rule needs a signed-in caller");
  }
}

/**
 * The request is not a request: a part of the ENVELOPE is missing or of the
 * wrong kind (`requestId`, `streakId`, `baseVersion`, `transition`,
 * `previewHash`, `draft`, `version`, `op`). A programming fault, not the
 * admin's: the page never words it, so it is thrown and not answered.
 * What is wrong with the RULE is `PublishStreakDefinitionInvalidError`.
 */
export class PublishStreakDefinitionMalformedRequestError extends DomainError {
  readonly code = 'loyalty.streak_publish.invalid_input' as const;

  constructor(readonly field: string) {
    super(`Invalid rhythm rule request: ${field}`, { field });
  }
}

/**
 * The transaction did not commit: it ran out of retries, the network fell
 * over, a stored document would not read, a version's number was taken.
 * Nothing partial was written; trying again is the fix.
 */
export class PublishStreakDefinitionStoreError extends DomainError {
  readonly code = 'loyalty.streak_publish.store_failed' as const;

  constructor(readonly storeFailure: unknown) {
    super("The rhythm's rule could not be written");
  }
}

export type PublishStreakDefinitionFault =
  | PublishStreakDefinitionUnauthenticatedError
  | PublishStreakDefinitionMalformedRequestError
  | PublishStreakDefinitionStoreError;

/**
 * Everything the use case can answer instead of a receipt. Not named
 * `PublishStreakDefinitionError`: that is the PORT's error on the
 * application's barrel (`StreakPublishRefusedError | StreakPublishFailedError`),
 * what the browser makes of these once they have crossed the wire.
 */
export type PublishStreakDefinitionFailure =
  PublishStreakDefinitionRefusal | PublishStreakDefinitionFault;
