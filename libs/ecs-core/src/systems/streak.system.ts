import { AppointmentId } from '../entities/appointment.entity';
import type { StreakDefinitionId } from '../entities/streak-definition.entity';
import { DayKey } from '../components/day-key.data';
import {
  StreakInterval,
  StreakIntervalKind,
  StreakIntervalSource,
} from '../components/streak-interval.data';
import {
  STREAK_SHOP_EXCUSES,
  StreakExcuse,
  StreakOnBreak,
  StreakRule,
} from '../components/streak-rule.data';
import {
  FreezeReason,
  StreakPeriodMark,
  StreakPhase,
  StreakPhaseKind,
  StreakState,
  type StreakHold,
  type StreakPeriodFact,
  type StreakPeriodReason,
  type StreakPeriodTerms,
} from '../components/streak-state.data';
import { DstResolution, ZonedTimeSystem } from './zoned-time.system';

/*
 * THE RHYTHM'S PROJECTOR (client-card revision 3 §4.2), ported from
 * `libs/domain/engagement/src/lib/loyalty/streak-projector.ts:60-802`: one
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
 * Days are whole numbers inside the fold (`DayKey.toEpochDay`) and day
 * keys again on the way out. The one zone read is the start of the last
 * counted visit's day when the fact came without an instant — through
 * `ZonedTimeSystem`, once per trace.
 */

/** What carries a client's own pause or the account's: the two pause reasons of `FreezeReason`. */
export type StreakPauseReason =
  typeof FreezeReason.Pause | typeof FreezeReason.ClientPause;

/** A worked visit of the person's, on the shop day of its first worked seat. */
export type StreakVisitFact = {
  readonly day: DayKey;
  /** The rule's qualifier, already applied. A visit that does not count is no fact of the rhythm. */
  readonly counted: boolean;
  /**
   * When the visit began; `null` where a caller holds days only (the
   * admin's preview) — `lastQualifiedAtMs` is then the start of `day` in
   * the shop's zone.
   */
  readonly atMs: number | null;
};

/**
 * What is never the client's doing. The shop's three are a visit of theirs
 * it called off, dated by the visit's day; `closedDays` is ONE day the shop
 * was closed, no booking involved.
 */
export type StreakExcusedFact = {
  readonly day: DayKey;
  readonly reason: StreakExcuse;
};

/**
 * A visit of the person's on the book. Leave out what the client
 * cancelled: a hold that was released is judged as if it never existed,
 * and the projector releases by itself a booking whose day passed with
 * neither a counted visit nor an excuse the rule accepts on it.
 */
export type StreakBookingFact = {
  readonly placedOn: DayKey;
  readonly day: DayKey;
  /** Names the visit in `StreakState.heldBy`; `null` (or blank) still holds the clock and names no visit. */
  readonly appointmentId: string | null;
};

/** The account's pause (`pause`), or the client's own (`clientPause`), both days included. */
export type StreakPauseFact = {
  readonly from: DayKey;
  readonly until: DayKey;
  readonly reason: StreakPauseReason;
};

/** Protections given, not earned by the count: an achievement's award, the staff's «Дай защита». */
export type StreakGrantFact = {
  readonly day: DayKey;
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
export type StreakCount = { readonly on: DayKey; readonly current: number };

/** The personal best and the day of the visit that reached it («най-дълъг ритъм»). */
export type StreakRecord = { readonly value: number; readonly on: DayKey };

/**
 * The projection and what else the fold saw on the way: what the seed's
 * families read today and the engine's journal will.
 */
export type StreakTrace = {
  readonly state: StreakState | null;
  readonly record: StreakRecord | null;
  /** The day the run in progress began; `null` while none is (`StreakState.runStartedOn`). */
  readonly runStartedOn: DayKey | null;
  /** The count each day it moved, oldest first: up with a visit, to nothing on the day a miss took it. */
  readonly counts: readonly StreakCount[];
  /** The days a client came back: the second counted visit of a run that started over («Завръщане»). */
  readonly comebacks: readonly DayKey[];
  /** The days on which the nightly judgement moved the phase: what the daily job would have written. */
  readonly judgedOn: readonly DayKey[];
};

/** The open mark of the track: a due date still to come, or the visit in the chair. */
export const StreakTrackMarkKind = {
  Kept: StreakPeriodMark.Kept,
  Protected: StreakPeriodMark.Protected,
  Repaired: StreakPeriodMark.Repaired,
  Missed: StreakPeriodMark.Missed,
  Current: 'current',
} as const;
export type StreakTrackMarkKind =
  (typeof StreakTrackMarkKind)[keyof typeof StreakTrackMarkKind];

/**
 * One mark of the rhythm's track, oldest first: the projection's closed
 * periods, then the open one. Numbers, days and tags — the words and the
 * captions are the template's (`wallet.presenter.ts` `closedPeriod`,
 * `openPeriod`, `rhythmMarks`).
 */
export type StreakTrackMark = {
  readonly mark: StreakTrackMarkKind;
  /** The day the mark stands for: a visit's day, a due date, the moved due date, or today. */
  readonly on: DayKey;
  /** What covered a `protected` mark (a closed period's reason, or the open phase's `FreezeReason`); `null` otherwise. */
  readonly reason: StreakPeriodReason | FreezeReason | null;
  /** The open period, after every closed one. */
  readonly open: boolean;
  /** The visit a `kept` or `repaired` mark stands for; `null` on a due date nobody met and on the open mark. */
  readonly visitDay: DayKey | null;
};

/** The track as drawn: its marks, and whether the visits' captions can be one per month. */
export type StreakTrack = {
  readonly marks: readonly StreakTrackMark[];
  /** Every drawn visit has a month of its own: captions by month, else by day (DV12). */
  readonly byMonth: boolean;
};

/** What the card knows about today beside the projection. */
export type StreakTrackView = {
  readonly today: DayKey;
  /** The client is in the chair today: the open mark is today's visit. */
  readonly inChairToday: boolean;
  /** Booking paused: the clock is frozen and no protection is drawn open. */
  readonly paused: boolean;
  /** The most marks drawn, the open one among them. */
  readonly limit: number;
};

/** The habit is the mean of this many of the newest counted gaps, known from the third counted visit on. */
const HABIT_GAPS = 6;
const HABIT_FROM_VISITS = 3;
/** «Веднъж на 12 месеца»: the earn-back's year, in days. */
const REPAIR_YEAR_DAYS = 365;

/** What a step of the fold is, in the order a day takes them. */
const StepKind = { Excuse: 0, Visit: 1, Grant: 2 } as const;
type StepKind = (typeof StepKind)[keyof typeof StepKind];

/** A fact on the fold's own clock: days as whole numbers. */
type Step = {
  readonly kind: StepKind;
  readonly day: number;
  readonly reason: StreakExcuse | null;
  readonly atMs: number | null;
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
  readonly appointmentId: string | null;
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
  lastAtMs: number | null;
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
  phaseKind: StreakPhaseKind | null;
  stretched: boolean;
  readonly repairs: number[];
  readonly gaps: number[];
  readonly marks: StreakPeriodFact[];
  readonly counts: StreakCount[];
  readonly comebacks: DayKey[];
  readonly judgedOn: DayKey[];
};

const dayOf = (epochDay: number): DayKey => DayKey.fromEpochDay(epochDay);

function isShopExcuse(reason: StreakExcuse): boolean {
  for (let i = 0; i < STREAK_SHOP_EXCUSES.length; i++) {
    if (STREAK_SHOP_EXCUSES[i] === reason) return true;
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
      !DayKey.isValid(pause.from) ||
      !DayKey.isValid(pause.until) ||
      pause.until < pause.from
    ) {
      continue;
    }
    sound.push({
      from: DayKey.toEpochDay(pause.from),
      until: DayKey.toEpochDay(pause.until),
      reason: pause.reason,
    });
  }
  sound.sort((a, b) => a.from - b.from || a.until - b.until);

  const pauses: Pause[] = [];
  for (let i = 0; i < sound.length; i++) {
    const pause = sound[i] as Pause;
    if (pause.reason === FreezeReason.Pause) pauses.push(pause);
  }
  if (!rule.clientPause.enabled) return pauses;

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
      rule.clientPause.maxDaysPerYear - used,
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
    rule.interval.kind === StreakIntervalKind.Personal &&
    run.counted >= HABIT_FROM_VISITS &&
    run.gaps.length > 0;
  let habit: number | null = null;
  if (known) {
    const from = Math.max(0, run.gaps.length - HABIT_GAPS);
    let sum = 0;
    for (let i = from; i < run.gaps.length; i++) sum += run.gaps[i] as number;
    // One decimal, the `cadenceOf` rule: a stable number to store.
    habit = Math.round((sum / (run.gaps.length - from)) * 10) / 10;
  }
  const { days, source } = StreakInterval.daysFor(rule.interval, habit);
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
  const { bookingHold } = run.rule;
  if (!bookingHold.enabled) return null;
  const latest = dueDay + bookingHold.maxDaysPastDue;
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
function heldOn(run: Run, today: number): StreakHold | null {
  if (run.anchor === null) return null;
  // A booking for today is the visit that counted today, not one ahead.
  const from = run.lastDay === today ? today + 1 : today;
  const dueDay = due(run);
  const hold = holdOn(run, today, dueDay, graceEnd(run, dueDay), from);
  return hold === null || hold.appointmentId === null
    ? null
    : {
        appointmentId: AppointmentId.of(hold.appointmentId),
        on: dayOf(hold.day),
      };
}

/** P11. Inside the window of the break, and the year's earn-backs not used up. */
function repairableOn(run: Run, brokenOn: number, day: number): boolean {
  const { repair } = run.rule;
  if (!repair.enabled || day - brokenOn > repair.windowDays) return false;
  let used = 0;
  for (let i = 0; i < run.repairs.length; i++) {
    if (day - (run.repairs[i] as number) < REPAIR_YEAR_DAYS) used += 1;
  }
  return used < repair.perYear;
}

function phaseOn(run: Run, day: number): StreakPhase {
  const { rule } = run;
  if (run.brokenOn !== null) {
    const lastDay = run.brokenOn + rule.repair.windowDays;
    const restores =
      rule.onBreak === StreakOnBreak.Restart &&
      repairableOn(run, run.brokenOn, lastDay);
    return StreakPhase.broken(
      dayOf(run.brokenOn),
      dayOf(restores ? lastDay : run.brokenOn - 1),
    );
  }
  if (run.anchor === null) return StreakPhase.active();
  const pause = pauseOn(run, day);
  if (pause !== null)
    return StreakPhase.frozen(dayOf(pause.until), pause.reason);
  const dueDay = due(run);
  if (day <= dueDay) {
    if (run.carriedBy !== null) {
      return StreakPhase.frozen(dayOf(dueDay), run.carriedBy);
    }
    return dueDay - day <= rule.riskLeadDays
      ? StreakPhase.atRisk(dayOf(dueDay))
      : StreakPhase.active();
  }
  const end = graceEnd(run, dueDay);
  const hold = day > end ? holdOn(run, day, dueDay, end, day) : null;
  return StreakPhase.inGrace(dayOf(hold?.day ?? end));
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
): StreakPhaseKind {
  if (run.brokenOn !== null) return StreakPhaseKind.Broken;
  if (run.anchor === null) return StreakPhaseKind.Active;
  if (pauseOn(run, day) !== null) return StreakPhaseKind.Frozen;
  const dueDay = knownDue ?? due(run);
  if (day <= dueDay) {
    if (run.carriedBy !== null) return StreakPhaseKind.Frozen;
    return dueDay - day <= run.rule.riskLeadDays
      ? StreakPhaseKind.AtRisk
      : StreakPhaseKind.Active;
  }
  return StreakPhaseKind.InGrace;
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
      mark: StreakPeriodMark.Protected,
      on: dayOf(dueDay),
      reason: FreezeReason.Freeze,
    });
    // The due date it covered closes a period, and the next one opens on it.
    open(run, dueDay);
    run.carriedBy = FreezeReason.Freeze;
    return;
  }
  run.marks.push({
    mark: StreakPeriodMark.Missed,
    on: dayOf(dueDay),
    reason: null,
  });
  run.brokenOn = day;
  run.brokenRun = run.current;
  if (run.rule.onBreak === StreakOnBreak.Restart) {
    run.current = 0;
    run.counts.push({ on: dayOf(day), current: 0 });
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
      mark: StreakPeriodMark.Protected,
      on: dayOf(cover.due),
      reason: cover.reason,
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
      mark: StreakPeriodMark.Protected,
      on: dayOf(nominal),
      reason: StreakExcuse.ClosedDays,
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
    run.judgedOn.push(dayOf(day));
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
  const { protections } = run.rule;
  if (!protections.enabled || count <= 0) return;
  run.banked = Math.max(
    run.banked,
    Math.min(protections.maxBanked, run.banked + count),
  );
}

/** A counted visit: it extends, restores or restarts the run, or is the same haircut again. */
function visit(run: Run, day: number, atMs: number | null): void {
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
  run.counts.push({ on: dayOf(day), current: run.current });
  if (run.current === 1 || run.runStartedOn === null) run.runStartedOn = day;
  if (run.comebackArmed && run.current === 2) {
    run.comebackArmed = false;
    run.comebacks.push(dayOf(day));
  }

  // P8. What a run starts with is given once, with the first visit on
  // record: a restart does not re-grant it.
  if (run.counted === 0) bank(run, rule.protections.startWith);
  if (run.current % rule.protections.earnEvery === 0) bank(run, 1);
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
  run.lastAtMs = atMs;

  run.terms = termsNow(run);
  open(run, day);
  run.marks.push({ mark, on: dayOf(day), reason: null });
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
function startedOn(run: Run): DayKey | null {
  return run.current === 0 || run.runStartedOn === null
    ? null
    : dayOf(run.runStartedOn);
}

/** The instant a shop day begins: what stands for a visit known by its day alone. */
function startOfDayMs(day: DayKey, zone: string): number | null {
  const start = ZonedTimeSystem.resolve(
    day,
    0,
    zone,
    DstResolution.ShiftForward,
  );
  return start.ok ? start.value.epochMs : null;
}

/** The account's state as of `today`, or `null` before any counted visit. */
function stateOn(
  run: Run,
  streakId: StreakDefinitionId,
  today: number,
  zone: string,
): StreakState | null {
  if (run.lastDay === null) return null;
  const isOpen = run.brokenOn === null;
  const periods = run.marks.slice(
    Math.max(0, run.marks.length - StreakState.PERIODS_KEPT),
  );
  return {
    streakId,
    definitionVersion: run.rule.version,
    phase: phaseOn(run, today),
    current: run.current,
    best: run.best,
    lastQualifiedAtMs: run.lastAtMs ?? startOfDayMs(dayOf(run.lastDay), zone),
    dueBy: isOpen ? dayOf(due(run) + pausedAfter(run, today)) : null,
    freezesBanked: run.banked,
    period: isOpen ? run.terms : null,
    periods,
    heldBy: isOpen ? heldOn(run, today) : null,
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
    lastAtMs: null,
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
function appointmentIdOf(raw: string | null): string | null {
  if (raw === null) return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * The fold itself: every fact up to `today`, every nightly judgement up to
 * and including today's — the run as it stands, for the state or for the
 * phase alone. `null` under a rule that is off or a `today` that is no day.
 */
function foldRun(
  rule: StreakRule,
  facts: StreakFacts,
  today: DayKey,
): Run | null {
  if (!rule.enabled || !DayKey.isValid(today)) return null;
  const now = DayKey.toEpochDay(today);
  const past = (day: DayKey): boolean => DayKey.isValid(day) && day <= today;

  const steps: Step[] = [];
  const closed = new Set<number>();
  /** The days a booking ended the way the rule keeps: a counted visit, or a visit the shop called off. */
  const resolved = new Set<number>();
  for (let i = 0; i < facts.visits.length; i++) {
    const fact = facts.visits[i] as StreakVisitFact;
    if (!fact.counted || !past(fact.day)) continue;
    const day = DayKey.toEpochDay(fact.day);
    resolved.add(day);
    steps.push({
      kind: StepKind.Visit,
      day,
      reason: null,
      atMs: fact.atMs,
      count: 0,
    });
  }
  for (let i = 0; i < facts.excused.length; i++) {
    const fact = facts.excused[i] as StreakExcusedFact;
    if (!past(fact.day)) continue;
    const day = DayKey.toEpochDay(fact.day);
    if (fact.reason === StreakExcuse.ClosedDays) {
      if (StreakRule.isExcused(rule, StreakExcuse.ClosedDays)) closed.add(day);
      continue;
    }
    if (StreakRule.isExcused(rule, fact.reason)) resolved.add(day);
    steps.push({
      kind: StepKind.Excuse,
      day,
      reason: fact.reason,
      atMs: null,
      count: 0,
    });
  }
  for (let i = 0; i < facts.grants.length; i++) {
    const fact = facts.grants[i] as StreakGrantFact;
    if (!past(fact.day) || !Number.isInteger(fact.count)) continue;
    steps.push({
      kind: StepKind.Grant,
      day: DayKey.toEpochDay(fact.day),
      reason: null,
      atMs: null,
      count: fact.count,
    });
  }
  steps.sort((a, b) => a.day - b.day || a.kind - b.kind);

  const bookings: Booking[] = [];
  for (let i = 0; i < facts.bookings.length; i++) {
    const fact = facts.bookings[i] as StreakBookingFact;
    if (
      !DayKey.isValid(fact.day) ||
      !DayKey.isValid(fact.placedOn) ||
      fact.placedOn > fact.day
    ) {
      continue;
    }
    const day = DayKey.toEpochDay(fact.day);
    if (day < now && !resolved.has(day)) continue;
    bookings.push({
      placedOn: DayKey.toEpochDay(fact.placedOn),
      day,
      appointmentId: appointmentIdOf(fact.appointmentId),
    });
  }
  bookings.sort((a, b) => a.day - b.day || a.placedOn - b.placedOn);

  const run = newRun(rule, closed, pausesOf(rule, facts.pauses), bookings);
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i] as Step;
    advance(run, step.day);
    if (step.kind === StepKind.Excuse) {
      excuse(run, step.day, step.reason as StreakExcuse);
    } else if (step.kind === StepKind.Visit) {
      visit(run, step.day, step.atMs);
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
   * nothing (runs are held where they stand, never erased). `zone` is the
   * shop's: the start of the last counted visit's day stands for a visit
   * that came without an instant.
   */
  trace(
    streakId: StreakDefinitionId,
    rule: StreakRule,
    facts: StreakFacts,
    today: DayKey,
    zone: string,
  ): StreakTrace {
    const run = foldRun(rule, facts, today);
    if (run === null) return emptyTrace();
    const now = DayKey.toEpochDay(today);

    const counts: StreakCount[] = [];
    for (let i = 0; i < run.counts.length; i++)
      counts.push(run.counts[i] as StreakCount);
    return {
      state: stateOn(run, streakId, now, zone),
      record:
        run.bestOn === null ? null : { value: run.best, on: dayOf(run.bestOn) },
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
    today: DayKey,
    zone: string,
  ): StreakState | null {
    return StreakSystem.trace(streakId, rule, facts, today, zone).state;
  },

  /**
   * The phase kind of {@link project}'s state alone — what a count over a
   * whole book of clients reads (`StreakPreviewSystem.estimate`): the same
   * fold, without assembling the state (no zone math for the last visit's
   * instant, no hold, no periods). `null` exactly where `project` is.
   */
  phaseKind(
    rule: StreakRule,
    facts: StreakFacts,
    today: DayKey,
  ): StreakPhaseKind | null {
    const run = foldRun(rule, facts, today);
    if (run === null || run.lastDay === null) return null;
    return phaseKindOn(run, DayKey.toEpochDay(today), null);
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
    today: DayKey,
    view: { readonly inChairToday: boolean; readonly paused: boolean },
  ): DayKey | null {
    return view.inChairToday &&
      !view.paused &&
      state.phase.kind !== StreakPhaseKind.Frozen &&
      state.period !== null
      ? ZonedTimeSystem.addDays(today, state.period.intervalDays)
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
        fact.mark === StreakPeriodMark.Kept ||
        fact.mark === StreakPeriodMark.Repaired;
      all.push({
        mark: fact.mark,
        on: fact.on,
        reason: fact.reason,
        open: false,
        visitDay: isVisit ? fact.on : null,
      });
    }
    const phase = state.phase;
    if (phase.kind === StreakPhaseKind.Frozen && !view.paused) {
      all.push({
        mark: StreakTrackMarkKind.Protected,
        on: phase.until,
        reason: phase.reason,
        open: true,
        visitDay: null,
      });
    } else if (view.inChairToday) {
      all.push({
        mark: StreakTrackMarkKind.Current,
        on: view.today,
        reason: null,
        open: true,
        visitDay: null,
      });
    } else if (state.dueBy !== null) {
      all.push({
        mark: StreakTrackMarkKind.Current,
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
      months.add(day.slice(0, 7));
    }
    return { marks, byMonth: months.size === visits };
  },
} as const;
