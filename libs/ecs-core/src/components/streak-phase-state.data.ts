import type { LocalDate } from '@core/primitives';

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
