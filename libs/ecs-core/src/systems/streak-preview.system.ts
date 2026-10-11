import { StreakQualifier } from '../components/streak-qualifier.data';
import type { StreakRule } from '../components/streak-rule.data';
import { StreakPhase } from '../components/streak-state.data';
import { LocalDate } from '../primitives/local-date.primitive';
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
  InRhythm: 'IN_RHYTHM',
  /** Past the due date, inside the grace: a visit still keeps the run. */
  InGrace: 'IN_GRACE',
  /** A period was missed and none is open. */
  Broken: 'BROKEN',
} as const;
export type StreakStanding =
  (typeof StreakStanding)[keyof typeof StreakStanding];

/** What the preview answers — the discriminator `streakPreviewOutcome`. */
export const StreakPreviewOutcome = {
  Estimate: 'ESTIMATE',
  /** One of the two rules counts by a list, and the facts cannot say what a visit held. */
  Unavailable: 'UNAVAILABLE',
} as const;
export type StreakPreviewOutcome =
  (typeof StreakPreviewOutcome)[keyof typeof StreakPreviewOutcome];

/** Why a preview cannot be made. */
export const StreakPreviewUnavailable = {
  Qualifier: 'QUALIFIER',
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
      readonly streakPreviewOutcome: typeof StreakPreviewOutcome.Estimate;
      /** The people with a visit to judge: each is in exactly one count of a rule that is on. */
      readonly clients: number;
      readonly before: StreakStandingCounts | null;
      readonly after: StreakStandingCounts | null;
      readonly back: number;
      readonly out: number;
    }
  | {
      readonly streakPreviewOutcome: typeof StreakPreviewOutcome.Unavailable;
      readonly reason: StreakPreviewUnavailable;
    };

/** Where a state stands; `null` for no state (the rule is off). */
function standingOf(phase: StreakPhase | null): StreakStanding | null {
  if (phase === null) return null;
  switch (phase) {
    case StreakPhase.InGrace:
      return StreakStanding.InGrace;
    case StreakPhase.Broken:
      return StreakStanding.Broken;
    default:
      return StreakStanding.InRhythm;
  }
}

/** A real shop day — a fact may carry a corrupt stored day, which no rule judges. */
function isDay(raw: string): boolean {
  return LocalDate.parse(raw).ok;
}

/** A counted visit on a real day, today or before it: what opens a run under any rule that is on. */
function hasVisit(facts: StreakFacts, today: LocalDate): boolean {
  for (let i = 0; i < facts.visits.length; i++) {
    const visit = facts.visits[i] as StreakVisitFact;
    if (visit.counted && isDay(visit.localDate) && visit.localDate <= today) {
      return true;
    }
  }
  return false;
}

type Counts = { inRhythm: number; inGrace: number; broken: number };

function emptyCounts(): Counts {
  return { inRhythm: 0, inGrace: 0, broken: 0 };
}

/** One more person in a standing's count. */
function tally(counts: Counts, standing: StreakStanding): void {
  switch (standing) {
    case StreakStanding.InGrace:
      counts.inGrace += 1;
      return;
    case StreakStanding.Broken:
      counts.broken += 1;
      return;
    default:
      counts.inRhythm += 1;
  }
}

export const StreakPreviewSystem = {
  /**
   * The estimate of moving from `inForce` to `draft`, over one person's
   * facts each (their visits judged by NO LIST: every worked visit
   * counts). Unavailable while either rule counts by a list. On no `today`
   * (`null`: the boundary was handed a day that is no day) nobody is
   * judged. No zone: a phase is read off day numbers alone.
   */
  estimate(
    inForce: StreakRule,
    draft: StreakRule,
    clients: readonly StreakFacts[],
    today: LocalDate | null,
  ): StreakPreview {
    if (
      inForce.streakQualifier !== StreakQualifier.AnyVisit ||
      draft.streakQualifier !== StreakQualifier.AnyVisit
    ) {
      return {
        streakPreviewOutcome: StreakPreviewOutcome.Unavailable,
        reason: StreakPreviewUnavailable.Qualifier,
      };
    }
    const before = emptyCounts();
    const after = emptyCounts();
    let judged = 0;
    let back = 0;
    let out = 0;
    for (let i = 0; i < clients.length; i++) {
      const facts = clients[i] as StreakFacts;
      if (today === null || !hasVisit(facts, today)) continue;
      judged += 1;
      // The phase alone (`StreakSystem.phaseKind`): the same fold as the
      // state, without assembling one per client per rule.
      const was = standingOf(StreakSystem.phaseKind(inForce, facts, today));
      const is = standingOf(StreakSystem.phaseKind(draft, facts, today));
      if (was !== null) tally(before, was);
      if (is !== null) tally(after, is);
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
      streakPreviewOutcome: StreakPreviewOutcome.Estimate,
      clients: judged,
      before: inForce.enabled ? before : null,
      after: draft.enabled ? after : null,
      back,
      out,
    };
  },
} as const;
