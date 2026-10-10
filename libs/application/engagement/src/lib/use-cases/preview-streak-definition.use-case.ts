import {
  type IsoDate,
  type StreakDefinition,
  type StreakFacts,
} from '@creativo/domain/engagement';
import {
  DayKey,
  type ServiceCategoryId,
  type ServiceId,
  type StreakFacts as SystemFacts,
  StreakIntervalKind,
  StreakPreviewSystem,
  StreakQualifierKind,
  type StreakRule,
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
    return StreakPreviewSystem.estimate(
      ruleOf(input.inForce),
      ruleOf(input.draft),
      input.clients.map(factsOf),
      DayKey.of(input.today),
    );
  }
}

// ── The bridge: legacy class/facts → ecs-core structs (Phase 4 deletes it) ─

/** A version as the system reads it: the class's figures, the day as a day key. */
function ruleOf(definition: StreakDefinition): StreakRule {
  const props = definition.toProps();
  const { qualifier, interval } = props;
  return {
    version: props.version,
    effectiveFromDayKey: DayKey.of(props.effectiveFrom),
    enabled: props.enabled,
    qualifier:
      qualifier.kind === 'services'
        ? {
            kind: StreakQualifierKind.Services,
            serviceIds: qualifier.serviceIds as readonly ServiceId[],
          }
        : qualifier.kind === 'categories'
          ? {
              kind: StreakQualifierKind.Categories,
              categoryIds:
                qualifier.categoryIds as readonly ServiceCategoryId[],
            }
          : { kind: StreakQualifierKind.AnyVisit },
    minGapDays: props.minGapDays,
    bookingHold: props.bookingHold,
    interval:
      interval.kind === 'fixed'
        ? { kind: StreakIntervalKind.Fixed, days: interval.days }
        : {
            kind: StreakIntervalKind.Personal,
            tolerancePct: interval.tolerancePct,
            minDays: interval.minDays,
            maxDays: interval.maxDays,
            fallbackDays: interval.fallbackDays,
          },
    graceDays: props.graceDays,
    riskLeadDays: props.riskLeadDays,
    protections: props.protections,
    excuses: props.excuses,
    clientPause: props.clientPause,
    repair: props.repair,
    onBreak: props.onBreak,
  };
}

/** One person's facts as the system reads them: every field present. */
function factsOf(facts: StreakFacts): SystemFacts {
  return {
    visits: facts.visits.map((visit) => ({
      day: DayKey.of(visit.day),
      counted: visit.counted,
      atMs: visit.at === undefined ? null : visit.at.getTime(),
    })),
    excused: facts.excused.map((excused) => ({
      day: DayKey.of(excused.day),
      reason: excused.reason,
    })),
    bookings: facts.bookings.map((booking) => ({
      placedOn: DayKey.of(booking.placedOn),
      day: DayKey.of(booking.day),
      appointmentId: booking.appointmentId ?? null,
    })),
    pauses: facts.pauses.map((pause) => ({
      from: DayKey.of(pause.from),
      until: DayKey.of(pause.until),
      reason: pause.reason,
    })),
    grants: facts.grants.map((grant) => ({
      day: DayKey.of(grant.day),
      count: grant.count,
    })),
  };
}
