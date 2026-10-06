import type { LocalizedText } from '@creativo/domain/catalog';
import type { IsoDate } from './loyalty-calendar';
import type { StreakExcuse } from './streak-definition';
import type { StreakIntervalSource } from './streak-interval';

/**
 * ONE CLIENT'S LOYALTY, as the server projects it (client-card-redesign
 * §4.1). Flat readonly shapes on purpose, the `ClientStats` precedent: the
 * web app never mutates them, and what it derives from them — standings,
 * the closest levels, the tier track — crosses into the catalogue, so it
 * lives in the pure services of `standing.ts`, not on these.
 */

/** The account's tier — computed from visits, with an optional manual override. */
export interface TierState {
  readonly current: string;
  readonly definitionVersion: number;
  readonly since: Date;
  /** Visits in the qualifying window. */
  readonly qualifying: number;
  readonly next: string | null;
  readonly remaining: number | null;
  readonly override: {
    readonly tierId: string;
    readonly until: IsoDate | null;
    readonly source:
      | { readonly kind: 'award'; readonly awardKey: string }
      | { readonly kind: 'adjustment'; readonly adjustmentId: string };
  } | null;
}

/**
 * Where the rhythm stands. `atRisk` is coaching for staff, never a warning
 * to the client.
 *
 * - `inGrace`: past the due date and still safe until `graceUntil`: the
 *   last day of grace, or the day of the visit on the book that holds the
 *   period open (`StreakState.heldBy`).
 * - `frozen`: the open period runs on something other than a visit. A
 *   `pause` or a `clientPause` stops the clock `until` its last day; a
 *   used protection (`freeze`) and a miss that is the shop's (`excuse`)
 *   carry the period `until` its moved due date.
 * - `broken`: a period was missed on `brokenAt` (the day it was judged)
 *   and none is open. A visit until `repairableUntil` restores the run;
 *   when the rule restores nothing (the earn-back is off or used up, or a
 *   miss holds the count and nothing was lost), `repairableUntil` is the
 *   day BEFORE `brokenAt`, so no day reads as one.
 */
export type StreakPhase =
  | { readonly kind: 'active' }
  | { readonly kind: 'atRisk'; readonly dueBy: IsoDate }
  | { readonly kind: 'inGrace'; readonly graceUntil: IsoDate }
  | {
      readonly kind: 'frozen';
      readonly until: IsoDate;
      readonly reason: 'freeze' | 'pause' | 'clientPause' | 'excuse';
    }
  | {
      readonly kind: 'broken';
      readonly brokenAt: IsoDate;
      readonly repairableUntil: IsoDate;
    };

/**
 * One closed period of the rhythm, as the track draws it (client-card
 * revision 3 §4.2). `kept` and `repaired` are a counted visit, dated by
 * its day: the visit that kept the run, and the one that restored it after
 * a break. `protected` and `missed` are a due date nobody met, dated by
 * that due date: covered (`reason` says by what), or not.
 */
export interface StreakPeriodFact {
  readonly mark: 'kept' | 'protected' | 'repaired' | 'missed';
  readonly on: IsoDate;
  /** What covered a `protected` period; `null` on every other mark. */
  readonly reason: 'freeze' | StreakExcuse | 'pause' | 'clientPause' | null;
}

/**
 * The open period's terms, pinned when it opened: a later visit, or a
 * habit that moved since, never changes a due date already promised.
 * `habitDays` is the person's own interval, known only where the period's
 * length came from it (`source: 'personal'`).
 */
export interface StreakPeriodTerms {
  readonly intervalDays: number;
  readonly graceDays: number;
  readonly source: StreakIntervalSource;
  readonly habitDays: number | null;
}

/** A visit on the book that holds the open period past its due date. */
export interface StreakHold {
  readonly appointmentId: string;
  readonly on: IsoDate;
}

/** One rhythm's projection, recomputed from visit facts. */
export interface StreakState {
  readonly streakId: string;
  readonly definitionVersion: number;
  readonly phase: StreakPhase;
  readonly current: number;
  readonly best: number;
  readonly lastQualifiedAt: Date | null;
  readonly dueBy: IsoDate | null;
  readonly freezesBanked: number;
  /** `null` while no period is open (`broken`), and on a state written before the terms were pinned. */
  readonly period: StreakPeriodTerms | null;
  /** The newest twelve closed periods, oldest first. */
  readonly periods: readonly StreakPeriodFact[];
  /** `null` when nothing on the book holds the period. */
  readonly heldBy: StreakHold | null;
  /**
   * The Europe/Sofia day the run in progress began: the day of the first
   * visit `current` counts, however long ago (the track keeps twelve
   * periods, a run can be longer). A run that was restored began when it
   * first did. `null` while `current` is 0, and on a state written before
   * the day was kept.
   */
  readonly runStartedOn: IsoDate | null;
}

/** A stamp card, «4 от 10», titled by what its last stamp pays. */
export interface PunchCard {
  readonly ruleId: string;
  readonly filled: number;
  readonly size: number;
  readonly title: LocalizedText;
}

export const PERSONAL_RECORD_KINDS = [
  'longestRhythm',
  'mostVisitsInYear',
  'favouriteService',
  'firstVisit',
] as const;
export type PersonalRecordKind = (typeof PERSONAL_RECORD_KINDS)[number];

/**
 * A personal best, the «Рекорди» rail. `longestRhythm` dates the run's last
 * visit (`on`); `mostVisitsInYear` names the `year`; `favouriteService` the
 * service and its visits; `firstVisit` is `value` 1 on its day.
 */
export interface PersonalRecord {
  readonly kind: PersonalRecordKind;
  readonly value: number;
  readonly on: IsoDate | null;
  readonly year: number | null;
  readonly serviceId: string | null;
}

/**
 * `loyaltyAccounts/{uid}`. `balance` = lifetimeEarned + lifetimeAdjusted −
 * lifetimeSpent, negative only through a correction's compensation (the
 * account then owes), never clamped. `seq` is the last journal entry folded
 * in. No badge summary: the card reads the family progress documents and
 * derives the latest and closest levels, so the glance and the page agree.
 */
export interface LoyaltyAccount {
  readonly userId: string;
  readonly balance: number;
  readonly lifetimeEarned: number;
  readonly lifetimeAdjusted: number;
  readonly lifetimeSpent: number;
  readonly tier: TierState;
  /** Keyed by streak id. */
  readonly streaks: Readonly<Record<string, StreakState>>;
  readonly punchCards: readonly PunchCard[];
  readonly records: readonly PersonalRecord[];
  /** `null` while expiry is off, or when nothing can lapse. */
  readonly pointsExpiry: {
    readonly expiresOn: IsoDate;
    readonly noticeFrom: IsoDate;
  } | null;
  readonly seq: number;
  readonly version: number;
  readonly updatedAt: Date;
}

/** One earned level: when (the latest time, for a yearly one), how, and how often. */
export interface EarnedLevel {
  readonly level: number;
  readonly earnedAt: Date;
  readonly via: 'rule' | 'manual';
  readonly count: number;
}

/**
 * `loyaltyAccounts/{uid}/badgeProgress/{seriesId}` — absent = not started.
 * `value` is on the family's metric as of today (a windowed count falls);
 * `earned` lists each level once, lowest first.
 */
export interface BadgeProgress {
  readonly seriesId: string;
  readonly value: number;
  readonly earned: readonly EarnedLevel[];
}

/** `loyaltyAccounts/{uid}/seasonProgress/{seasonId}` — the season's track at a glance. */
export interface SeasonProgress {
  readonly seasonId: string;
  readonly trackValue: number;
  /** 0 = no level yet. */
  readonly trackLevel: number;
}

/**
 * A point-moving journal row as «Движение на точките» reads it: client-
 * visible, `effect.kind == 'points'`. The label is a copy key and its
 * non-personal params — never a note, never a name.
 */
export interface LedgerEntry {
  readonly id: string;
  readonly seq: number;
  readonly at: Date;
  readonly delta: number;
  readonly label: {
    readonly code: string;
    readonly params: Readonly<Record<string, string | number>>;
  };
  /** The entry this row compensates. */
  readonly reverses: string | null;
}

/**
 * What a client-visible journal row changed, as the activity feed
 * «Движение» reads it (client-card-revision-3 §4.7): five of the journal's
 * effects, each cut to what a row prints. `points` carries the balance once
 * the row is folded in. Streak, freeze, pause and visit-outcome rows are
 * never in the feed.
 */
export type ActivityEffect =
  | {
      readonly kind: 'points';
      readonly delta: number;
      readonly balanceAfter: number;
    }
  | { readonly kind: 'achievement'; readonly op: 'granted' | 'revoked' }
  | { readonly kind: 'tier'; readonly from: string; readonly to: string }
  | {
      readonly kind: 'reward';
      readonly op: 'granted' | 'reinstated' | 'revoked';
    }
  | {
      readonly kind: 'redemption';
      readonly op: 'redeemed' | 'reversed' | 'expired';
      readonly cost: number;
    };

/**
 * One row of the activity feed: the `LedgerEntry` widened past points. The
 * label is a copy key and its non-personal params, never a note, never a
 * name.
 */
export interface ActivityEntry {
  readonly id: string;
  readonly seq: number;
  readonly at: Date;
  /**
   * Entries of one event share it: a visit's seats, a level and its bonus,
   * a redemption and its grant.
   */
  readonly correlationId: string;
  readonly effect: ActivityEffect;
  readonly label: {
    readonly code: string;
    readonly params: Readonly<Record<string, string | number>>;
  };
  /** The entry this row compensates. */
  readonly reverses: string | null;
}

/**
 * The feed's filter, one per pill: `all` = every effect of `ActivityEffect`;
 * `points` = `points`; `rewards` = `reward` and `redemption`; `status` =
 * `tier`.
 */
export type ActivityKind = 'all' | 'points' | 'rewards' | 'status';
