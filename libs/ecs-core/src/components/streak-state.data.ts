import type {
  AppointmentId,
  StreakDefinitionId,
  LocalDate,
  UtcEpochMs,
} from '@core/primitives';
import type { StreakIntervalSource } from './streak-interval-source.data';
import type { StreakPeriodFact } from './streak-period-fact.data';
import type { StreakPeriodTerms } from './streak-period-terms.data';
import type { StreakPhaseState } from './streak-phase-state.data';

/**
 * One rhythm's projection, recomputed from visit facts — an element of
 * `loyaltyAccounts/{uid}.streaks[]`, each naming its `streakId`, FLAT (Law
 * 6): the phase is a variant slice intersected in; the open period's terms
 * are `period*` (all four `null` together while no period is open —
 * `BROKEN`); the visit on the book that holds the period is
 * `heldByAppointmentId` + `heldOn` (`null` together when nothing holds it).
 * `lastQualifiedAtUtcMs` is the last counted visit's start instant.
 */
export type StreakState = {
  readonly streakId: StreakDefinitionId;
  readonly definitionVersion: number;
  readonly current: number;
  /** Never decreases. */
  readonly best: number;
  readonly lastQualifiedAtUtcMs: UtcEpochMs | null;
  readonly dueBy: LocalDate | null;
  readonly freezesBanked: number;
  readonly periodIntervalDays: number | null;
  readonly periodGraceDays: number | null;
  readonly periodSource: StreakIntervalSource | null;
  readonly periodHabitDays: number | null;
  /** The newest {@link StreakState.PERIODS_KEPT} closed periods, oldest first. */
  readonly periods: readonly StreakPeriodFact[];
  readonly heldByAppointmentId: AppointmentId | null;
  readonly heldOn: LocalDate | null;
  /**
   * The shop-calendar day the run in progress began — the day of the first
   * visit `current` counts, however long ago. `null` while `current` is 0.
   */
  readonly runStartedOn: LocalDate | null;
} & StreakPhaseState;

export const StreakState = {
  /** How many closed periods a state carries: what the longest track draws. */
  PERIODS_KEPT: 12,

  /**
   * The state of one rhythm on an account, or `null` — the linear scan that
   * replaces today's `account.streaks[streakId]` map read (§3.1).
   */
  find<S extends Pick<StreakState, 'streakId'>>(
    states: readonly S[],
    streakId: StreakDefinitionId,
  ): S | null {
    for (let i = 0; i < states.length; i++) {
      const state = states[i] as S;
      if (state.streakId === streakId) return state;
    }
    return null;
  },

  /** The open period's terms as the projector pinned them, or `null` while no period is open. */
  periodTerms(
    state: Pick<
      StreakState,
      | 'periodIntervalDays'
      | 'periodGraceDays'
      | 'periodSource'
      | 'periodHabitDays'
    >,
  ): StreakPeriodTerms | null {
    return state.periodIntervalDays === null ||
      state.periodGraceDays === null ||
      state.periodSource === null
      ? null
      : {
          intervalDays: state.periodIntervalDays,
          graceDays: state.periodGraceDays,
          source: state.periodSource,
          habitDays: state.periodHabitDays,
        };
  },
} as const;
