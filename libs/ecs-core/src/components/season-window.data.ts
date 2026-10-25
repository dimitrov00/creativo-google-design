import type { LocalDate } from '@core/primitives';

/**
 * A season's dated window in the shop's calendar, both ends inclusive — a
 * flat slice at the root of the season (`windowFrom`, `windowUntil`).
 */
export type SeasonWindow = {
  readonly windowFrom: LocalDate;
  readonly windowUntil: LocalDate;
};

export const SeasonWindow = {
  /**
   * How far ahead a window is announced, in whole days: the loyalty
   * policy's rule-change notice (R29). A season changes what earns, so the
   * client hears of it before it counts (was `Gamification.SEASON_NOTICE_DAYS`).
   */
  NOTICE_DAYS: 30,
} as const;
