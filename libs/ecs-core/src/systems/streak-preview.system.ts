import { DayKey } from '../components/day-key.data';
import { StreakQualifierKind } from '../components/streak-qualifier.data';
import type { StreakRule } from '../components/streak-rule.data';
import { StreakPhaseKind } from '../components/streak-state.data';
import {
  StreakSystem,
  type StreakFacts,
  type StreakVisitFact,
} from './streak.system';

/*
 * «КАКВО ЩЕ СЕ ПРОМЕНИ» (client-card-revision-3.md §4.4,
 * `preview-streak-definition.use-case.ts`): every person folded through
 * the projector twice, once per rule, and the two answers counted. Pure:
 * it reads nothing and keeps nothing, so the page runs it again on every
 * change of the draft over facts it read once.
 *
 * It is an ESTIMATE and is labelled so. The facts are visit days from the
 * last year of `clientStats`: exact for where a run stands under «всяко
 * посещение», short of what the shop called off and of protections given
 * by hand, and silent about services, so a rule that counts by a list
 * cannot be previewed at all. The exact preview is the engine's.
 */

/** Where a person stands under one rule, as the preview counts them. */
export const StreakStanding = {
  /** The period is open and its due date ahead: on time, close to it, or held by a protection or a pause. */
  InRhythm: 'inRhythm',
  /** Past the due date, inside the grace: a visit still keeps the run. */
  InGrace: 'inGrace',
  /** A period was missed and none is open. */
  Broken: 'broken',
} as const;
export type StreakStanding =
  (typeof StreakStanding)[keyof typeof StreakStanding];

/** What the preview answers, by kind. */
export const StreakPreviewKind = {
  Estimate: 'estimate',
  /** One of the two rules counts by a list, and the facts cannot say what a visit held. */
  Unavailable: 'unavailable',
} as const;
export type StreakPreviewKind =
  (typeof StreakPreviewKind)[keyof typeof StreakPreviewKind];

/** Why a preview cannot be made. */
export const StreakPreviewUnavailable = {
  Qualifier: 'qualifier',
} as const;
export type StreakPreviewUnavailable =
  (typeof StreakPreviewUnavailable)[keyof typeof StreakPreviewUnavailable];

/** How many people stand where, under one rule. */
export type StreakStandingCounts = {
  readonly inRhythm: number;
  readonly inGrace: number;
  readonly broken: number;
};

/**
 * What a change of the rule does to the people it judges, in counts.
 * `before`/`after` are `null` under a rule that is OFF: an off rule judges
 * nobody, which is not "nobody is in rhythm". `back` and `out` count the
 * people a change moves INTO `inRhythm` and out of it, so
 * `after.inRhythm − before.inRhythm` is `back − out`; both are 0 while
 * either rule is off, because then it is the rule that comes or goes.
 */
export type StreakPreview =
  | {
      readonly kind: typeof StreakPreviewKind.Estimate;
      /** The people with a visit to judge: each is in exactly one count of a rule that is on. */
      readonly clients: number;
      readonly before: StreakStandingCounts | null;
      readonly after: StreakStandingCounts | null;
      readonly back: number;
      readonly out: number;
    }
  | {
      readonly kind: typeof StreakPreviewKind.Unavailable;
      readonly reason: StreakPreviewUnavailable;
    };

/** Where a state stands; `null` for no state (the rule is off). */
function standingOf(kind: StreakPhaseKind | null): StreakStanding | null {
  if (kind === null) return null;
  switch (kind) {
    case StreakPhaseKind.InGrace:
      return StreakStanding.InGrace;
    case StreakPhaseKind.Broken:
      return StreakStanding.Broken;
    default:
      return StreakStanding.InRhythm;
  }
}

/** A counted visit on a real day, today or before it: what opens a run under any rule that is on. */
function hasVisit(facts: StreakFacts, today: DayKey): boolean {
  for (let i = 0; i < facts.visits.length; i++) {
    const visit = facts.visits[i] as StreakVisitFact;
    if (visit.counted && DayKey.isValid(visit.day) && visit.day <= today) {
      return true;
    }
  }
  return false;
}

function emptyCounts(): { inRhythm: number; inGrace: number; broken: number } {
  return { inRhythm: 0, inGrace: 0, broken: 0 };
}

export const StreakPreviewSystem = {
  /**
   * The estimate of moving from `inForce` to `draft`, over one person's
   * facts each (their visits judged by NO LIST: every worked visit
   * counts). Unavailable while either rule counts by a list. On a `today`
   * that is no day nobody is judged. No zone: a phase is read off day
   * numbers alone.
   */
  estimate(
    inForce: StreakRule,
    draft: StreakRule,
    clients: readonly StreakFacts[],
    today: DayKey,
  ): StreakPreview {
    if (
      inForce.qualifier.kind !== StreakQualifierKind.AnyVisit ||
      draft.qualifier.kind !== StreakQualifierKind.AnyVisit
    ) {
      return {
        kind: StreakPreviewKind.Unavailable,
        reason: StreakPreviewUnavailable.Qualifier,
      };
    }
    const before = emptyCounts();
    const after = emptyCounts();
    let judged = 0;
    let back = 0;
    let out = 0;
    const valid = DayKey.isValid(today);
    for (let i = 0; i < clients.length; i++) {
      const facts = clients[i] as StreakFacts;
      if (!valid || !hasVisit(facts, today)) continue;
      judged += 1;
      // The phase alone (`StreakSystem.phaseKind`): the same fold as the
      // state, without assembling one per client per rule.
      const was = standingOf(StreakSystem.phaseKind(inForce, facts, today));
      const is = standingOf(StreakSystem.phaseKind(draft, facts, today));
      if (was !== null) before[was] += 1;
      if (is !== null) after[is] += 1;
      // An off rule hands every person a `null`: nobody moved, the rule did.
      if (was === null || is === null) continue;
      if (was !== StreakStanding.InRhythm && is === StreakStanding.InRhythm) {
        back += 1;
      }
      if (was === StreakStanding.InRhythm && is !== StreakStanding.InRhythm) {
        out += 1;
      }
    }
    return {
      kind: StreakPreviewKind.Estimate,
      clients: judged,
      before: inForce.enabled ? before : null,
      after: draft.enabled ? after : null,
      back,
      out,
    };
  },
} as const;
