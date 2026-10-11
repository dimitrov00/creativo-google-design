import {
  AppointmentId,
  LocalDate,
  ServiceCategoryId,
  ServiceId,
  StreakDefinitionId,
  type TimeZone,
  UtcEpochMs,
  defect,
} from '@core/primitives';
import {
  FreezeReason,
  StreakExcuse as SystemExcuse,
  StreakIntervalRule,
  StreakIntervalSource as SystemIntervalSource,
  StreakOnBreak as SystemOnBreak,
  StreakPeriodMark as SystemPeriodMark,
  type StreakPeriodReason as SystemPeriodReason,
  StreakPhase as SystemPhase,
  StreakQualifierRule,
  type StreakRule,
  StreakState as SystemState,
} from '@core/components';
import {
  type StreakFacts as SystemFacts,
  StreakSystem,
  type StreakTrace as SystemTrace,
  ZonedTimeSystem,
} from '@core/systems';
import { IsoDate, LOYALTY_ZONE } from './loyalty-calendar';
import type {
  StreakPeriodFact as LegacyPeriodFact,
  StreakPhase as LegacyPhase,
  StreakState,
} from './projections';
import type {
  StreakDefinition,
  StreakExcuse,
  StreakOnBreak,
} from './streak-definition';
import type {
  StreakIntervalProps,
  StreakIntervalSource,
} from './streak-interval';
import type { StreakQualifierProps } from './streak-qualifier';

/*
 * THE RHYTHM'S PROJECTOR — a thin shim since the ECS migration's Phase 2:
 * the fold is `StreakSystem.trace` (`@core/systems`,
 * `streak.system.ts`), and this file only carries the legacy API across —
 * the `StreakDefinition` class in, the `Date`-carrying state out. The
 * private converters below are the whole of it.
 */

/** A worked visit of the person's, on the Sofia day of its first worked seat. */
export interface StreakVisitFact {
  readonly day: IsoDate;
  /** The rule's qualifier, already applied. A visit that does not count is no fact of the rhythm. */
  readonly counted: boolean;
  /**
   * When the visit began. Optional: `lastQualifiedAt` is this instant, or
   * the start of `day` in the shop's zone where a caller holds days only
   * (the admin's preview does).
   */
  readonly at?: Date;
}

/**
 * What is never the client's doing. The shop's three are a visit of
 * theirs it called off, dated by the visit's day; `closedDays` is ONE
 * day the shop was closed, no booking involved.
 */
export interface StreakExcusedFact {
  readonly day: IsoDate;
  readonly reason: StreakExcuse;
}

/**
 * A visit of the person's on the book. Leave out what the client
 * cancelled: a hold that was released is judged as if it never existed,
 * and the projector releases by itself a booking whose day passed with
 * neither a counted visit nor an excuse the rule accepts on it.
 */
export interface StreakBookingFact {
  readonly placedOn: IsoDate;
  readonly day: IsoDate;
  /**
   * Names the visit in `StreakState.heldBy`. A booking without one still
   * holds the clock; the state then names no visit.
   */
  readonly appointmentId?: string;
}

/** The account's pause (`pause`), or the client's own (`clientPause`), both days included. */
export interface StreakPauseFact {
  readonly from: IsoDate;
  readonly until: IsoDate;
  readonly reason: 'pause' | 'clientPause';
}

/** Protections given, not earned by the count: an achievement's award, the staff's «Дай защита». */
export interface StreakGrantFact {
  readonly day: IsoDate;
  readonly count: number;
}

export interface StreakFacts {
  readonly visits: readonly StreakVisitFact[];
  readonly excused: readonly StreakExcusedFact[];
  readonly bookings: readonly StreakBookingFact[];
  readonly pauses: readonly StreakPauseFact[];
  readonly grants: readonly StreakGrantFact[];
}

/**
 * The projection and what else the fold saw on the way: what the seed's
 * families read today and the engine's journal will.
 */
export interface StreakTrace {
  readonly state: StreakState | null;
  /** The personal best and the day of the visit that reached it («най-дълъг ритъм»). */
  readonly record: { readonly value: number; readonly on: IsoDate } | null;
  /**
   * The day the run in progress began; `null` while none is (no visit yet,
   * or the count was just lost). The state carries the same day
   * (`StreakState.runStartedOn`).
   */
  readonly runStartedOn: IsoDate | null;
  /**
   * The count each day it moved, oldest first: up with a visit that
   * counted, to nothing on the day a miss took it.
   */
  readonly counts: readonly {
    readonly on: IsoDate;
    readonly current: number;
  }[];
  /** The days a client came back: the second counted visit of a run that started over («Завръщане»). */
  readonly comebacks: readonly IsoDate[];
  /** The days on which the nightly judgement moved the phase: what the daily job would have written. */
  readonly judgedOn: readonly IsoDate[];
}

/** How many closed periods a state carries: what the longest track draws. */
export const STREAK_PERIODS_KEPT = 12;

/**
 * {@link projectStreak}, with what the fold saw on the way. A fact dated
 * after `today`, or by something that is no calendar day, is left out; a
 * rule that is switched off projects nothing (runs are held where they
 * stand, never erased: the state a reader holds stays as it is).
 */
export function traceStreak(
  definition: StreakDefinition,
  facts: StreakFacts,
  today: IsoDate,
): StreakTrace {
  // On a `today` that is no day nothing is judged: the trace of no run.
  const day = LocalDate.parse(today);
  if (!day.ok) return fromSystemTrace(NOTHING_TRACED);
  return fromSystemTrace(
    StreakSystem.trace(
      StreakDefinitionId.of(definition.id),
      ruleOf(definition),
      streakFactsReader()(facts),
      day.value,
    ),
  );
}

/**
 * One person's rhythm under `definition` as of `today`, or `null` before
 * their first counted visit (and under a rule that is switched off).
 * Pure: the same rule, facts and day are the same state, so a projection
 * can be thrown away and folded again.
 */
export function projectStreak(
  definition: StreakDefinition,
  facts: StreakFacts,
  today: IsoDate,
): StreakState | null {
  return traceStreak(definition, facts, today).state;
}

// ── The bridge: legacy class ↔ ecs-core struct (Phase 4 deletes it) ──────

/** The shop's zone as the brand: a constant IANA name, checked once. */
const LOYALTY_TIME_ZONE: TimeZone = (() => {
  const zone = ZonedTimeSystem.checkZone(LOYALTY_ZONE);
  return zone.ok ? zone.value : defect(`${LOYALTY_ZONE} is no zone`);
})();

/** The trace of no run — what the fold answers on a `today` that is no day. */
const NOTHING_TRACED: SystemTrace = {
  state: null,
  record: null,
  runStartedOn: null,
  counts: [],
  comebacks: [],
  judgedOn: [],
};

/** A class instant as the brand — every `Date` a fact carries is inside its window. */
function utcOf(at: Date): UtcEpochMs {
  const epochMs = at.getTime();
  const utc = UtcEpochMs.of(epochMs);
  return utc.ok ? utc.value : defect(`${epochMs} is not an instant`);
}

const SYSTEM_EXCUSE = {
  shopClosure: SystemExcuse.ShopClosure,
  barberAbsence: SystemExcuse.BarberAbsence,
  staffCancelled: SystemExcuse.StaffCancelled,
  closedDays: SystemExcuse.ClosedDays,
} as const satisfies Record<StreakExcuse, SystemExcuse>;

const SYSTEM_ON_BREAK = {
  restart: SystemOnBreak.Restart,
  hold: SystemOnBreak.Hold,
} as const satisfies Record<StreakOnBreak, SystemOnBreak>;

const SYSTEM_PAUSE = {
  pause: FreezeReason.Pause,
  clientPause: FreezeReason.ClientPause,
} as const satisfies Record<StreakPauseFact['reason'], FreezeReason>;

const LEGACY_FREEZE_REASON = {
  [FreezeReason.Freeze]: 'freeze',
  [FreezeReason.Pause]: 'pause',
  [FreezeReason.ClientPause]: 'clientPause',
  [FreezeReason.Excuse]: 'excuse',
} as const satisfies Record<
  FreezeReason,
  Extract<LegacyPhase, { kind: 'frozen' }>['reason']
>;

const LEGACY_PERIOD_MARK = {
  [SystemPeriodMark.Kept]: 'kept',
  [SystemPeriodMark.Protected]: 'protected',
  [SystemPeriodMark.Repaired]: 'repaired',
  [SystemPeriodMark.Missed]: 'missed',
} as const satisfies Record<SystemPeriodMark, LegacyPeriodFact['mark']>;

const LEGACY_PERIOD_REASON = {
  [FreezeReason.Freeze]: 'freeze',
  [FreezeReason.Pause]: 'pause',
  [FreezeReason.ClientPause]: 'clientPause',
  [SystemExcuse.ShopClosure]: 'shopClosure',
  [SystemExcuse.BarberAbsence]: 'barberAbsence',
  [SystemExcuse.StaffCancelled]: 'staffCancelled',
  [SystemExcuse.ClosedDays]: 'closedDays',
} as const satisfies Record<
  SystemPeriodReason,
  NonNullable<LegacyPeriodFact['reason']>
>;

const LEGACY_INTERVAL_SOURCE = {
  [SystemIntervalSource.Fixed]: 'fixed',
  [SystemIntervalSource.Personal]: 'personal',
  [SystemIntervalSource.Fallback]: 'fallback',
} as const satisfies Record<SystemIntervalSource, StreakIntervalSource>;

/**
 * The version as the system reads it: the class's figures, flat (every
 * part's figures prefixed by the part), its day a `LocalDate`, every tag
 * the dictionary's.
 */
function ruleOf(definition: StreakDefinition): StreakRule {
  const props = definition.toProps();
  const day = LocalDate.parse(props.effectiveFrom);
  return {
    version: props.version,
    // A version's day was checked by `StreakDefinition.create`.
    effectiveFromLocalDate: day.ok
      ? day.value
      : defect(`${props.effectiveFrom} is no calendar day`),
    enabled: props.enabled,
    ...qualifierOf(props.qualifier),
    minGapDays: props.minGapDays,
    bookingHoldEnabled: props.bookingHold.enabled,
    bookingHoldMaxDaysPastDue: props.bookingHold.maxDaysPastDue,
    ...intervalOf(props.interval),
    graceDays: props.graceDays,
    riskLeadDays: props.riskLeadDays,
    protectionsEnabled: props.protections.enabled,
    protectionsMaxBanked: props.protections.maxBanked,
    protectionsEarnEvery: props.protections.earnEvery,
    protectionsStartWith: props.protections.startWith,
    excuses: props.excuses.map((excuse) => SYSTEM_EXCUSE[excuse]),
    clientPauseEnabled: props.clientPause.enabled,
    clientPauseMaxDaysPerYear: props.clientPause.maxDaysPerYear,
    repairEnabled: props.repair.enabled,
    repairWindowDays: props.repair.windowDays,
    repairPerYear: props.repair.perYear,
    onBreak: SYSTEM_ON_BREAK[props.onBreak],
  };
}

function qualifierOf(qualifier: StreakQualifierProps): StreakQualifierRule {
  switch (qualifier.kind) {
    case 'services':
      return StreakQualifierRule.services(
        qualifier.serviceIds.map((id) => ServiceId.of(id)),
      );
    case 'categories':
      return StreakQualifierRule.categories(
        qualifier.categoryIds.map((id) => ServiceCategoryId.of(id)),
      );
    default:
      return StreakQualifierRule.anyVisit();
  }
}

function intervalOf(interval: StreakIntervalProps): StreakIntervalRule {
  return interval.kind === 'fixed'
    ? StreakIntervalRule.fixed(interval.days)
    : StreakIntervalRule.personal(
        interval.tolerancePct,
        interval.minDays,
        interval.maxDays,
        interval.fallbackDays,
      );
}

type SystemVisit = SystemFacts['visits'][number];
type SystemExcused = SystemFacts['excused'][number];
type SystemBooking = SystemFacts['bookings'][number];
type SystemPause = SystemFacts['pauses'][number];
type SystemGrant = SystemFacts['grants'][number];

/**
 * The legacy facts as the system reads them — every field present, a
 * booking's absent id `null`, the tags the dictionary's — through ONE
 * reader per fold: it places the first instant of each shop day once (a
 * visit with no instant of its own began then, T3 — the boundary's to
 * supply, the system reads no zone), however many people the caller folds
 * (a preview walks a whole book of clients).
 *
 * A fact dated by something that is no calendar day is LEFT OUT here: the
 * smart constructor is the only door from the stored text to a `LocalDate`
 * (Law 7.4), and the fold would leave such a fact out all the same.
 */
export function streakFactsReader(): (facts: StreakFacts) => SystemFacts {
  const dayStarts = new Map<LocalDate, UtcEpochMs>();
  const startOf = (day: LocalDate, at: Date | undefined): UtcEpochMs => {
    if (at !== undefined) return utcOf(at);
    let start = dayStarts.get(day);
    if (start === undefined) {
      start = ZonedTimeSystem.startOfLocalDay(day, LOYALTY_TIME_ZONE);
      dayStarts.set(day, start);
    }
    return start;
  };
  return (facts) => {
    const visits: SystemVisit[] = [];
    for (const visit of facts.visits) {
      const day = LocalDate.parse(visit.day);
      if (!day.ok) continue;
      visits.push({
        localDate: day.value,
        counted: visit.counted,
        utcEpochMs: startOf(day.value, visit.at),
      });
    }
    const excused: SystemExcused[] = [];
    for (const fact of facts.excused) {
      const day = LocalDate.parse(fact.day);
      if (!day.ok) continue;
      excused.push({
        localDate: day.value,
        reason: SYSTEM_EXCUSE[fact.reason],
      });
    }
    const bookings: SystemBooking[] = [];
    for (const booking of facts.bookings) {
      const placedOn = LocalDate.parse(booking.placedOn);
      const day = LocalDate.parse(booking.day);
      if (!placedOn.ok || !day.ok) continue;
      bookings.push({
        placedOn: placedOn.value,
        localDate: day.value,
        appointmentId:
          booking.appointmentId === undefined
            ? null
            : AppointmentId.of(booking.appointmentId),
      });
    }
    const pauses: SystemPause[] = [];
    for (const pause of facts.pauses) {
      const from = LocalDate.parse(pause.from);
      const until = LocalDate.parse(pause.until);
      if (!from.ok || !until.ok) continue;
      pauses.push({
        from: from.value,
        until: until.value,
        reason: SYSTEM_PAUSE[pause.reason],
      });
    }
    const grants: SystemGrant[] = [];
    for (const grant of facts.grants) {
      const day = LocalDate.parse(grant.day);
      if (!day.ok) continue;
      grants.push({ localDate: day.value, count: grant.count });
    }
    return { visits, excused, bookings, pauses, grants };
  };
}

/** The phase as the legacy readers hold it: one nested variant. */
function legacyPhaseOf(state: SystemState): LegacyPhase {
  switch (state.streakPhase) {
    case SystemPhase.AtRisk:
      return { kind: 'atRisk', dueBy: state.phaseDueBy };
    case SystemPhase.InGrace:
      return { kind: 'inGrace', graceUntil: state.phaseGraceUntil };
    case SystemPhase.Frozen:
      return {
        kind: 'frozen',
        until: state.phaseFrozenUntil,
        reason: LEGACY_FREEZE_REASON[state.phaseFreezeReason],
      };
    case SystemPhase.Broken:
      return {
        kind: 'broken',
        brokenAt: state.phaseBrokenOn,
        repairableUntil: state.phaseRepairableUntil,
      };
    default:
      return { kind: 'active' };
  }
}

/** The state as the legacy readers hold it: nested parts, lowercase tags, `lastQualifiedAt` a `Date`. */
function fromSystemState(state: SystemState): StreakState {
  const terms = SystemState.periodTerms(state);
  return {
    streakId: state.streakId,
    definitionVersion: state.definitionVersion,
    phase: legacyPhaseOf(state),
    current: state.current,
    best: state.best,
    lastQualifiedAt:
      state.lastQualifiedAtUtcMs === null
        ? null
        : new Date(state.lastQualifiedAtUtcMs),
    dueBy: state.dueBy,
    freezesBanked: state.freezesBanked,
    period:
      terms === null
        ? null
        : {
            intervalDays: terms.intervalDays,
            graceDays: terms.graceDays,
            source: LEGACY_INTERVAL_SOURCE[terms.source],
            habitDays: terms.habitDays,
          },
    periods: state.periods.map((period) => ({
      mark: LEGACY_PERIOD_MARK[period.streakPeriodMark],
      on: period.on,
      reason:
        period.periodReason === null
          ? null
          : LEGACY_PERIOD_REASON[period.periodReason],
    })),
    heldBy:
      state.heldByAppointmentId === null || state.heldOn === null
        ? null
        : { appointmentId: state.heldByAppointmentId, on: state.heldOn },
    runStartedOn: state.runStartedOn,
  };
}

function fromSystemTrace(trace: SystemTrace): StreakTrace {
  return {
    state: trace.state === null ? null : fromSystemState(trace.state),
    record: trace.record,
    runStartedOn: trace.runStartedOn,
    counts: trace.counts,
    comebacks: trace.comebacks,
    judgedOn: trace.judgedOn,
  };
}
