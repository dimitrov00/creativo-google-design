import {
  type IsoDate,
  type StreakDefinition,
  type StreakFacts,
  type StreakState,
  isIsoDate,
  projectStreak,
} from '@creativo/domain/engagement';

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

type Standing = keyof StreakStandingCounts;

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
    const { inForce, draft, today } = input;
    if (
      inForce.qualifier.kind !== 'anyVisit' ||
      draft.qualifier.kind !== 'anyVisit'
    ) {
      return { kind: 'unavailable', reason: 'qualifier' };
    }

    const judged = input.clients
      .filter((facts) => hasVisit(facts, today))
      .map((facts) => ({
        was: standingOf(projectStreak(inForce, facts, today)),
        is: standingOf(projectStreak(draft, facts, today)),
      }));
    // An off rule hands every person a `null`: nobody moved, the rule did.
    const moved = judged.filter(({ was, is }) => was !== null && is !== null);
    return {
      kind: 'estimate',
      clients: judged.length,
      before: inForce.enabled ? countsOf(judged.map(({ was }) => was)) : null,
      after: draft.enabled ? countsOf(judged.map(({ is }) => is)) : null,
      back: moved.filter(
        ({ was, is }) => was !== 'inRhythm' && is === 'inRhythm',
      ).length,
      out: moved.filter(
        ({ was, is }) => was === 'inRhythm' && is !== 'inRhythm',
      ).length,
    };
  }
}

function countsOf(
  standings: readonly (Standing | null)[],
): StreakStandingCounts {
  const count = (standing: Standing) =>
    standings.filter((one) => one === standing).length;
  return {
    inRhythm: count('inRhythm'),
    inGrace: count('inGrace'),
    broken: count('broken'),
  };
}

/**
 * A counted visit on a real day, today or before it: what opens a run
 * under any rule that is on. On a `today` that is no day nobody has one.
 */
function hasVisit(facts: StreakFacts, today: IsoDate): boolean {
  return (
    isIsoDate(today) &&
    facts.visits.some(
      (visit) => visit.counted && isIsoDate(visit.day) && visit.day <= today,
    )
  );
}

/** Where a state stands; `null` for no state (the rule is off). */
function standingOf(state: StreakState | null): Standing | null {
  if (state === null) return null;
  switch (state.phase.kind) {
    case 'active':
    case 'atRisk':
    case 'frozen':
      return 'inRhythm';
    case 'inGrace':
      return 'inGrace';
    case 'broken':
      return 'broken';
  }
}
