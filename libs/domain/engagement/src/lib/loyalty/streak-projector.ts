import {
  DayKey,
  type ServiceCategoryId,
  type ServiceId,
  StreakDefinitionId,
  type StreakFacts as SystemFacts,
  StreakIntervalKind,
  StreakQualifierKind,
  type StreakRule,
  type StreakState as SystemState,
  StreakSystem,
  type StreakTrace as SystemTrace,
} from '@creativo/ecs-core';
import { IsoDate, LOYALTY_ZONE } from './loyalty-calendar';
import type { StreakState } from './projections';
import type { StreakDefinition, StreakExcuse } from './streak-definition';

/*
 * THE RHYTHM'S PROJECTOR — a thin shim since the ECS migration's Phase 2:
 * the fold is `StreakSystem.trace` (`@creativo/ecs-core`,
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
  return fromSystemTrace(
    StreakSystem.trace(
      StreakDefinitionId.of(definition.id),
      ruleOf(definition),
      factsOf(facts),
      DayKey.of(today),
      LOYALTY_ZONE,
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

/** The version as the system reads it: the class's figures, with the day as a day key. */
function ruleOf(definition: StreakDefinition): StreakRule {
  const props = definition.toProps();
  const qualifier = props.qualifier;
  const interval = props.interval;
  return {
    version: props.version,
    effectiveFromDayKey: DayKey.of(props.effectiveFrom),
    enabled: props.enabled,
    qualifier:
      qualifier.kind === 'services'
        ? {
            kind: StreakQualifierKind.Services,
            serviceIds: qualifier.serviceIds as readonly ServiceId[],
          }
        : qualifier.kind === 'categories'
          ? {
              kind: StreakQualifierKind.Categories,
              categoryIds:
                qualifier.categoryIds as readonly ServiceCategoryId[],
            }
          : { kind: StreakQualifierKind.AnyVisit },
    minGapDays: props.minGapDays,
    bookingHold: props.bookingHold,
    interval:
      interval.kind === 'fixed'
        ? { kind: StreakIntervalKind.Fixed, days: interval.days }
        : {
            kind: StreakIntervalKind.Personal,
            tolerancePct: interval.tolerancePct,
            minDays: interval.minDays,
            maxDays: interval.maxDays,
            fallbackDays: interval.fallbackDays,
          },
    graceDays: props.graceDays,
    riskLeadDays: props.riskLeadDays,
    protections: props.protections,
    excuses: props.excuses,
    clientPause: props.clientPause,
    repair: props.repair,
    onBreak: props.onBreak,
  };
}

/** Every field present: the instant in ms, a booking's absent id `null`. */
function factsOf(facts: StreakFacts): SystemFacts {
  return {
    visits: facts.visits.map((visit) => ({
      day: DayKey.of(visit.day),
      counted: visit.counted,
      atMs: visit.at === undefined ? null : visit.at.getTime(),
    })),
    excused: facts.excused.map((excused) => ({
      day: DayKey.of(excused.day),
      reason: excused.reason,
    })),
    bookings: facts.bookings.map((booking) => ({
      placedOn: DayKey.of(booking.placedOn),
      day: DayKey.of(booking.day),
      appointmentId: booking.appointmentId ?? null,
    })),
    pauses: facts.pauses.map((pause) => ({
      from: DayKey.of(pause.from),
      until: DayKey.of(pause.until),
      reason: pause.reason,
    })),
    grants: facts.grants.map((grant) => ({
      day: DayKey.of(grant.day),
      count: grant.count,
    })),
  };
}

/** The state as the legacy readers hold it: `lastQualifiedAt` a `Date`. */
function fromSystemState(state: SystemState): StreakState {
  return {
    streakId: state.streakId,
    definitionVersion: state.definitionVersion,
    phase: state.phase,
    current: state.current,
    best: state.best,
    lastQualifiedAt:
      state.lastQualifiedAtMs === null
        ? null
        : new Date(state.lastQualifiedAtMs),
    dueBy: state.dueBy,
    freezesBanked: state.freezesBanked,
    period: state.period,
    periods: state.periods,
    heldBy: state.heldBy,
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
