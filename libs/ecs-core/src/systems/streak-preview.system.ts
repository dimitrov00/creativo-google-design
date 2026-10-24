import {
  type ClientStats,
  StreakIntervalRule,
  StreakQualifier,
  type StreakQualifierRule,
  StreakRule,
  StreakPhase,
  type StreakState,
  type VisitFact,
} from '@core/components';
import { LocalDate, type UtcEpochMs } from '@core/primitives';
import {
  StreakSystem,
  type StreakFacts,
  type StreakVisitFact,
} from './streak.system';

/*
 * «КАКВО ЩЕ СЕ ПРОМЕНИ» (client-card-revision-3.md §4.4,
 * the admin page's `admin-rhythm.preview.ts`): every person folded through
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

/**
 * The first instant of a shop day — the boundary's reader, handed in
 * (flatten-spec T3): a statistic, and the sample client, know a visit by its
 * day alone, so the visit is stamped with the start of its shop day. The
 * zone stays with the caller (`ZonedTimeSystem.startOfLocalDay` on the
 * shop's zone); this system reads none.
 */
export type StreakDayStart = (day: LocalDate) => UtcEpochMs;

/** A fold of nothing: no visit, no excuse, no booking, no pause, no grant. */
const NO_FACTS: StreakFacts = {
  visits: [],
  excused: [],
  bookings: [],
  pauses: [],
  grants: [],
};

/** How many visits the sample client makes on time before the due date they miss. */
const SAMPLE_VISITS_BEFORE_THE_MISS = 6;

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
  /** A fold of nothing — the facts of a person nothing is known of. */
  NO_FACTS,

  /**
   * Whether the two rules can be previewed from visit days alone. A rule
   * that counts by a list asks what a visit HELD, which the statistics do
   * not say: the preview is then unavailable, and nothing has to be read to
   * know it. The ONE qualifier check `estimate` makes too.
   */
  readsFacts(
    inForce: StreakQualifierRule,
    draft: StreakQualifierRule,
  ): boolean {
    return (
      inForce.streakQualifier === StreakQualifier.AnyVisit &&
      draft.streakQualifier === StreakQualifier.AnyVisit
    );
  },

  /**
   * One person's statistics as the projector's facts: every worked visit of
   * the last year counts, on its shop day, stamped with the first instant of
   * that day (`dayStart`, T3). Nothing is known of what the shop called off,
   * of a visit on the book or of a pause — that is why the preview is
   * labelled «приблизително».
   */
  factsOfStats(
    record: Pick<ClientStats, 'last365VisitsCompleted'>,
    dayStart: StreakDayStart,
  ): StreakFacts {
    const visits: StreakVisitFact[] = [];
    const worked = record.last365VisitsCompleted;
    for (let i = 0; i < worked.length; i++) {
      const { localDate } = worked[i] as VisitFact;
      visits.push({
        localDate,
        counted: true,
        utcEpochMs: dayStart(localDate),
      });
    }
    return { ...NO_FACTS, visits };
  },

  /**
   * One invented client's visits under a rule, ending yesterday: six visits
   * on time (enough to earn a protection under the recommended rule), then
   * ONE due date missed by a whole period and the visit that came after it.
   * The projector marks every visit and the due date nobody met, so the run
   * ends «kept, kept, kept, the miss, kept» and an open period: the track
   * the rule card draws (§2.6.1).
   *
   * On time is the newcomer's interval, which every later period of the same
   * rule is at least as long as. The late visit falls on the day the missed
   * due date would move to under a protection (twice the period a visit on
   * time opens): past the grace, so the miss is judged, and no later than a
   * protection forgives. Plain calendar arithmetic on the shop's day; each
   * visit is stamped with the first instant of its day (`dayStart`).
   */
  sampleFacts(
    rule: StreakRule,
    today: LocalDate,
    dayStart: StreakDayStart,
  ): StreakFacts {
    const onTime = StreakIntervalRule.daysFor(rule, null).days;
    const late = 2 * StreakIntervalRule.daysFor(rule, onTime).days;
    // Counted back from yesterday, the newest visit first: the late gap,
    // then the gaps on time.
    const daysAgo: number[] = [1];
    let ago = 1 + late;
    daysAgo.push(ago);
    for (let i = 0; i < SAMPLE_VISITS_BEFORE_THE_MISS - 1; i++) {
      ago += onTime;
      daysAgo.push(ago);
    }
    const visits: StreakVisitFact[] = [];
    for (let i = daysAgo.length - 1; i >= 0; i--) {
      const localDate = LocalDate.addDays(today, -(daysAgo[i] as number));
      visits.push({
        localDate,
        counted: true,
        utcEpochMs: dayStart(localDate),
      });
    }
    return { ...NO_FACTS, visits };
  },

  /**
   * The sample client's rhythm under a rule ({@link sampleFacts} through the
   * projector, `StreakSystem.project`): what the rule card's track draws.
   * `null` under a rule that is off — it judges nobody.
   */
  sampleRun(
    rule: StreakRule,
    today: LocalDate,
    dayStart: StreakDayStart,
  ): StreakState | null {
    return StreakSystem.project(
      StreakRule.DEFAULT_DEFINITION_ID,
      rule,
      StreakPreviewSystem.sampleFacts(rule, today, dayStart),
      today,
    );
  },

  /**
   * The estimate of moving from `inForce` to `draft`, over one person's
   * facts each (their visits judged by NO LIST: every worked visit
   * counts). Unavailable while either rule counts by a list
   * ({@link readsFacts}). On no `today` (`null`: the boundary was handed a
   * day that is no day) nobody is judged. No zone: a phase is read off day
   * numbers alone.
   */
  estimate(
    inForce: StreakRule,
    draft: StreakRule,
    clients: readonly StreakFacts[],
    today: LocalDate | null,
  ): StreakPreview {
    if (!StreakPreviewSystem.readsFacts(inForce, draft)) {
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

  /**
   * How far each standing's count moves from `before` to `after` (`after −
   * before`, per standing: positive gains, negative losses, zero none) —
   * the preview's deltas («+17», «−3»). `null` while either rule is off:
   * an off rule judges nobody, so there is no movement to state, only the
   * rule coming or going.
   */
  movement(
    before: StreakStandingCounts | null,
    after: StreakStandingCounts | null,
  ): StreakStandingCounts | null {
    if (before === null || after === null) return null;
    return {
      inRhythm: after.inRhythm - before.inRhythm,
      inGrace: after.inGrace - before.inGrace,
      broken: after.broken - before.broken,
    };
  },
} as const;
