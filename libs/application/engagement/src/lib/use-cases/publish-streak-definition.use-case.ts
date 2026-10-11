import {
  type IsoDate,
  StreakDefinition,
  type StreakDefinitionError,
  type StreakDefinitionProps,
  StreakDefinitionSchedule,
  type StreakExcuse,
  type StreakNoticePolicy,
  type StreakOnBreak,
  type StreakRuleChange,
  type StreakRuleDirection,
  type StreakTransition,
  addDays,
} from '@creativo/domain/engagement';
import {
  DraftAssessment,
  HeadRole,
  LocalDate,
  ServiceCategoryId,
  ServiceId,
  StreakExcuse as SystemExcuse,
  StreakIntervalRule,
  StreakOnBreak as SystemOnBreak,
  StreakPublishSystem,
  StreakQualifierRule,
  type StreakRule,
  type StreakRuleInput,
  StreakRuleDirection as SystemDirection,
  StreakRuleParameter,
  type StreakSchedule,
  StreakTransition as SystemTransition,
  defect,
} from '@creativo/ecs-core';
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
    // The decision is `StreakPublishSystem.assess` (`@creativo/ecs-core`);
    // the factory words a draft that is no rule as the classes the page
    // knows, and makes the version the page publishes.
    // The day asked is handed across AS WRITTEN (a `StreakRuleInput`): the
    // system's parse — the only door to the brand — refuses one that is no
    // day, as a fault of the draft.
    const assessed = StreakPublishSystem.assess(
      headOf(schedule),
      published,
      ruleOfProps(input.draft, input.effectiveFrom),
      input.effectiveFrom,
      dayOf(input.today),
      input.policy,
    );
    const baseVersion =
      assessed.draftAssessment === DraftAssessment.Valid
        ? assessed.baseVersion
        : published
          ? StreakPublishSystem.newestOf(headOf(schedule))
          : 0;
    const built = StreakDefinition.create({
      ...input.draft,
      id: schedule.id,
      version: baseVersion + 1,
      effectiveFrom: input.effectiveFrom,
    });
    if (built.isFailure()) return invalid(built.error);
    if (assessed.draftAssessment !== DraftAssessment.Valid) return invalid([]);
    return {
      kind: 'valid',
      definition: built.value,
      change: {
        direction: LEGACY_DIRECTION[assessed.change.direction],
        changed: assessed.change.changed.map(
          (parameter) => LEGACY_PARAMETER[parameter],
        ),
      },
      earliest: assessed.earliest,
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

// ── The bridge: legacy class/props ↔ ecs-core struct (Phase 4 deletes it) ──

const SYSTEM_EXCUSE = {
  shopClosure: SystemExcuse.ShopClosure,
  barberAbsence: SystemExcuse.BarberAbsence,
  staffCancelled: SystemExcuse.StaffCancelled,
  closedDays: SystemExcuse.ClosedDays,
} as const satisfies Record<StreakExcuse, SystemExcuse>;

const SYSTEM_ON_BREAK = {
  restart: SystemOnBreak.Restart,
  hold: SystemOnBreak.Hold,
} as const satisfies Record<StreakOnBreak, SystemOnBreak>;

const SYSTEM_TRANSITION = {
  grandfather: SystemTransition.Grandfather,
  recompute: SystemTransition.Recompute,
} as const satisfies Record<StreakTransition, SystemTransition>;

/** A change's direction, in the legacy words. */
const LEGACY_DIRECTION: Readonly<Record<SystemDirection, StreakRuleDirection>> =
  {
    [SystemDirection.Looser]: 'looser',
    [SystemDirection.Stricter]: 'stricter',
    [SystemDirection.Mixed]: 'mixed',
    [SystemDirection.Neutral]: 'neutral',
    [SystemDirection.Switch]: 'switch',
  };

/** A parameter that moved, as the legacy props name it. */
const LEGACY_PARAMETER: Readonly<
  Record<StreakRuleParameter, StreakRuleChange['changed'][number]>
> = {
  [StreakRuleParameter.Name]: 'name',
  [StreakRuleParameter.Enabled]: 'enabled',
  [StreakRuleParameter.Qualifier]: 'qualifier',
  [StreakRuleParameter.MinGapDays]: 'minGapDays',
  [StreakRuleParameter.BookingHold]: 'bookingHold',
  [StreakRuleParameter.Interval]: 'interval',
  [StreakRuleParameter.GraceDays]: 'graceDays',
  [StreakRuleParameter.RiskLeadDays]: 'riskLeadDays',
  [StreakRuleParameter.Protections]: 'protections',
  [StreakRuleParameter.Excuses]: 'excuses',
  [StreakRuleParameter.ClientPause]: 'clientPause',
  [StreakRuleParameter.Repair]: 'repair',
  [StreakRuleParameter.OnBreak]: 'onBreak',
};

/** A Sofia day this edge holds: a checked version day, a clock's «today». */
function dayOf(raw: IsoDate): LocalDate {
  const day = LocalDate.parse(raw);
  return day.ok ? day.value : defect(`${raw} is no calendar day`);
}

/**
 * A version as the system reads it: the figures, flat (every part's
 * figures prefixed by the part), every tag the dictionary's; its day as
 * `effectiveFromLocalDate` — a checked `LocalDate` makes a `StreakRule`, a
 * day as written a `StreakRuleInput` for the parse to judge.
 */
function ruleOfProps<Day extends string>(
  props: StreakDefinitionProps,
  effectiveFromLocalDate: Day,
): StreakRuleInput & { readonly effectiveFromLocalDate: Day } {
  const { qualifier, interval } = props;
  return {
    version: props.version,
    effectiveFromLocalDate,
    enabled: props.enabled,
    ...(qualifier.kind === 'services'
      ? StreakQualifierRule.services(
          qualifier.serviceIds.map((id) => ServiceId.of(id)),
        )
      : qualifier.kind === 'categories'
        ? StreakQualifierRule.categories(
            qualifier.categoryIds.map((id) => ServiceCategoryId.of(id)),
          )
        : StreakQualifierRule.anyVisit()),
    minGapDays: props.minGapDays,
    bookingHoldEnabled: props.bookingHold.enabled,
    bookingHoldMaxDaysPastDue: props.bookingHold.maxDaysPastDue,
    ...(interval.kind === 'fixed'
      ? StreakIntervalRule.fixed(interval.days)
      : StreakIntervalRule.personal(
          interval.tolerancePct,
          interval.minDays,
          interval.maxDays,
          interval.fallbackDays,
        )),
    graceDays: props.graceDays,
    riskLeadDays: props.riskLeadDays,
    protectionsEnabled: props.protections.enabled,
    protectionsMaxBanked: props.protections.maxBanked,
    protectionsEarnEvery: props.protections.earnEvery,
    protectionsStartWith: props.protections.startWith,
    excuses: props.excuses.map((excuse) => SYSTEM_EXCUSE[excuse]),
    clientPauseEnabled: props.clientPause.enabled,
    clientPauseMaxDaysPerYear: props.clientPause.maxDaysPerYear,
    repairEnabled: props.repair.enabled,
    repairWindowDays: props.repair.windowDays,
    repairPerYear: props.repair.perYear,
    onBreak: SYSTEM_ON_BREAK[props.onBreak],
  };
}

/** A published version as the system reads it — its day was checked by `StreakDefinition.create`. */
function ruleOf(definition: StreakDefinition): StreakRule {
  const props = definition.toProps();
  return ruleOfProps(props, dayOf(props.effectiveFrom));
}

/** The head as the system reads it: its `rules` list, the rule in force first. */
function headOf(schedule: StreakDefinitionSchedule): StreakSchedule {
  const { scheduled } = schedule;
  const current = {
    ...ruleOf(schedule.current),
    headRole: HeadRole.Current,
    streakTransition: null,
  };
  return {
    rules:
      scheduled === null
        ? [current]
        : [
            current,
            {
              ...ruleOf(scheduled.definition),
              headRole: HeadRole.Scheduled,
              streakTransition: SYSTEM_TRANSITION[scheduled.transition],
            },
          ],
  };
}
