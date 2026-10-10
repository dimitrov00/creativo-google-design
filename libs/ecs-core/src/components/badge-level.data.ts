import type { AwardSummary } from './gamification.data';
import type { LocalizedText } from './localized-text.data';

/**
 * One level of a medal family, drawn «I»…«V» (`badge-series.ts:30-48`). Each
 * level is its own once-rule under its own award key, so a summary counts
 * LEVELS and a level never pays twice. The family checks its levels
 * together (contiguous from 1, rising targets — LoyaltyCatalogSystem).
 */
export type BadgeLevel = {
  /** 1-based, drawn as a numeral by the template. */
  readonly level: number;
  /** The once-rule that awards this level. */
  readonly ruleId: string;
  /** On the family's metric; `null` = a one-off act, then the family's only level. */
  readonly target: number | null;
  /** «25 посещения с фейд» */
  readonly requirement: LocalizedText;
  /** `[]` = recognition only. */
  readonly awards: readonly AwardSummary[];
};

export const BadgeLevel = {
  /** A one-off act (no target): the family's only level. */
  isOneOff(level: BadgeLevel): boolean {
    return level.target === null;
  },
} as const;

/** How a level was earned — the stored `earned[].via` tags, unchanged. */
export const EarnedVia = {
  Rule: 'rule',
  Manual: 'manual',
} as const;
export type EarnedVia = (typeof EarnedVia)[keyof typeof EarnedVia];

/**
 * One earned level of a family's progress (`badgeProgress.earned[]`,
 * `loyalty-document.ts:597-604`, `earnedAt` → `earnedAtMs`): when — the
 * latest time, for a yearly one —, how, and how often.
 */
export type EarnedLevel = {
  readonly level: number;
  readonly earnedAtMs: number;
  readonly via: EarnedVia;
  /** How many times a repeatable level was earned; 1 otherwise. */
  readonly count: number;
};

/** A family for one client (§4.2). `earned` = at least one level. */
export const MedalState = {
  NotStarted: 'notStarted',
  InProgress: 'inProgress',
  Earned: 'earned',
} as const;
export type MedalState = (typeof MedalState)[keyof typeof MedalState];

/**
 * Where a family stands for one client — BadgeSystem's `standing` answer
 * (`BadgeSeries.standing`, `badge-series.ts:57-66`): the rim numeral is
 * `highestLevel` (0 = none, no numeral), the caption `value` / `target`.
 */
export type SeriesStanding = {
  readonly state: MedalState;
  readonly highestLevel: number;
  /** `null` = complete — a yearly family once earned, too. */
  readonly next: BadgeLevel | null;
  readonly value: number;
  readonly target: number | null;
};
