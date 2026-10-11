import {
  type IsoDate,
  type StreakDefinition,
  type StreakDefinitionProps,
  type StreakExcuse,
  type StreakFacts,
  type StreakOnBreak,
  streakFactsReader,
} from '@creativo/domain/engagement';
import {
  LocalDate,
  ServiceCategoryId,
  ServiceId,
  StreakExcuse as SystemExcuse,
  StreakIntervalRule,
  StreakOnBreak as SystemOnBreak,
  type StreakPreview as SystemPreview,
  StreakPreviewOutcome,
  StreakPreviewSystem,
  StreakQualifierRule,
  type StreakRule,
  defect,
} from '@creativo/ecs-core';

export interface PreviewStreakDefinitionInput {
  /** The rule clients live under today. */
  readonly inForce: StreakDefinition;
  /** The rule proposed. */
  readonly draft: StreakDefinition;
  /**
   * One person's facts each, their visits judged by NO LIST: every worked
   * visit counts. That is all a visit's instant can say, and the instants
   * are all the statistics hold.
   */
  readonly clients: readonly StreakFacts[];
  /** The shop's today. */
  readonly today: IsoDate;
}

/** How many people stand where, under one rule. */
export interface StreakStandingCounts {
  /** The period is open and its due date ahead: on time, close to the due date, or held by a protection or a pause. */
  readonly inRhythm: number;
  /** Past the due date, inside the grace: a visit still keeps the run. */
  readonly inGrace: number;
  /** A period was missed and none is open. */
  readonly broken: number;
}

/**
 * What a change of the rule does to the people it judges, in counts.
 *
 * `before` and `after` are `null` under a rule that is switched OFF: an
 * off rule judges nobody, which is not "nobody is in rhythm". `back` and
 * `out` count the people a change moves INTO `inRhythm` and out of it, so
 * `after.inRhythm − before.inRhythm` is `back − out`; both are 0 while
 * either rule is off, because then it is the rule that comes or goes, not
 * a person.
 */
export type StreakPreview =
  | {
      readonly kind: 'estimate';
      /** The people with a visit to judge: each is in exactly one count of a rule that is on. */
      readonly clients: number;
      readonly before: StreakStandingCounts | null;
      readonly after: StreakStandingCounts | null;
      readonly back: number;
      readonly out: number;
    }
  /** One of the two rules counts by a list of services or categories, and the facts cannot say what a visit held. */
  | { readonly kind: 'unavailable'; readonly reason: 'qualifier' };

/**
 * «Какво ще се промени» (client-card-revision-3.md §4.4): every person
 * folded through the domain's projector twice, once per rule, and the two
 * answers counted. Pure: it reads nothing and keeps nothing, so the page
 * runs it again on every change of the draft over facts it read once.
 *
 * It is an ESTIMATE and is labelled so. The facts are visit days from the
 * last year of `clientStats`: exact for where a run stands under «всяко
 * посещение», short of what the shop called off and of protections given
 * by hand, and silent about services, so a rule that counts by a list
 * cannot be previewed at all. The exact preview is the engine's.
 */
export class PreviewStreakDefinitionUseCase {
  execute(input: PreviewStreakDefinitionInput): StreakPreview {
    const today = LocalDate.parse(input.today);
    return legacyPreviewOf(
      StreakPreviewSystem.estimate(
        ruleOf(input.inForce),
        ruleOf(input.draft),
        input.clients.map(streakFactsReader()),
        // On a `today` that is no day nobody is judged.
        today.ok ? today.value : null,
      ),
    );
  }
}

// ── The bridge: legacy class/facts ↔ ecs-core structs (Phase 4 deletes it) ─

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

/** A Sofia day this edge holds: a checked version day, a clock's «today». */
function dayOf(raw: IsoDate): LocalDate {
  const day = LocalDate.parse(raw);
  return day.ok ? day.value : defect(`${raw} is no calendar day`);
}

/**
 * A version as the system reads it: the figures, flat (every part's
 * figures prefixed by the part), every tag the dictionary's; its day as
 * `effectiveFromLocalDate`.
 */
function ruleOfProps(
  props: StreakDefinitionProps,
  effectiveFromLocalDate: LocalDate,
): StreakRule {
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

/** The system's answer in the legacy words: `kind`, lowercase. */
function legacyPreviewOf(preview: SystemPreview): StreakPreview {
  return preview.streakPreviewOutcome === StreakPreviewOutcome.Unavailable
    ? { kind: 'unavailable', reason: 'qualifier' }
    : {
        kind: 'estimate',
        clients: preview.clients,
        before: preview.before,
        after: preview.after,
        back: preview.back,
        out: preview.out,
      };
}
