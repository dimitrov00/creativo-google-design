import type { BadgeSeriesId, LocalDate, UtcEpochMs } from '@core/primitives';

/**
 * STANDING — what the card derives from one client's progress against the
 * catalogue (client-card-redesign §4.2, `standing.ts:25-43`). The shapes
 * StandingSystem answers in; the math (`earnedLevelCount`, `familiesIn`,
 * `closestLevels`, `recentLevelsByDay`) is the system's. Pass D (Law 1):
 * `ClosestLevel` is the system's own I/O (`standing.system.ts`), and the
 * scope page's filter is `FamilyScopeFilter` (`family-scope-filter.data.ts`). Numbers, ids and
 * shop days only — the Roman numeral a level is drawn with is a template
 * pipe, never a field.
 */

/** The levels earned on one shop-calendar day — one rail item, however many. */
export type EarnedDay = {
  readonly localDate: LocalDate;
  readonly levels: readonly EarnedDay.Level[];
};

export const EarnedDay = {
  of(localDate: LocalDate, levels: readonly EarnedDay.Level[]): EarnedDay {
    return { localDate, levels };
  },
  level(
    badgeSeriesId: BadgeSeriesId,
    level: number,
    earnedAtUtcMs: UtcEpochMs,
  ): EarnedDay.Level {
    return { badgeSeriesId, level, earnedAtUtcMs };
  },
} as const;

export namespace EarnedDay {
  export type Level = {
    readonly badgeSeriesId: BadgeSeriesId;
    readonly level: number;
    readonly earnedAtUtcMs: UtcEpochMs;
  };
}
