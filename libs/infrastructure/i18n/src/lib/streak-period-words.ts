import {
  FreezeReason,
  StreakExcuse,
  StreakPeriodMark,
  type StreakPeriodReason,
} from '@core/components';

/*
 * The rhythm's closed-period words (UI residue cleanup, UR-3; the
 * `visit-list-words.ts` precedent) — what the `clientCard.rhythm.reason.*`
 * keys and the DS streak track's `mark` (`data-mark`, the period ids
 * `kept-2026-09-04`) have always spelled. The `StreakState` tags are
 * SCREAMING; the words are not. ONE table per dictionary, here because two
 * libs print them (the staff client card's wallet, the admin rhythm page).
 */

/** Why a protected period was covered, as its `clientCard.rhythm.reason.<word>` key segment. */
export const streakPeriodReasonWords = {
  [FreezeReason.Freeze]: 'freeze',
  [FreezeReason.Pause]: 'pause',
  [FreezeReason.ClientPause]: 'clientPause',
  [StreakExcuse.StaffCancelled]: 'staffCancelled',
  [StreakExcuse.BarberAbsence]: 'barberAbsence',
  [StreakExcuse.ShopClosure]: 'shopClosure',
  [StreakExcuse.ClosedDays]: 'closedDays',
} as const satisfies Record<StreakPeriodReason, string>;

/** A covering reason's word — `'freeze' | 'pause' | … | 'clientPause'`. */
export type StreakPeriodReasonWord =
  (typeof streakPeriodReasonWords)[StreakPeriodReason];

/**
 * A closed period's mark as the DS streak track draws it — the words of the
 * track's `UiStreakMark` (`libs/ui/patterns`), which an infrastructure lib
 * cannot name: each reader types its use against `UiStreakMark`, so a
 * drifted word is a compile error there.
 */
export const streakPeriodMarkWords = {
  [StreakPeriodMark.Kept]: 'kept',
  [StreakPeriodMark.Protected]: 'protected',
  [StreakPeriodMark.Repaired]: 'repaired',
  [StreakPeriodMark.Missed]: 'missed',
} as const satisfies Record<StreakPeriodMark, string>;
