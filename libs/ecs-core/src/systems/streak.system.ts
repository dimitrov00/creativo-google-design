import {
  Cadence,
  StreakInterval,
  StreakIntervalRule,
  StreakIntervalSource,
  StreakExcuse,
  StreakOnBreak,
  StreakRule,
  FreezeReason,
  StreakPeriodMark,
  StreakPhase,
  StreakPhaseState,
  StreakState,
  StreakCapsule,
  StreakOutlook,
  type StreakPeriodFact,
  type StreakPeriodTerms,
  type StreakTrackMark,
  StreakTrackMarkKind,
} from '@core/components';
import {
  AppointmentId,
  type StreakDefinitionId,
  LocalDate,
  type UtcEpochMs,
} from '@core/primitives';
import { ClientStatsSystem } from './client-stats.system';
import type { StreakRuleSummary } from './streak-rule.system';

/*
 * THE RHYTHM'S PROJECTOR (client-card revision 3 §4.2), ported from
 * the legacy engagement `streak-projector.ts:60-802` (deleted in Phase 4b): one
 * person's «Посещения в ритъм» under one version of the rule, folded from
 * facts. Pure: the same rule, facts and day are the same trace.
 *
 * The clock, stated once. Every date is a shop-calendar day.
 *
 * ```
 *        anchor                     due               graceEnd
 *  ───●────┼───────────────┬─────────┼──────────────────┼──────────▶ days
 *   visit               atRisk     inGrace            judged on
 *                    (due − lead)                     graceEnd + 1
 * ```
 *
 * A counted visit opens a period and pins its terms. The nightly
 * judgement runs at 00:00 and judges YESTERDAY, so a visit on the due
 * day, or on the last day of grace, keeps the run. On `graceEnd + 1`,
 * first match wins: a visit on the book holds the period open (P4); a
 * banked protection covers the due date and moves it one interval on (P8);
 * the miss — the count starts over, or holds (P12).
 *
 * What is not the client's doing moves the clock BEFORE the judgement and
 * so never reaches it: a visit the shop called off restarts the clock from
 * its day (P9), a paused day does not tick (P10), and a due date or a day
 * of grace on a closed day waits for an open one (P9 `closedDays`).
 *
 * Fixed by ethics, in code: a protection applies by itself and costs
 * nothing, the best run never decreases, and a no-show is not a fact here
 * at all: it keeps nothing and it breaks nothing.
 *
 * Days are whole numbers inside the fold (`LocalDate.toEpochDay`) and shop
 * days again on the way out (T8). No zone is read: every visit fact
 * carries its own start instant (the boundary supplies the start of the
 * shop day for a visit known by its day alone — T3), which the state
 * stamps as `lastQualifiedAtUtcMs`.
 */

/** What carries a client's own pause or the account's: the two pause reasons of `FreezeReason`. */
export type StreakPauseReason =
  typeof FreezeReason.Pause | typeof FreezeReason.ClientPause;

/** A worked visit of the person's, on the shop day of its first worked seat. */
export type StreakVisitFact = {
  readonly localDate: LocalDate;
  /** The rule's qualifier, already applied. A visit that does not count is no fact of the rhythm. */
  readonly counted: boolean;
  /**
   * When the visit began — always present: where a caller holds days only
   * (the admin's preview) the boundary hands the first instant of
   * `localDate` (`ZonedTimeSystem.startOfLocalDay`, T3).
   */
  readonly utcEpochMs: UtcEpochMs;
};

/**
 * What is never the client's doing. The shop's three are a visit of theirs
 * it called off, dated by the visit's day; `closedDays` is ONE day the shop
 * was closed, no booking involved.
 */
export type StreakExcusedFact = {
  readonly localDate: LocalDate;
  readonly reason: StreakExcuse;
};

/**
 * A visit of the person's on the book. Leave out what the client
 * cancelled: a hold that was released is judged as if it never existed,
 * and the projector releases by itself a booking whose day passed with
 * neither a counted visit nor an excuse the rule accepts on it.
 */
export type StreakBookingFact = {
  readonly placedOn: LocalDate;
  readonly localDate: LocalDate;
  /** Names the visit in `StreakState.heldByAppointmentId`; `null` (or blank) still holds the clock and names no visit. */
  readonly appointmentId: AppointmentId | null;
};

/** The account's pause (`pause`), or the client's own (`clientPause`), both days included. */
export type StreakPauseFact = {
  readonly from: LocalDate;
  readonly until: LocalDate;
  readonly reason: StreakPauseReason;
};

/** Protections given, not earned by the count: an achievement's award, the staff's «Дай защита». */
export type StreakGrantFact = {
  readonly localDate: LocalDate;
  readonly count: number;
};

export type StreakFacts = {
  readonly visits: readonly StreakVisitFact[];
  readonly excused: readonly StreakExcusedFact[];
  readonly bookings: readonly StreakBookingFact[];
  readonly pauses: readonly StreakPauseFact[];
  readonly grants: readonly StreakGrantFact[];
};

/** The count on a day it moved. */
export type StreakCount = { readonly on: LocalDate; readonly current: number };

/** The personal best and the day of the visit that reached it («най-дълъг ритъм»). */
export type StreakRecord = { readonly value: number; readonly on: LocalDate };

/**
 * The projection and what else the fold saw on the way: what the seed's
 * families read today and the engine's journal will.
 */
export type StreakTrace = {
  readonly state: StreakState | null;
  readonly record: StreakRecord | null;
  /** The day the run in progress began; `null` while none is (`StreakState.runStartedOn`). */
  readonly runStartedOn: LocalDate | null;
  /** The count each day it moved, oldest first: up with a visit, to nothing on the day a miss took it. */
  readonly counts: readonly StreakCount[];
  /** The days a client came back: the second counted visit of a run that started over («Завръщане»). */
  readonly comebacks: readonly LocalDate[];
  /** The days on which the nightly judgement moved the phase: what the daily job would have written. */
  readonly judgedOn: readonly LocalDate[];
};

/** The track as drawn: its marks, and whether the visits' captions can be one per month. */
export type StreakTrack = {
  readonly marks: readonly StreakTrackMark[];
  /** Every drawn visit has a month of its own: captions by month, else by day (DV12). */
  readonly byMonth: boolean;
};

/** What the card knows about today beside the projection. */
export type StreakTrackView = {
  readonly today: LocalDate;
  /** The client is in the chair today: the open mark is today's visit. */
  readonly inChairToday: boolean;
  /** Booking paused: the clock is frozen and no protection is drawn open. */
  readonly paused: boolean;
  /** The most marks drawn, the open one among them. */
  readonly limit: number;
};

/**
 * What the card knows beside the projection when it says where the rhythm
 * stands (`StreakSystem.outlook`). Zone-blind (D-11): the last counted
 * visit's shop day is converted by the caller from `lastQualifiedAtUtcMs`
 * in the location's zone.
 */
export type StreakOutlookView = {
  readonly today: LocalDate;
  /** The next due date once the visit in the chair counts (`StreakSystem.inChairDue`); `null` with nobody in the chair. */
  readonly inChairDue: LocalDate | null;
  /** Booking paused: the run is frozen where it stands. */
  readonly paused: boolean;
  /** The shop day of the last counted visit (`lastQualifiedAtUtcMs` in the location's zone); `null` with none. */
  readonly lastQualifiedOn: LocalDate | null;
};

/**
 * Where the rhythm stands, as the card's line, capsule and track sentence
 * say it — days, counts and tags; the words are the wallet's.
 */
export type StreakOutlookAnswer = {
  readonly streakOutlook: StreakOutlook;
  /**
   * The day the line names — the in-chair due date, the due date, the last
   * day to restore a broken run, the booked visit, the at-risk due date or
   * the end of grace; the capsule beside the figure names the same day.
   * `null` when the line names none.
   */
  readonly day: LocalDate | null;
  /**
   * The due date the track's sentence names («следващото до …»): the
   * in-chair due date, else the state's `dueBy` — only while the line
   * itself names a due date (`dueNamed`), else `null`.
   */
  readonly nextDue: LocalDate | null;
  /** The line names a due date (in the chair, healthy, at risk, in grace); a paused, frozen, broken, held or unstarted line names none. */
  readonly dueNamed: boolean;
  /** The capsule beside the figure; `null` while the run is healthy. */
  readonly streakCapsule: StreakCapsule | null;
  /** The capsule warns (a run that a visit can still keep or restore). */
  readonly urgent: boolean;
  /** `AT_RISK`: whole weeks since the last counted visit (`ClientStatsSystem.cadenceWeeks`), 0 with no such visit; 0 in every other outlook. */
  readonly weeksSinceLast: number;
  /** `FROZEN`: what carries the open period (the line's reason); `null` in every other outlook. */
  readonly phaseFreezeReason: FreezeReason | null;
};

/** The habit is the mean of this many of the newest counted gaps, known from the third counted visit on. */
const HABIT_GAPS = 6;
const HABIT_FROM_VISITS = 3;
/** «Веднъж на 12 месеца»: the earn-back's year, in days. */
const REPAIR_YEAR_DAYS = 365;

/** What a step of the fold is — its rank in the order a day takes them (numbers: the fold sorts by them). */
const StepKind = { Excuse: 0, Visit: 1, Grant: 2 } as const;
type StepKind = (typeof StepKind)[keyof typeof StepKind];

/** A fact on the fold's own clock: days as whole numbers. */
type Step = {
  readonly stepKind: StepKind;
  readonly day: number;
  readonly reason: StreakExcuse | null;
  readonly utcMs: UtcEpochMs | null;
  readonly count: number;
};

type Pause = {
  readonly from: number;
  readonly until: number;
  readonly reason: StreakPauseReason;
};

type Booking = {
  readonly placedOn: number;
  readonly day: number;
  readonly appointmentId: AppointmentId | null;
};

/** What moved the clock in the client's favour: an excuse the rule accepts, or a pause. */
type Carrier = StreakExcuse | StreakPauseReason;

/** The due date a carrier moved, until the day it would have been judged. */
type Cover = {
  readonly due: number;
  readonly graceEnd: number;
  readonly reason: Carrier;
};

/**
 * One person's run under one rule — the legacy `StreakRun` class as a plain
 * record, mutated only inside the one `trace` call that made it.
 */
type Run = {
  readonly rule: StreakRule;
  readonly closed: ReadonlySet<number>;
  readonly pauses: readonly Pause[];
  /** By day; only what can hold a period. */
  readonly bookings: readonly Booking[];
  current: number;
  best: number;
  bestOn: number | null;
  banked: number;
  counted: number;
  lastDay: number | null;
  lastUtcMs: UtcEpochMs | null;
  runStartedOn: number | null;
  /** The day the open period counts from. */
  anchor: number | null;
  terms: StreakPeriodTerms | null;
  cover: Cover | null;
  /** The open period is drawn as covered already: a period is covered once. */
  covered: boolean;
  /** What the open period runs on, when it is not a visit. */
  carriedBy: FreezeReason | null;
  brokenOn: number | null;
  brokenRun: number;
  comebackArmed: boolean;
  jobDay: number | null;
  phaseKind: StreakPhase | null;
  stretched: boolean;
  readonly repairs: number[];
  readonly gaps: number[];
  readonly marks: StreakPeriodFact[];
  readonly counts: StreakCount[];
  readonly comebacks: LocalDate[];
  readonly judgedOn: LocalDate[];
};

/** The visit on the book that holds the open period, on the fold's way out. */
type Held = { readonly appointmentId: AppointmentId; readonly on: LocalDate };

function isShopExcuse(reason: StreakExcuse): boolean {
  for (let i = 0; i < StreakRule.SHOP_EXCUSES.length; i++) {
    if (StreakRule.SHOP_EXCUSES[i] === reason) return true;
  }
  return false;
}

function emptyTrace(): StreakTrace {
  return {
    state: null,
    record: null,
    runStartedOn: null,
    counts: [],
    comebacks: [],
    judgedOn: [],
  };
}

/**
 * The pauses that stop the clock. The account's pause always does (a pause
 * freezes the rhythm, it never zeroes it). The client's own does where the
 * rule allows one, for as many days as the allowance has left in the 365
 * days before it starts: the days past the allowance tick.
 */
function pausesOf(
  rule: StreakRule,
  facts: readonly StreakPauseFact[],
): Pause[] {
  const sound: Pause[] = [];
  for (let i = 0; i < facts.length; i++) {
    const pause = facts[i] as StreakPauseFact;
    if (
      !LocalDate.is(pause.from) ||
      !LocalDate.is(pause.until) ||
      pause.until < pause.from
    ) {
      continue;
    }
    sound.push({
      from: LocalDate.toEpochDay(pause.from),
      until: LocalDate.toEpochDay(pause.until),
      reason: pause.reason,
    });
  }
  sound.sort((a, b) => a.from - b.from || a.until - b.until);

  const pauses: Pause[] = [];
  for (let i = 0; i < sound.length; i++) {
    const pause = sound[i] as Pause;
    if (pause.reason === FreezeReason.Pause) pauses.push(pause);
  }
  if (!rule.clientPauseEnabled) return pauses;

  const granted: Pause[] = [];
  for (let i = 0; i < sound.length; i++) {
    const pause = sound[i] as Pause;
    if (pause.reason !== FreezeReason.ClientPause) continue;
    const yearFrom = pause.from - REPAIR_YEAR_DAYS;
    let used = 0;
    for (let k = 0; k < granted.length; k++) {
      const earlier = granted[k] as Pause;
      used += Math.max(
        0,
        Math.min(earlier.until, pause.from - 1) -
          Math.max(earlier.from, yearFrom) +
          1,
      );
    }
    const allowed = Math.min(
      pause.until - pause.from + 1,
      rule.clientPauseMaxDaysPerYear - used,
    );
    if (allowed <= 0) continue;
    granted.push({
      from: pause.from,
      until: pause.from + allowed - 1,
      reason: pause.reason,
    });
  }
  for (let i = 0; i < granted.length; i++) pauses.push(granted[i] as Pause);
  return pauses;
}

// ── The clock ──────────────────────────────────────────────────────────────

/** A period opens on `anchor`, on the terms that are pinned. */
function open(run: Run, anchor: number): void {
  run.anchor = anchor;
  run.cover = null;
  run.covered = false;
  run.carriedBy = null;
}

/** The terms of the period that opens now (P5): the rule's one number, the person's habit, or the newcomer's default. */
function termsNow(run: Run): StreakPeriodTerms {
  const { rule } = run;
  const known =
    rule.streakInterval === StreakInterval.Personal &&
    run.counted >= HABIT_FROM_VISITS &&
    run.gaps.length > 0;
  let habit: number | null = null;
  if (known) {
    const from = Math.max(0, run.gaps.length - HABIT_GAPS);
    let sum = 0;
    for (let i = from; i < run.gaps.length; i++) sum += run.gaps[i] as number;
    // One decimal — the card's cadence and the habit share ONE mean (OR-46).
    habit = Cadence.meanDays(sum, run.gaps.length - from);
  }
  const { days, source } = StreakIntervalRule.daysFor(rule, habit);
  return {
    intervalDays: days,
    graceDays: rule.graceDays,
    source,
    habitDays: source === StreakIntervalSource.Personal ? habit : null,
  };
}

function nominalDue(run: Run): number {
  return (run.anchor ?? 0) + (run.terms?.intervalDays ?? 0);
}

/** The due date: a cadence after the anchor, on the first day the shop is open. */
function due(run: Run): number {
  let at = nominalDue(run);
  while (run.closed.has(at)) at += 1;
  return at;
}

/** The last day of grace: grace counts the days the shop is open. */
function graceEnd(run: Run, dueDay: number): number {
  let end = dueDay;
  let left = run.terms?.graceDays ?? 0;
  while (left > 0) {
    end += 1;
    if (!run.closed.has(end)) left -= 1;
  }
  return end;
}

function pauseOn(run: Run, day: number): Pause | null {
  for (let i = 0; i < run.pauses.length; i++) {
    const pause = run.pauses[i] as Pause;
    if (pause.from <= day && day <= pause.until) return pause;
  }
  return null;
}

/**
 * The days a pause that is running on `day` still has to go: the due date
 * a state promises counts them in, so it does not creep a day later with
 * every day of the pause.
 */
function pausedAfter(run: Run, day: number): number {
  if (pauseOn(run, day) === null) return 0;
  let ahead = 0;
  while (pauseOn(run, day + ahead + 1) !== null) ahead += 1;
  return ahead;
}

/**
 * P4. The visit on the book that holds the period on `day`: placed before
 * the period's grace ran out, still ahead, and starting no later than the
 * rule allows past the due date.
 */
function holdOn(
  run: Run,
  day: number,
  dueDay: number,
  end: number,
  from: number,
): Booking | null {
  const { rule } = run;
  if (!rule.bookingHoldEnabled) return null;
  const latest = dueDay + rule.bookingHoldMaxDaysPastDue;
  const placedBy = Math.min(day, end);
  // `bookings` is sorted by (day, placedOn): the first booking on or after
  // `from` is found by bisection, and the walk stops past `latest` — the
  // same first match a scan from the start would return.
  const { bookings } = run;
  let lo = 0;
  let hi = bookings.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if ((bookings[mid] as Booking).day < from) lo = mid + 1;
    else hi = mid;
  }
  for (let i = lo; i < bookings.length; i++) {
    const booking = bookings[i] as Booking;
    if (booking.day > latest) break;
    if (booking.placedOn <= placedBy) return booking;
  }
  return null;
}

/** The visit the state names: the one ahead that the rule lets hold the open period. */
function heldOn(run: Run, today: number): Held | null {
  if (run.anchor === null) return null;
  // A booking for today is the visit that counted today, not one ahead.
  const from = run.lastDay === today ? today + 1 : today;
  const dueDay = due(run);
  const hold = holdOn(run, today, dueDay, graceEnd(run, dueDay), from);
  return hold === null || hold.appointmentId === null
    ? null
    : {
        appointmentId: hold.appointmentId,
        on: LocalDate.fromEpochDay(hold.day),
      };
}

/** P11. Inside the window of the break, and the year's earn-backs not used up. */
function repairableOn(run: Run, brokenOn: number, day: number): boolean {
  const { rule } = run;
  if (!rule.repairEnabled || day - brokenOn > rule.repairWindowDays) {
    return false;
  }
  let used = 0;
  for (let i = 0; i < run.repairs.length; i++) {
    if (day - (run.repairs[i] as number) < REPAIR_YEAR_DAYS) used += 1;
  }
  return used < rule.repairPerYear;
}

function phaseOn(run: Run, day: number): StreakPhaseState {
  const { rule } = run;
  if (run.brokenOn !== null) {
    const lastDay = run.brokenOn + rule.repairWindowDays;
    const restores =
      rule.onBreak === StreakOnBreak.Restart &&
      repairableOn(run, run.brokenOn, lastDay);
    return StreakPhaseState.broken(
      LocalDate.fromEpochDay(run.brokenOn),
      LocalDate.fromEpochDay(restores ? lastDay : run.brokenOn - 1),
    );
  }
  if (run.anchor === null) return StreakPhaseState.active();
  const pause = pauseOn(run, day);
  if (pause !== null)
    return StreakPhaseState.frozen(
      LocalDate.fromEpochDay(pause.until),
      pause.reason,
    );
  const dueDay = due(run);
  if (day <= dueDay) {
    if (run.carriedBy !== null) {
      return StreakPhaseState.frozen(
        LocalDate.fromEpochDay(dueDay),
        run.carriedBy,
      );
    }
    return dueDay - day <= rule.riskLeadDays
      ? StreakPhaseState.atRisk(LocalDate.fromEpochDay(dueDay))
      : StreakPhaseState.active();
  }
  const end = graceEnd(run, dueDay);
  const hold = day > end ? holdOn(run, day, dueDay, end, day) : null;
  return StreakPhaseState.inGrace(LocalDate.fromEpochDay(hold?.day ?? end));
}

/**
 * {@link phaseOn}'s kind alone — the fold's hot path asks it once per
 * calendar day, so it builds no phase, formats no day key and looks up no
 * hold (the in-grace hold only DATES that phase). `knownDue` is the open
 * period's due date when the caller already has it for the run as it
 * stands, else `null`.
 */
function phaseKindOn(
  run: Run,
  day: number,
  knownDue: number | null,
): StreakPhase {
  if (run.brokenOn !== null) return StreakPhase.Broken;
  if (run.anchor === null) return StreakPhase.Active;
  if (pauseOn(run, day) !== null) return StreakPhase.Frozen;
  const dueDay = knownDue ?? due(run);
  if (day <= dueDay) {
    if (run.carriedBy !== null) return StreakPhase.Frozen;
    return dueDay - day <= run.rule.riskLeadDays
      ? StreakPhase.AtRisk
      : StreakPhase.Active;
  }
  return StreakPhase.InGrace;
}

/** Remembers the deadline a carrier is about to move: the FIRST of a period, the one it would have been judged by. */
function coverBy(run: Run, reason: Carrier): void {
  if (run.cover !== null || run.covered) return;
  const dueDay = due(run);
  run.cover = { due: dueDay, graceEnd: graceEnd(run, dueDay), reason };
}

/** Nobody came and nothing on the book holds the period: a protection covers it, or it is the miss. */
function miss(run: Run, day: number, dueDay: number): void {
  if (run.banked > 0) {
    run.banked -= 1;
    run.marks.push({
      streakPeriodMark: StreakPeriodMark.Protected,
      on: LocalDate.fromEpochDay(dueDay),
      periodReason: FreezeReason.Freeze,
    });
    // The due date it covered closes a period, and the next one opens on it.
    open(run, dueDay);
    run.carriedBy = FreezeReason.Freeze;
    return;
  }
  run.marks.push({
    streakPeriodMark: StreakPeriodMark.Missed,
    on: LocalDate.fromEpochDay(dueDay),
    periodReason: null,
  });
  run.brokenOn = day;
  run.brokenRun = run.current;
  if (run.rule.onBreak === StreakOnBreak.Restart) {
    run.current = 0;
    run.counts.push({ on: LocalDate.fromEpochDay(day), current: 0 });
  }
  run.cover = null;
  run.carriedBy = null;
}

/**
 * A period that outlived its own deadline is drawn as covered, once, by
 * what carried it: the excuse or the pause that moved its due date, or
 * the closed days that made it wait.
 */
function draw(run: Run, day: number, end: number): void {
  if (run.covered) return;
  const { cover } = run;
  if (cover !== null) {
    if (day <= cover.graceEnd) return;
    run.marks.push({
      streakPeriodMark: StreakPeriodMark.Protected,
      on: LocalDate.fromEpochDay(cover.due),
      periodReason: cover.reason,
    });
    run.cover = null;
    run.covered = true;
    // A pause freezes the run while it lasts and no longer: once it is
    // over the period is an open one like any other, its due date moved.
    if (
      cover.reason !== FreezeReason.Pause &&
      cover.reason !== FreezeReason.ClientPause
    ) {
      run.carriedBy = FreezeReason.Excuse;
    }
    return;
  }
  const nominal = nominalDue(run);
  const nominalEnd = nominal + (run.terms?.graceDays ?? 0);
  if (end > nominalEnd && day > nominalEnd) {
    // Closed days made the deadline wait, and the wait is now in use.
    run.marks.push({
      streakPeriodMark: StreakPeriodMark.Protected,
      on: LocalDate.fromEpochDay(nominal),
      periodReason: StreakExcuse.ClosedDays,
    });
    run.covered = true;
    run.carriedBy = FreezeReason.Excuse;
  }
}

/** P10. A paused day does not tick: the period that is open waits a day. */
function pauseDay(run: Run, day: number): void {
  if (run.anchor === null || run.brokenOn !== null) return;
  const pause = pauseOn(run, day);
  if (pause === null) return;
  coverBy(run, pause.reason);
  run.anchor += 1;
}

/** The nightly judgement on `day`: it judges the day before. */
function judge(run: Run, day: number): void {
  // The due date, worked out once: reused for the phase while the
  // judgement left the period where it was (a miss or a paused day moves
  // its anchor; nothing in a judgement changes its terms).
  let knownDue: number | null = null;
  if (run.anchor !== null && run.brokenOn === null) {
    const anchor = run.anchor;
    const dueDay = due(run);
    const end = graceEnd(run, dueDay);
    if (day > end && holdOn(run, day, dueDay, end, day) === null) {
      miss(run, day, dueDay);
    } else {
      draw(run, day, end);
    }
    pauseDay(run, day);
    if (run.anchor === anchor) knownDue = dueDay;
  }
  const kind = phaseKindOn(run, day, knownDue);
  if (kind !== run.phaseKind) {
    run.phaseKind = kind;
    run.judgedOn.push(LocalDate.fromEpochDay(day));
  }
}

/** Every nightly judgement up to and including `day`'s: it runs before that day's facts. */
function advance(run: Run, day: number): void {
  if (run.jobDay === null) return;
  while (run.jobDay < day) {
    run.jobDay += 1;
    judge(run, run.jobDay);
  }
}

/** P8. Banked up to the reserve's cap; nothing while protections are off. */
function bank(run: Run, count: number): void {
  const { rule } = run;
  if (!rule.protectionsEnabled || count <= 0) return;
  run.banked = Math.max(
    run.banked,
    Math.min(rule.protectionsMaxBanked, run.banked + count),
  );
}

/** A counted visit: it extends, restores or restarts the run, or is the same haircut again. */
function visit(run: Run, day: number, utcMs: UtcEpochMs | null): void {
  const { rule } = run;
  if (
    run.lastDay !== null &&
    run.brokenOn === null &&
    day - run.lastDay < rule.minGapDays
  ) {
    // P3. The same haircut, fixed up: the due date moves, the count does not.
    open(run, Math.max(day, run.anchor ?? day));
    run.phaseKind = phaseKindOn(run, day, null);
    return;
  }

  let mark: StreakPeriodMark = StreakPeriodMark.Kept;
  if (run.brokenOn === null) {
    run.current += 1;
  } else if (rule.onBreak === StreakOnBreak.Hold) {
    // P12. Nothing was lost, so nothing is restored: the count goes on.
    run.current += 1;
  } else if (repairableOn(run, run.brokenOn, day)) {
    // P11. The earn-back: the run is what it was, and one more.
    run.current = run.brokenRun + 1;
    run.repairs.push(day);
    mark = StreakPeriodMark.Repaired;
  } else {
    run.current = 1;
    run.comebackArmed = true;
  }
  run.brokenOn = null;
  run.counts.push({ on: LocalDate.fromEpochDay(day), current: run.current });
  if (run.current === 1 || run.runStartedOn === null) run.runStartedOn = day;
  if (run.comebackArmed && run.current === 2) {
    run.comebackArmed = false;
    run.comebacks.push(LocalDate.fromEpochDay(day));
  }

  // P8. What a run starts with is given once, with the first visit on
  // record: a restart does not re-grant it.
  if (run.counted === 0) bank(run, rule.protectionsStartWith);
  if (run.current % rule.protectionsEarnEvery === 0) bank(run, 1);
  if (run.current > run.best) {
    run.best = run.current;
    run.bestOn = day;
  }

  // The habit: a gap the shop stretched says nothing about the person.
  if (run.lastDay !== null && !run.stretched && day > run.lastDay) {
    run.gaps.push(day - run.lastDay);
  }
  run.stretched = false;
  run.counted += 1;
  run.lastDay = day;
  run.lastUtcMs = utcMs;

  run.terms = termsNow(run);
  open(run, day);
  run.marks.push({
    streakPeriodMark: mark,
    on: LocalDate.fromEpochDay(day),
    periodReason: null,
  });
  run.jobDay = day;
  run.phaseKind = phaseKindOn(run, day, null);
}

/**
 * P9. A visit the shop called off: the client was in rhythm, so the clock
 * restarts from its day. The period it moved is drawn as covered only if
 * its own deadline then passes without a visit: an excuse nobody needed is
 * not a mark.
 */
function excuse(run: Run, day: number, reason: StreakExcuse): void {
  if (isShopExcuse(reason)) run.stretched = true;
  if (!StreakRule.isExcused(run.rule, reason)) return;
  if (run.anchor === null || run.brokenOn !== null || day <= run.anchor) return;
  coverBy(run, reason);
  run.anchor = day;
}

/** The day the run in progress began, or `null` while the count is nothing. */
function startedOn(run: Run): LocalDate | null {
  return run.current === 0 || run.runStartedOn === null
    ? null
    : LocalDate.fromEpochDay(run.runStartedOn);
}

/** The account's state as of `today`, or `null` before any counted visit — flat (Law 6). */
function stateOn(
  run: Run,
  streakId: StreakDefinitionId,
  today: number,
): StreakState | null {
  if (run.lastDay === null) return null;
  const isOpen = run.brokenOn === null;
  const periods = run.marks.slice(
    Math.max(0, run.marks.length - StreakState.PERIODS_KEPT),
  );
  const terms = isOpen ? run.terms : null;
  const held = isOpen ? heldOn(run, today) : null;
  return {
    streakId,
    definitionVersion: run.rule.version,
    ...phaseOn(run, today),
    current: run.current,
    best: run.best,
    lastQualifiedAtUtcMs: run.lastUtcMs,
    dueBy: isOpen
      ? LocalDate.fromEpochDay(due(run) + pausedAfter(run, today))
      : null,
    freezesBanked: run.banked,
    periodIntervalDays: terms === null ? null : terms.intervalDays,
    periodGraceDays: terms === null ? null : terms.graceDays,
    periodSource: terms === null ? null : terms.source,
    periodHabitDays: terms === null ? null : terms.habitDays,
    periods,
    heldByAppointmentId: held === null ? null : held.appointmentId,
    heldOn: held === null ? null : held.on,
    runStartedOn: startedOn(run),
  };
}

function newRun(
  rule: StreakRule,
  closed: ReadonlySet<number>,
  pauses: readonly Pause[],
  bookings: readonly Booking[],
): Run {
  return {
    rule,
    closed,
    pauses,
    bookings,
    current: 0,
    best: 0,
    bestOn: null,
    banked: 0,
    counted: 0,
    lastDay: null,
    lastUtcMs: null,
    runStartedOn: null,
    anchor: null,
    terms: null,
    cover: null,
    covered: false,
    carriedBy: null,
    brokenOn: null,
    brokenRun: 0,
    comebackArmed: false,
    jobDay: null,
    phaseKind: null,
    stretched: false,
    repairs: [],
    gaps: [],
    marks: [],
    counts: [],
    comebacks: [],
    judgedOn: [],
  };
}

/** The blank or untrimmed name of a booking's visit, as the state names it: trimmed, `null` when blank. */
function appointmentIdOf(raw: AppointmentId | null): AppointmentId | null {
  if (raw === null) return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? AppointmentId.of(trimmed) : null;
}

/**
 * The fold itself: every fact up to `today`, every nightly judgement up to
 * and including today's — the run as it stands, for the state or for the
 * phase alone. `null` under a rule that is off or a `today` that is no day.
 */
function foldRun(
  rule: StreakRule,
  facts: StreakFacts,
  today: LocalDate,
): Run | null {
  if (!rule.enabled || !LocalDate.is(today)) return null;
  const now = LocalDate.toEpochDay(today);
  // A real shop day (`LocalDate.is`, allocation-free) — a stored fact may
  // carry a corrupt one, which the fold leaves out.
  const past = (day: LocalDate): boolean => LocalDate.is(day) && day <= today;

  const steps: Step[] = [];
  const closed = new Set<number>();
  /** The days a booking ended the way the rule keeps: a counted visit, or a visit the shop called off. */
  const resolved = new Set<number>();
  for (let i = 0; i < facts.visits.length; i++) {
    const fact = facts.visits[i] as StreakVisitFact;
    if (!fact.counted || !past(fact.localDate)) continue;
    const day = LocalDate.toEpochDay(fact.localDate);
    resolved.add(day);
    steps.push({
      stepKind: StepKind.Visit,
      day,
      reason: null,
      utcMs: fact.utcEpochMs,
      count: 0,
    });
  }
  for (let i = 0; i < facts.excused.length; i++) {
    const fact = facts.excused[i] as StreakExcusedFact;
    if (!past(fact.localDate)) continue;
    const day = LocalDate.toEpochDay(fact.localDate);
    if (fact.reason === StreakExcuse.ClosedDays) {
      if (StreakRule.isExcused(rule, StreakExcuse.ClosedDays)) closed.add(day);
      continue;
    }
    if (StreakRule.isExcused(rule, fact.reason)) resolved.add(day);
    steps.push({
      stepKind: StepKind.Excuse,
      day,
      reason: fact.reason,
      utcMs: null,
      count: 0,
    });
  }
  for (let i = 0; i < facts.grants.length; i++) {
    const fact = facts.grants[i] as StreakGrantFact;
    if (!past(fact.localDate) || !Number.isInteger(fact.count)) continue;
    steps.push({
      stepKind: StepKind.Grant,
      day: LocalDate.toEpochDay(fact.localDate),
      reason: null,
      utcMs: null,
      count: fact.count,
    });
  }
  steps.sort((a, b) => a.day - b.day || a.stepKind - b.stepKind);

  const bookings: Booking[] = [];
  for (let i = 0; i < facts.bookings.length; i++) {
    const fact = facts.bookings[i] as StreakBookingFact;
    if (
      !LocalDate.is(fact.localDate) ||
      !LocalDate.is(fact.placedOn) ||
      fact.placedOn > fact.localDate
    ) {
      continue;
    }
    const day = LocalDate.toEpochDay(fact.localDate);
    if (day < now && !resolved.has(day)) continue;
    bookings.push({
      placedOn: LocalDate.toEpochDay(fact.placedOn),
      day,
      appointmentId: appointmentIdOf(fact.appointmentId),
    });
  }
  bookings.sort((a, b) => a.day - b.day || a.placedOn - b.placedOn);

  const run = newRun(rule, closed, pausesOf(rule, facts.pauses), bookings);
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i] as Step;
    advance(run, step.day);
    if (step.stepKind === StepKind.Excuse) {
      excuse(run, step.day, step.reason as StreakExcuse);
    } else if (step.stepKind === StepKind.Visit) {
      visit(run, step.day, step.utcMs);
    } else {
      bank(run, step.count);
    }
  }
  advance(run, now);
  return run;
}

export const StreakSystem = {
  /**
   * One person's rhythm under `rule` as of `today`, with what the fold saw
   * on the way. A fact dated after `today`, or by something that is no
   * calendar day, is left out; a rule that is switched off projects
   * nothing (runs are held where they stand, never erased). Zone-blind:
   * every visit fact carries its own instant.
   */
  trace(
    streakId: StreakDefinitionId,
    rule: StreakRule,
    facts: StreakFacts,
    today: LocalDate,
  ): StreakTrace {
    const run = foldRun(rule, facts, today);
    if (run === null) return emptyTrace();
    const now = LocalDate.toEpochDay(today);

    const counts: StreakCount[] = [];
    for (let i = 0; i < run.counts.length; i++)
      counts.push(run.counts[i] as StreakCount);
    return {
      state: stateOn(run, streakId, now),
      record:
        run.bestOn === null
          ? null
          : { value: run.best, on: LocalDate.fromEpochDay(run.bestOn) },
      runStartedOn: startedOn(run),
      counts,
      comebacks: run.comebacks,
      judgedOn: run.judgedOn,
    };
  },

  /**
   * One person's rhythm under `rule` as of `today`, or `null` before their
   * first counted visit (and under a rule that is switched off).
   */
  project(
    streakId: StreakDefinitionId,
    rule: StreakRule,
    facts: StreakFacts,
    today: LocalDate,
  ): StreakState | null {
    return StreakSystem.trace(streakId, rule, facts, today).state;
  },

  /**
   * The phase kind of {@link project}'s state alone — what a count over a
   * whole book of clients reads (`StreakPreviewSystem.estimate`): the same
   * fold, without assembling the state (no hold, no periods). `null`
   * exactly where `project` is.
   */
  phaseKind(
    rule: StreakRule,
    facts: StreakFacts,
    today: LocalDate,
  ): StreakPhase | null {
    const run = foldRun(rule, facts, today);
    if (run === null || run.lastDay === null) return null;
    return phaseKindOn(run, LocalDate.toEpochDay(today), null);
  },

  /**
   * The day the NEXT visit keeps the rhythm by, once the visit in the chair
   * counts: the open period's own interval after `today`. `null` when
   * nobody is in the chair, for a paused client, under a used protection
   * (a frozen phase) and while no period is open (`wallet.presenter.ts`
   * `inChairDueOf`).
   */
  inChairDue(
    state: StreakState,
    today: LocalDate,
    view: { readonly inChairToday: boolean; readonly paused: boolean },
  ): LocalDate | null {
    return view.inChairToday &&
      !view.paused &&
      state.streakPhase !== StreakPhase.Frozen &&
      state.periodIntervalDays !== null
      ? LocalDate.addDays(today, state.periodIntervalDays)
      : null;
  },

  /**
   * The track's marks, oldest first — the projection's closed periods,
   * then the open one — cut to the newest `view.limit`, and whether the
   * visits' captions can be one per month (every drawn visit in a month of
   * its own). The open mark: a protection or an excuse carrying the period
   * (`protected`, dated by its moved due date; never while paused), else
   * today's visit in the chair, else the due date; none while no period is
   * open (`wallet.presenter.ts` `closedPeriod`/`openPeriod`/`rhythmMarks`).
   */
  track(state: StreakState, view: StreakTrackView): StreakTrack {
    const all: StreakTrackMark[] = [];
    for (let i = 0; i < state.periods.length; i++) {
      const fact = state.periods[i] as StreakPeriodFact;
      const isVisit =
        fact.streakPeriodMark === StreakPeriodMark.Kept ||
        fact.streakPeriodMark === StreakPeriodMark.Repaired;
      all.push({
        streakTrackMarkKind: fact.streakPeriodMark,
        on: fact.on,
        reason: fact.periodReason,
        open: false,
        visitDay: isVisit ? fact.on : null,
      });
    }
    if (state.streakPhase === StreakPhase.Frozen && !view.paused) {
      all.push({
        streakTrackMarkKind: StreakTrackMarkKind.Protected,
        on: state.phaseFrozenUntil,
        reason: state.phaseFreezeReason,
        open: true,
        visitDay: null,
      });
    } else if (view.inChairToday) {
      all.push({
        streakTrackMarkKind: StreakTrackMarkKind.Current,
        on: view.today,
        reason: null,
        open: true,
        visitDay: null,
      });
    } else if (state.dueBy !== null) {
      all.push({
        streakTrackMarkKind: StreakTrackMarkKind.Current,
        on: state.dueBy,
        reason: null,
        open: true,
        visitDay: null,
      });
    }
    const marks = all.slice(Math.max(0, all.length - Math.max(0, view.limit)));
    const months = new Set<string>();
    let visits = 0;
    for (let i = 0; i < marks.length; i++) {
      const day = (marks[i] as StreakTrackMark).visitDay;
      if (day === null) continue;
      visits += 1;
      months.add(LocalDate.monthKey(day));
    }
    return { marks, byMonth: months.size === visits };
  },

  /**
   * Where the rhythm stands, in the order the card's line is chosen
   * (`wallet.presenter.ts` `standingOf`, its live path):
   *
   * 1. paused → `PAUSED`;
   * 2. the visit in the chair keeps the run → `IN_CHAIR` (names the
   *    in-chair due date); else nobody has begun — no count and no counted
   *    visit (`current > 0 ∨ lastQualifiedAtUtcMs ≠ null` is begun) →
   *    `NOT_STARTED`;
   * 3. by phase: `FROZEN` (its reason); `BROKEN` — restorable while
   *    `phaseRepairableUntil` is today or later (`BROKEN_REPAIRABLE`, names
   *    that day, warns), else `BROKEN_FINAL` (names nothing: the day before
   *    the break is no day); a visit on the book holding the open period →
   *    `HELD` (names it; a capsule only where a warning would have stood,
   *    never beside a healthy figure); `ACTIVE` → `DUE` / `DUE_NONE`;
   *    `AT_RISK` (names the due date, warns, and the whole weeks since the
   *    last counted visit — `ClientStatsSystem.cadenceWeeks`, the one home
   *    of that rule); `IN_GRACE` (names the end of grace, warns).
   *
   * `nextDue` is `StreakSystem.dueAfter` — the in-chair due date, else
   * `dueBy` — only while the line names a due date (`dueNamed`). A broken
   * run never names a repair day already past.
   */
  outlook(state: StreakState, view: StreakOutlookView): StreakOutlookAnswer {
    const answer = (
      streakOutlook: StreakOutlook,
      day: LocalDate | null,
      dueNamed: boolean,
      streakCapsule: StreakCapsule | null,
      urgent: boolean,
    ): StreakOutlookAnswer => ({
      streakOutlook,
      day,
      nextDue: dueNamed ? StreakSystem.dueAfter(state, view.inChairDue) : null,
      dueNamed,
      streakCapsule,
      urgent,
      weeksSinceLast: 0,
      phaseFreezeReason: null,
    });
    if (view.paused) {
      return answer(StreakOutlook.Paused, null, false, null, false);
    }
    if (view.inChairDue !== null) {
      return answer(StreakOutlook.InChair, view.inChairDue, true, null, false);
    }
    if (state.current === 0 && state.lastQualifiedAtUtcMs === null) {
      return answer(StreakOutlook.NotStarted, null, false, null, false);
    }
    switch (state.streakPhase) {
      case StreakPhase.Frozen:
        return {
          ...answer(
            StreakOutlook.Frozen,
            null,
            false,
            StreakCapsule.Frozen,
            false,
          ),
          phaseFreezeReason: state.phaseFreezeReason,
        };
      case StreakPhase.Broken:
        return LocalDate.compare(state.phaseRepairableUntil, view.today) >= 0
          ? answer(
              StreakOutlook.BrokenRepairable,
              state.phaseRepairableUntil,
              false,
              StreakCapsule.Broken,
              true,
            )
          : answer(
              StreakOutlook.BrokenFinal,
              null,
              false,
              StreakCapsule.Broken,
              false,
            );
      case StreakPhase.Active:
      case StreakPhase.AtRisk:
      case StreakPhase.InGrace: {
        // `heldByAppointmentId` and `heldOn` are set together.
        const heldOn = state.heldByAppointmentId === null ? null : state.heldOn;
        if (heldOn !== null) {
          return answer(
            StreakOutlook.Held,
            heldOn,
            false,
            state.streakPhase === StreakPhase.Active
              ? null
              : StreakCapsule.Held,
            false,
          );
        }
        if (state.streakPhase === StreakPhase.AtRisk) {
          return {
            ...answer(
              StreakOutlook.AtRisk,
              state.phaseDueBy,
              true,
              StreakCapsule.AtRisk,
              true,
            ),
            weeksSinceLast:
              view.lastQualifiedOn === null
                ? 0
                : ClientStatsSystem.cadenceWeeks(
                    LocalDate.daysBetween(view.lastQualifiedOn, view.today),
                  ),
          };
        }
        if (state.streakPhase === StreakPhase.InGrace) {
          return answer(
            StreakOutlook.InGrace,
            state.phaseGraceUntil,
            true,
            StreakCapsule.InGrace,
            true,
          );
        }
        return state.dueBy === null
          ? answer(StreakOutlook.DueNone, null, true, null, false)
          : answer(StreakOutlook.Due, state.dueBy, true, null, false);
      }
    }
  },

  /**
   * The day the next visit keeps the rhythm by: the due date once the
   * visit in the chair counts (`StreakSystem.inChairDue`) wins, else the
   * state's own `dueBy`; `null` when neither names a day. Ungated — the
   * outlook says it only while its line names a due date (`nextDue`).
   */
  dueAfter(
    state: Pick<StreakState, 'dueBy'>,
    inChairDue: LocalDate | null,
  ): LocalDate | null {
    return inChairDue ?? state.dueBy;
  },

  /**
   * Which of a shop's rhythms a person's card is judged by (client-card
   * revision 3 §4.1): the first head, in the catalogue's order, the account
   * holds a state for (`StreakState.find`), else the catalogue's first;
   * `null` for a shop without a rhythm. A linear scan of a handful of heads.
   */
  headOf<H extends { readonly id: StreakDefinitionId }>(
    heads: readonly H[],
    states: readonly Pick<StreakState, 'streakId'>[],
  ): H | null {
    for (let i = 0; i < heads.length; i++) {
      const head = heads[i] as H;
      if (StreakState.find(states, head.id) !== null) return head;
    }
    return heads[0] ?? null;
  },

  /** The best run, said only while the run in progress is shorter; `null` otherwise. */
  record(state: Pick<StreakState, 'best' | 'current'>): number | null {
    return state.best > state.current ? state.best : null;
  },

  /**
   * The protections in reserve, said only where the rule grants them
   * (`StreakRuleSystem.summary`'s `protections`) and the reserve holds one;
   * `null` otherwise.
   */
  protectionsHeld(
    state: Pick<StreakState, 'freezesBanked'>,
    summary: Pick<StreakRuleSummary, 'protections'>,
  ): number | null {
    return summary.protections !== null && state.freezesBanked > 0
      ? state.freezesBanked
      : null;
  },
} as const;
