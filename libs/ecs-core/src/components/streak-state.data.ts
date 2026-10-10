import type { AppointmentId } from '../entities/appointment.entity';
import type { StreakDefinitionId } from '../entities/streak-definition.entity';
import type { DayKey } from './day-key.data';
import type { StreakIntervalSource } from './streak-interval.data';
import type { StreakExcuse } from './streak-rule.data';

/** Where the rhythm stands, by kind — the stored `phase.kind` tags, unchanged. */
export const StreakPhaseKind = {
  Active: 'active',
  /** Coaching for staff, never a warning to the client. */
  AtRisk: 'atRisk',
  InGrace: 'inGrace',
  Frozen: 'frozen',
  Broken: 'broken',
} as const;
export type StreakPhaseKind =
  (typeof StreakPhaseKind)[keyof typeof StreakPhaseKind];

/**
 * What carries a period that runs on something other than a visit: a used
 * protection (`freeze`), the account's `pause`, the client's own
 * `clientPause`, or a miss that was the shop's (`excuse`).
 */
export const FreezeReason = {
  Freeze: 'freeze',
  Pause: 'pause',
  ClientPause: 'clientPause',
  Excuse: 'excuse',
} as const;
export type FreezeReason = (typeof FreezeReason)[keyof typeof FreezeReason];

/**
 * One closed period, as the track draws it: `kept` and `repaired` are a
 * counted visit, dated by its day; `protected` and `missed` a due date
 * nobody met, dated by that due date — covered, or not.
 */
export const StreakPeriodMark = {
  Kept: 'kept',
  Protected: 'protected',
  Repaired: 'repaired',
  Missed: 'missed',
} as const;
export type StreakPeriodMark =
  (typeof StreakPeriodMark)[keyof typeof StreakPeriodMark];

/** What covered a `protected` period: a protection, an excuse by name, or a pause — read from the two dictionaries, never a third. */
export type StreakPeriodReason =
  | typeof FreezeReason.Freeze
  | StreakExcuse
  | typeof FreezeReason.Pause
  | typeof FreezeReason.ClientPause;

/**
 * Where the rhythm stands. Every date is a shop-calendar day.
 *
 * - `inGrace`: past the due date and still safe until `graceUntil` — the
 *   last day of grace, or the day of the visit on the book that holds the
 *   period open (`StreakState.heldBy`).
 * - `frozen`: the open period runs on something other than a visit; a
 *   pause stops the clock `until` its last day, a protection or an excuse
 *   carries the period `until` its moved due date.
 * - `broken`: a period was missed on `brokenAt` (the day it was judged) and
 *   none is open. A visit until `repairableUntil` restores the run; when the
 *   rule restores nothing, `repairableUntil` is the day BEFORE `brokenAt`.
 */
export type StreakPhase =
  | StreakPhase.Active
  | StreakPhase.AtRisk
  | StreakPhase.InGrace
  | StreakPhase.Frozen
  | StreakPhase.Broken;

export const StreakPhase = {
  active(): StreakPhase.Active {
    return { kind: StreakPhaseKind.Active };
  },
  atRisk(dueBy: DayKey): StreakPhase.AtRisk {
    return { kind: StreakPhaseKind.AtRisk, dueBy };
  },
  inGrace(graceUntil: DayKey): StreakPhase.InGrace {
    return { kind: StreakPhaseKind.InGrace, graceUntil };
  },
  frozen(until: DayKey, reason: FreezeReason): StreakPhase.Frozen {
    return { kind: StreakPhaseKind.Frozen, until, reason };
  },
  broken(brokenAt: DayKey, repairableUntil: DayKey): StreakPhase.Broken {
    return { kind: StreakPhaseKind.Broken, brokenAt, repairableUntil };
  },
} as const;

/** One closed period of the rhythm (client-card revision 3 §4.2). */
export type StreakPeriodFact = {
  readonly mark: StreakPeriodMark;
  readonly on: DayKey;
  /** What covered a `protected` period; `null` on every other mark. */
  readonly reason: StreakPeriodReason | null;
};

/**
 * The open period's terms, pinned when it opened: a later visit, or a
 * habit that moved since, never changes a due date already promised.
 * `habitDays` is the person's own interval to one decimal (the only figure
 * that is not whole), known only where `source` is `personal`.
 */
export type StreakPeriodTerms = {
  readonly intervalDays: number;
  readonly graceDays: number;
  readonly source: StreakIntervalSource;
  readonly habitDays: number | null;
};

/** A visit on the book that holds the open period past its due date. */
export type StreakHold = {
  readonly appointmentId: AppointmentId;
  readonly on: DayKey;
};

/**
 * One rhythm's projection, recomputed from visit facts — an entry of
 * `loyaltyAccounts/{uid}.streaks[]` (`loyalty-document.ts:520-543`). The
 * stored map keyed by streak id becomes an ARRAY of these, each naming its
 * `streakId` (§2.6, §3.2: the one shape change of the account), and
 * `lastQualifiedAt` an instant in ms. Every field is present: a state
 * written before revision 3 read its four newest fields as absent; they
 * are `null`/`[]` now (absent is `null`).
 */
export type StreakState = {
  readonly streakId: StreakDefinitionId;
  readonly definitionVersion: number;
  readonly phase: StreakPhase;
  readonly current: number;
  /** Never decreases. */
  readonly best: number;
  readonly lastQualifiedAtMs: number | null;
  readonly dueBy: DayKey | null;
  readonly freezesBanked: number;
  /** `null` while no period is open (`broken`). */
  readonly period: StreakPeriodTerms | null;
  /** The newest {@link StreakState.PERIODS_KEPT} closed periods, oldest first. */
  readonly periods: readonly StreakPeriodFact[];
  /** `null` when nothing on the book holds the period. */
  readonly heldBy: StreakHold | null;
  /**
   * The shop-calendar day the run in progress began — the day of the first
   * visit `current` counts, however long ago. `null` while `current` is 0.
   */
  readonly runStartedOn: DayKey | null;
};

export const StreakState = {
  /** How many closed periods a state carries: what the longest track draws. */
  PERIODS_KEPT: 12,

  /**
   * The state of one rhythm on an account, or `null` — the linear scan that
   * replaces today's `account.streaks[streakId]` map read (§3.1).
   */
  find(
    states: readonly StreakState[],
    streakId: StreakDefinitionId,
  ): StreakState | null {
    for (let i = 0; i < states.length; i++) {
      const state = states[i] as StreakState;
      if (state.streakId === streakId) return state;
    }
    return null;
  },
} as const;

export namespace StreakPhase {
  export type Active = { readonly kind: typeof StreakPhaseKind.Active };
  export type AtRisk = {
    readonly kind: typeof StreakPhaseKind.AtRisk;
    readonly dueBy: DayKey;
  };
  export type InGrace = {
    readonly kind: typeof StreakPhaseKind.InGrace;
    readonly graceUntil: DayKey;
  };
  export type Frozen = {
    readonly kind: typeof StreakPhaseKind.Frozen;
    readonly until: DayKey;
    readonly reason: FreezeReason;
  };
  export type Broken = {
    readonly kind: typeof StreakPhaseKind.Broken;
    readonly brokenAt: DayKey;
    readonly repairableUntil: DayKey;
  };
}
