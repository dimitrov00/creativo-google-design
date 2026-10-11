import type {
  AppointmentId,
  StreakDefinitionId,
  LocalDate,
  UtcEpochMs,
} from '@core/primitives';
import type { StreakIntervalSource } from './streak-interval.data';
import type { StreakExcuse } from './streak-rule.data';

/** Where the rhythm stands — the state's discriminator `streakPhase`. */
export const StreakPhase = {
  Active: 'ACTIVE',
  /** Coaching for staff, never a warning to the client. */
  AtRisk: 'AT_RISK',
  InGrace: 'IN_GRACE',
  Frozen: 'FROZEN',
  Broken: 'BROKEN',
} as const;
export type StreakPhase = (typeof StreakPhase)[keyof typeof StreakPhase];

/**
 * What carries a period that runs on something other than a visit: a used
 * protection (`FREEZE`), the account's `PAUSE`, the client's own
 * `CLIENT_PAUSE`, or a miss that was the shop's (`EXCUSE`).
 */
export const FreezeReason = {
  Freeze: 'FREEZE',
  Pause: 'PAUSE',
  ClientPause: 'CLIENT_PAUSE',
  Excuse: 'EXCUSE',
} as const;
export type FreezeReason = (typeof FreezeReason)[keyof typeof FreezeReason];

/**
 * One closed period, as the track draws it — the field `streakPeriodMark`:
 * `KEPT` and `REPAIRED` are a counted visit, dated by its day; `PROTECTED`
 * and `MISSED` a due date nobody met, dated by that due date — covered, or
 * not.
 */
export const StreakPeriodMark = {
  Kept: 'KEPT',
  Protected: 'PROTECTED',
  Repaired: 'REPAIRED',
  Missed: 'MISSED',
} as const;
export type StreakPeriodMark =
  (typeof StreakPeriodMark)[keyof typeof StreakPeriodMark];

/** What covered a `PROTECTED` period: a protection, an excuse by name, or a pause — read from the two dictionaries, never a third. */
export type StreakPeriodReason =
  | typeof FreezeReason.Freeze
  | StreakExcuse
  | typeof FreezeReason.Pause
  | typeof FreezeReason.ClientPause;

/**
 * Where the rhythm stands — a variant SLICE of the state, every day a
 * shop-calendar day and every variant-only field prefixed `phase`.
 *
 * - `IN_GRACE`: past the due date and still safe until `phaseGraceUntil` —
 *   the last day of grace, or the day of the visit on the book that holds
 *   the period open (`StreakState.heldByAppointmentId`).
 * - `FROZEN`: the open period runs on something other than a visit; a pause
 *   stops the clock until `phaseFrozenUntil`, its last day, a protection or
 *   an excuse carries the period until its moved due date.
 * - `BROKEN`: a period was missed on `phaseBrokenOn` (the day it was judged)
 *   and none is open. A visit until `phaseRepairableUntil` restores the
 *   run; when the rule restores nothing, it is the day BEFORE
 *   `phaseBrokenOn`.
 */
export type StreakPhaseState =
  | StreakPhaseState.Active
  | StreakPhaseState.AtRisk
  | StreakPhaseState.InGrace
  | StreakPhaseState.Frozen
  | StreakPhaseState.Broken;

export const StreakPhaseState = {
  active(): StreakPhaseState.Active {
    return { streakPhase: StreakPhase.Active };
  },
  atRisk(phaseDueBy: LocalDate): StreakPhaseState.AtRisk {
    return { streakPhase: StreakPhase.AtRisk, phaseDueBy };
  },
  inGrace(phaseGraceUntil: LocalDate): StreakPhaseState.InGrace {
    return { streakPhase: StreakPhase.InGrace, phaseGraceUntil };
  },
  frozen(
    phaseFrozenUntil: LocalDate,
    phaseFreezeReason: FreezeReason,
  ): StreakPhaseState.Frozen {
    return {
      streakPhase: StreakPhase.Frozen,
      phaseFrozenUntil,
      phaseFreezeReason,
    };
  },
  broken(
    phaseBrokenOn: LocalDate,
    phaseRepairableUntil: LocalDate,
  ): StreakPhaseState.Broken {
    return {
      streakPhase: StreakPhase.Broken,
      phaseBrokenOn,
      phaseRepairableUntil,
    };
  },
} as const;

/** One closed period of the rhythm (client-card revision 3 §4.2) — an element of `periods`. */
export type StreakPeriodFact = {
  readonly streakPeriodMark: StreakPeriodMark;
  readonly on: LocalDate;
  /** What covered a `PROTECTED` period; `null` on every other mark. */
  readonly periodReason: StreakPeriodReason | null;
};

/**
 * The open period's terms, pinned when it opened — a system value (the
 * projector's own); the state stores them flat as `period*`. A later visit,
 * or a habit that moved since, never changes a due date already promised.
 * `habitDays` is the person's own interval to one decimal (the only figure
 * that is not whole), known only where `source` is `PERSONAL`.
 */
export type StreakPeriodTerms = {
  readonly intervalDays: number;
  readonly graceDays: number;
  readonly source: StreakIntervalSource;
  readonly habitDays: number | null;
};

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

export namespace StreakPhaseState {
  export type Active = { readonly streakPhase: typeof StreakPhase.Active };
  export type AtRisk = {
    readonly streakPhase: typeof StreakPhase.AtRisk;
    readonly phaseDueBy: LocalDate;
  };
  export type InGrace = {
    readonly streakPhase: typeof StreakPhase.InGrace;
    readonly phaseGraceUntil: LocalDate;
  };
  export type Frozen = {
    readonly streakPhase: typeof StreakPhase.Frozen;
    readonly phaseFrozenUntil: LocalDate;
    readonly phaseFreezeReason: FreezeReason;
  };
  export type Broken = {
    readonly streakPhase: typeof StreakPhase.Broken;
    readonly phaseBrokenOn: LocalDate;
    readonly phaseRepairableUntil: LocalDate;
  };
}
