import {
  type IsoDate,
  StreakDefinition,
  type StreakDefinitionError,
  type StreakDefinitionProps,
  StreakDefinitionSchedule,
  type StreakNoticePolicy,
  type StreakRuleChange,
  type StreakRuleDirection,
  type StreakTransition,
  addDays,
} from '@creativo/domain/engagement';
import { RepositoryError } from '@creativo/application/shared';
import {
  type PublishStreakDefinitionError,
  type StreakDefinitionRepository,
  type StreakPublishRefusal,
  StreakPublishRefusedError,
} from '../ports/streak-definition.port';
import type { ObservedStreakDefinition } from './observe-streak-definition.use-case';

/** «Запази», as the editor asks for it. */
export interface PublishStreakDefinitionInput {
  /** The head the draft was made on, as `ObserveStreakDefinitionUseCase` handed it over. */
  readonly observed: ObservedStreakDefinition;
  /**
   * The rule as the editor holds it. Its `id`, `version` and
   * `effectiveFrom` are not the editor's to say and are set here: the id
   * is the rule's, the version the next one, the day `effectiveFrom`
   * below.
   */
  readonly draft: StreakDefinitionProps;
  /** The first Europe/Sofia day the new version judges by. */
  readonly effectiveFrom: IsoDate;
  readonly transition: StreakTransition;
  /** One per intent, kept across retries of it (`isClientOperationId`'s shape). */
  readonly requestId: string;
  /** The shop's today. */
  readonly today: IsoDate;
  /** Whether clients see the rhythm yet, and the notice a stricter rule owes them. */
  readonly policy: StreakNoticePolicy;
  /** The exact preview this was confirmed on; none until the server has one. */
  readonly previewHash?: string | null;
}

/**
 * What became of a «Запази». Every kind is an answer the page words; none
 * is thrown.
 */
export type PublishOutcome =
  | {
      readonly kind: 'published';
      readonly version: number;
      readonly effectiveFrom: IsoDate;
      /** Whom the change favours, as the server classed it. */
      readonly direction: StreakRuleDirection;
      /** Its day has not come: until then it can still be called off. */
      readonly waits: boolean;
    }
  /** The draft is the rule in force, figure for figure: there is nothing to publish. */
  | { readonly kind: 'unchanged' }
  /**
   * The draft is no rule. `fields` names what to fix, in the rule's own
   * order; `errors` are the domain's, present when the draft was refused
   * HERE, before any round trip, and empty when the server refused it.
   */
  | {
      readonly kind: 'invalid';
      readonly fields: readonly string[];
      readonly errors: readonly StreakDefinitionError[];
    }
  /** The change may not start on the day asked: `earliest` is the first day it may. */
  | { readonly kind: 'tooEarly'; readonly earliest: IsoDate }
  | {
      readonly kind: 'refused';
      readonly refusal: Exclude<StreakPublishRefusal, 'invalid' | 'tooEarly'>;
    }
  /** The request got no answer. The draft stands; trying again is the fix. */
  | { readonly kind: 'failed'; readonly error: RepositoryError };

/** «Отмени»: calling off the version that waits. */
export interface WithdrawStreakDefinitionInput {
  readonly observed: ObservedStreakDefinition;
  readonly requestId: string;
  readonly today: IsoDate;
}

export type WithdrawOutcome =
  | { readonly kind: 'withdrawn'; readonly version: number }
  /** Nothing waits on this day: its day came, or nothing was scheduled. */
  | { readonly kind: 'nothingWaits' }
  | { readonly kind: 'refused'; readonly refusal: StreakPublishRefusal }
  | { readonly kind: 'failed'; readonly error: RepositoryError };

/** What a draft comes to, before anything is sent. */
export type StreakDraftAssessment =
  | {
      readonly kind: 'valid';
      /** The next version, ready to publish. */
      readonly definition: StreakDefinition;
      /** Against the rule in force today. */
      readonly change: StreakRuleChange;
      /** The first day this change may take effect. */
      readonly earliest: IsoDate;
      /** The newest version the head holds: what the publish is based on. */
      readonly baseVersion: number;
    }
  | {
      readonly kind: 'invalid';
      readonly fields: readonly string[];
      readonly errors: readonly StreakDefinitionError[];
    };

/**
 * Publishes the rhythm's rule (client-card-revision-3.md §4.4).
 *
 * The server decides: it builds the rule again, classes the change again
 * and checks the day again. This use case runs the SAME domain first, so
 * the page names the field, or the earliest day, before a round trip, and
 * what it sends is already a rule:
 *
 * 1. the draft becomes the next version through `StreakDefinition.create`
 *    (every fault at once);
 * 2. it is compared with the rule IN FORCE today. A version that waits is
 *    not what clients live under: a new publish replaces it;
 * 3. the day asked is held to the earliest the change may take effect;
 * 4. then the port, and its answer in the page's terms.
 */
export class PublishStreakDefinitionUseCase {
  constructor(private readonly definitions: StreakDefinitionRepository) {}

  /**
   * Steps 1 to 3, sending nothing: what the editor shows WHILE the draft
   * changes (the faults, the change's direction, the earliest day).
   */
  assess(
    input: Pick<
      PublishStreakDefinitionInput,
      'observed' | 'draft' | 'effectiveFrom' | 'today' | 'policy'
    >,
  ): StreakDraftAssessment {
    const { schedule, published } = input.observed;
    const inForce = schedule.inForceOn(input.today);
    const baseVersion = published
      ? (schedule.scheduled?.definition.version ?? schedule.current.version)
      : 0;
    const built = StreakDefinition.create({
      ...input.draft,
      id: schedule.id,
      version: baseVersion + 1,
      effectiveFrom: input.effectiveFrom,
    });
    if (built.isFailure()) return invalid(built.error);
    const change = built.value.changeFrom(inForce);
    return {
      kind: 'valid',
      definition: built.value,
      change,
      earliest: StreakDefinitionSchedule.earliestEffectiveDay(
        change,
        input.today,
        input.policy,
      ),
      baseVersion,
    };
  }

  async execute(input: PublishStreakDefinitionInput): Promise<PublishOutcome> {
    const draft = this.assess(input);
    if (draft.kind === 'invalid') return draft;
    // An unpublished rule is published even as recommended: until it is,
    // there is no rule.
    if (input.observed.published && draft.change.changed.length === 0) {
      return { kind: 'unchanged' };
    }
    if (input.effectiveFrom < draft.earliest) {
      return { kind: 'tooEarly', earliest: draft.earliest };
    }

    const written = await this.definitions.publish({
      requestId: input.requestId,
      baseVersion: draft.baseVersion,
      definition: draft.definition,
      transition: input.transition,
      previewHash: input.previewHash ?? null,
    });
    if (written.isSuccess()) {
      return {
        kind: 'published',
        version: written.value.version,
        effectiveFrom: written.value.effectiveFrom,
        direction: written.value.direction,
        waits: written.value.effectiveFrom > input.today,
      };
    }
    const refused = refusalOf(written.error);
    if (refused.kind !== 'refused') return refused;
    switch (refused.refusal) {
      case 'invalid':
        return { kind: 'invalid', fields: refused.fields, errors: [] };
      case 'tooEarly':
        // The server holds the change to a stricter day than this side
        // worked out. It does not say which, so the day offered is the
        // strictest the domain knows for this change, and always a later
        // one than the day just refused.
        return {
          kind: 'tooEarly',
          earliest: laterOf(
            StreakDefinitionSchedule.earliestEffectiveDay(
              draft.change,
              input.today,
              { ...input.policy, clientsSeeRhythm: true },
            ),
            addDays(input.effectiveFrom, 1),
          ),
        };
      default:
        return { kind: 'refused', refusal: refused.refusal };
    }
  }

  /** Calls off the version that waits on `today`, by its own number. */
  async withdraw(
    input: WithdrawStreakDefinitionInput,
  ): Promise<WithdrawOutcome> {
    const { schedule, published } = input.observed;
    const waiting = published ? schedule.upcomingOn(input.today) : null;
    if (waiting === null) return { kind: 'nothingWaits' };
    const { version } = waiting.definition;
    const withdrawn = await this.definitions.withdraw(
      schedule.id,
      version,
      input.requestId,
    );
    if (withdrawn.isSuccess()) return { kind: 'withdrawn', version };
    const refused = refusalOf(withdrawn.error);
    return refused.kind === 'refused'
      ? { kind: 'refused', refusal: refused.refusal }
      : refused;
  }
}

function invalid(
  errors: readonly StreakDefinitionError[],
): Extract<StreakDraftAssessment, { kind: 'invalid' }> {
  return {
    kind: 'invalid',
    fields: [...new Set(errors.map((error) => error.field))],
    errors,
  };
}

/** The port's error, told apart: the server's no, or no answer at all. */
function refusalOf(error: PublishStreakDefinitionError):
  | {
      readonly kind: 'refused';
      readonly refusal: StreakPublishRefusal;
      readonly fields: readonly string[];
    }
  | { readonly kind: 'failed'; readonly error: RepositoryError } {
  return error instanceof StreakPublishRefusedError
    ? { kind: 'refused', refusal: error.refusal, fields: error.fields }
    : { kind: 'failed', error: error.cause };
}

const laterOf = (a: IsoDate, b: IsoDate): IsoDate => (a > b ? a : b);
