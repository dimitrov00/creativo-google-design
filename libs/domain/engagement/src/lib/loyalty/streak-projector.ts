import { ZonedDateTime } from '@creativo/domain/kernel';
import {
  IsoDate,
  LOYALTY_ZONE,
  daysBetween,
  isIsoDate,
} from './loyalty-calendar';
import type {
  StreakHold,
  StreakPeriodFact,
  StreakPeriodTerms,
  StreakPhase,
  StreakState,
} from './projections';
import {
  STREAK_SHOP_EXCUSES,
  StreakDefinition,
  StreakExcuse,
} from './streak-definition';
import { addDays } from './streak-schedule';

/**
 * THE RHYTHM'S PROJECTOR (client-card revision 3 §4.2): one person's
 * «Посещения в ритъм» under one version of the rule, folded from facts.
 * It is the seed's `rhythmOf` (`tools/seed/loyalty.mjs`) moved into the
 * domain and typed, with every parameter of the rule the seed never had,
 * so the seed, the admin's preview and, later, the engine's
 * `recomputeStreak` run ONE clock.
 *
 * The clock, stated once. Every date is a Europe/Sofia calendar day.
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
 * first match wins:
 *
 * 1. a visit on the book holds the period open (P4);
 * 2. a banked protection covers the due date and moves it one interval
 *    on (P8);
 * 3. the miss: the count starts over, or holds (P12).
 *
 * What is not the client's doing moves the clock BEFORE the judgement
 * and so never reaches it: a visit the shop called off restarts the clock
 * from its day (P9), a paused day does not tick (P10), and a due date or
 * a day of grace on a closed day waits for an open one (P9 `closedDays`).
 *
 * Fixed by ethics, in code: a protection applies by itself and costs
 * nothing, the best run never decreases, and a no-show is not a fact
 * here at all: it keeps nothing and it breaks nothing.
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

/** The habit is the mean of this many of the newest counted gaps, known from the third counted visit on. */
const HABIT_GAPS = 6;
const HABIT_FROM_VISITS = 3;
/** «Веднъж на 12 месеца»: the earn-back's year, in days. */
const REPAIR_YEAR_DAYS = 365;

const EPOCH: IsoDate = '1970-01-01';
/** Days are counted as whole numbers inside the fold and become dates again on the way out. */
const numberOf = (day: IsoDate): number => daysBetween(EPOCH, day);
const dayOf = (number: number): IsoDate => addDays(EPOCH, number);

const NOTHING: StreakTrace = Object.freeze({
  state: null,
  record: null,
  runStartedOn: null,
  counts: Object.freeze([]),
  comebacks: Object.freeze([]),
  judgedOn: Object.freeze([]),
});

type PauseReason = StreakPauseFact['reason'];
/** What moved the clock in the client's favour: an excuse the rule accepts, or a pause. */
type Carrier = StreakExcuse | PauseReason;
type FrozenReason = Extract<StreakPhase, { kind: 'frozen' }>['reason'];

interface Pause {
  readonly from: number;
  readonly until: number;
  readonly reason: PauseReason;
}

interface Booking {
  readonly placedOn: number;
  readonly day: number;
  readonly appointmentId: string | null;
}

/** The facts that are read AHEAD of the day being folded. */
interface Book {
  readonly closed: ReadonlySet<number>;
  readonly pauses: readonly Pause[];
  /** By day; only what can hold a period. */
  readonly bookings: readonly Booking[];
}

type Step =
  | {
      readonly kind: 'excuse';
      readonly day: number;
      readonly reason: StreakExcuse;
    }
  | { readonly kind: 'visit'; readonly day: number; readonly at: Date | null }
  | { readonly kind: 'grant'; readonly day: number; readonly count: number };

/** Within a day: what the shop called off, then the visits, then what they earned. */
const STEP_ORDER: Readonly<Record<Step['kind'], number>> = {
  excuse: 0,
  visit: 1,
  grant: 2,
};

const isShopExcuse = (reason: StreakExcuse): boolean =>
  (STREAK_SHOP_EXCUSES as readonly StreakExcuse[]).includes(reason);

/** The instant a Sofia day begins: what stands for a visit known by its day alone. */
function startOf(day: IsoDate): Date {
  const start = ZonedDateTime.fromISO(`${day}T00:00:00`, LOYALTY_ZONE);
  if (start.isFailure()) {
    // Unreachable: the day was checked and the zone is a constant.
    throw start.error;
  }
  return new Date(start.value.toMillis());
}

/**
 * The pauses that stop the clock. The account's pause always does (a
 * pause freezes the rhythm, it never zeroes it). The client's own does
 * where the rule allows one, for as many days as the allowance has left
 * in the 365 days before it starts: the days past the allowance tick.
 */
function pausesOf(rule: StreakDefinition, facts: StreakFacts): Pause[] {
  const sound = facts.pauses
    .filter(
      (pause) =>
        isIsoDate(pause.from) &&
        isIsoDate(pause.until) &&
        pause.until >= pause.from,
    )
    .map((pause) => ({
      from: numberOf(pause.from),
      until: numberOf(pause.until),
      reason: pause.reason,
    }))
    .sort((a, b) => a.from - b.from || a.until - b.until);

  const pauses: Pause[] = sound.filter((pause) => pause.reason === 'pause');
  if (!rule.clientPause.enabled) return pauses;

  const granted: Pause[] = [];
  for (const pause of sound) {
    if (pause.reason !== 'clientPause') continue;
    const yearFrom = pause.from - REPAIR_YEAR_DAYS;
    const used = granted.reduce(
      (days, earlier) =>
        days +
        Math.max(
          0,
          Math.min(earlier.until, pause.from - 1) -
            Math.max(earlier.from, yearFrom) +
            1,
        ),
      0,
    );
    const allowed = Math.min(
      pause.until - pause.from + 1,
      rule.clientPause.maxDaysPerYear - used,
    );
    if (allowed <= 0) continue;
    granted.push({ ...pause, until: pause.from + allowed - 1 });
  }
  return [...pauses, ...granted];
}

/** One person's run under one rule: the seed's fold, with the rule's every parameter. */
class StreakRun {
  private current = 0;
  private best = 0;
  private bestOn: number | null = null;
  private banked = 0;
  private counted = 0;
  private last: { readonly day: number; readonly at: Date | null } | null =
    null;
  private runStartedOn: number | null = null;

  /** The day the open period counts from. */
  private anchor: number | null = null;
  private terms: StreakPeriodTerms | null = null;
  /** The due date that a carrier moved, until the day it would have been judged. */
  private cover: {
    readonly due: number;
    readonly graceEnd: number;
    readonly reason: Carrier;
  } | null = null;
  /** The open period is drawn as covered already: a period is covered once. */
  private covered = false;
  /** What the open period runs on, when it is not a visit. */
  private carriedBy: FrozenReason | null = null;
  private broken: { readonly on: number; readonly run: number } | null = null;

  private comebackArmed = false;
  private jobDay: number | null = null;
  private phaseKind: StreakPhase['kind'] | null = null;
  private stretched = false;
  private readonly repairs: number[] = [];
  private readonly gaps: number[] = [];
  private readonly marks: StreakPeriodFact[] = [];
  private readonly counts: { on: number; current: number }[] = [];
  private readonly comebacks: number[] = [];
  private readonly judgedOn: number[] = [];

  constructor(
    private readonly rule: StreakDefinition,
    private readonly book: Book,
  ) {}

  /** Every nightly judgement up to and including `day`'s: it runs before that day's facts. */
  advance(day: number): void {
    if (this.jobDay === null) return;
    while (this.jobDay < day) {
      this.jobDay += 1;
      this.judge(this.jobDay);
    }
  }

  /** A counted visit: it extends, restores or restarts the run, or is the same haircut again. */
  visit(day: number, at: Date | null): void {
    const { rule } = this;
    if (
      this.last !== null &&
      this.broken === null &&
      day - this.last.day < rule.minGapDays
    ) {
      // P3. The same haircut, fixed up: the due date moves, the count does not.
      this.open(Math.max(day, this.anchor ?? day));
      this.phaseKind = this.phaseOn(day).kind;
      return;
    }

    let mark: StreakPeriodFact['mark'] = 'kept';
    if (this.broken === null) {
      this.current += 1;
    } else if (rule.onBreak === 'hold') {
      // P12. Nothing was lost, so nothing is restored: the count goes on.
      this.current += 1;
    } else if (this.repairableOn(this.broken.on, day)) {
      // P11. The earn-back: the run is what it was, and one more.
      this.current = this.broken.run + 1;
      this.repairs.push(day);
      mark = 'repaired';
    } else {
      this.current = 1;
      this.comebackArmed = true;
    }
    this.broken = null;
    this.counts.push({ on: day, current: this.current });
    if (this.current === 1 || this.runStartedOn === null) {
      this.runStartedOn = day;
    }
    if (this.comebackArmed && this.current === 2) {
      this.comebackArmed = false;
      this.comebacks.push(day);
    }

    // P8. What a run starts with is given once, with the first visit on
    // record: a restart does not re-grant it.
    if (this.counted === 0) this.bank(rule.protections.startWith);
    if (this.current % rule.protections.earnEvery === 0) this.bank(1);
    if (this.current > this.best) {
      this.best = this.current;
      this.bestOn = day;
    }

    // The habit: a gap the shop stretched says nothing about the person.
    if (this.last !== null && !this.stretched && day > this.last.day) {
      this.gaps.push(day - this.last.day);
    }
    this.stretched = false;
    this.counted += 1;
    this.last = { day, at };

    this.terms = this.termsNow();
    this.open(day);
    this.marks.push({ mark, on: dayOf(day), reason: null });
    this.jobDay = day;
    this.phaseKind = this.phaseOn(day).kind;
  }

  /**
   * P9. A visit the shop called off: the client was in rhythm, so the
   * clock restarts from its day. The period it moved is drawn as covered
   * only if its own deadline then passes without a visit: an excuse
   * nobody needed is not a mark.
   */
  excuse(day: number, reason: StreakExcuse): void {
    if (isShopExcuse(reason)) this.stretched = true;
    if (!this.rule.isExcused(reason)) return;
    if (this.anchor === null || this.broken !== null || day <= this.anchor) {
      return;
    }
    this.coverBy(reason);
    this.anchor = day;
  }

  /** P8. Banked up to the reserve's cap; nothing while protections are off. */
  bank(count: number): void {
    const { protections } = this.rule;
    if (!protections.enabled || count <= 0) return;
    this.banked = Math.max(
      this.banked,
      Math.min(protections.maxBanked, this.banked + count),
    );
  }

  traceOn(today: number): StreakTrace {
    return {
      state: this.stateOn(today),
      record:
        this.bestOn === null
          ? null
          : { value: this.best, on: dayOf(this.bestOn) },
      runStartedOn: this.startedOn(),
      counts: this.counts.map(({ on, current }) => ({
        on: dayOf(on),
        current,
      })),
      comebacks: this.comebacks.map(dayOf),
      judgedOn: this.judgedOn.map(dayOf),
    };
  }

  /** The account's `streaks[id]` as of `today`, or `null` before any counted visit. */
  private stateOn(today: number): StreakState | null {
    const { last, rule } = this;
    if (last === null) return null;
    const open = this.broken === null;
    return {
      streakId: rule.id,
      definitionVersion: rule.version,
      phase: this.phaseOn(today),
      current: this.current,
      best: this.best,
      lastQualifiedAt: last.at ?? startOf(dayOf(last.day)),
      dueBy: open ? dayOf(this.due() + this.pausedAfter(today)) : null,
      freezesBanked: this.banked,
      period: open ? this.terms : null,
      periods: this.marks.slice(-STREAK_PERIODS_KEPT),
      heldBy: open ? this.heldOn(today) : null,
      runStartedOn: this.startedOn(),
    };
  }

  /** The day the run in progress began, or `null` while the count is nothing. */
  private startedOn(): IsoDate | null {
    return this.current === 0 || this.runStartedOn === null
      ? null
      : dayOf(this.runStartedOn);
  }

  // ── The clock ────────────────────────────────────────────────────────

  /** A period opens on `anchor`, on the terms that are pinned. */
  private open(anchor: number): void {
    this.anchor = anchor;
    this.cover = null;
    this.covered = false;
    this.carriedBy = null;
  }

  /** The terms of the period that opens now (P5): the rule's one number, the person's habit, or the newcomer's default. */
  private termsNow(): StreakPeriodTerms {
    const { rule } = this;
    const known =
      rule.interval.kind === 'personal' &&
      this.counted >= HABIT_FROM_VISITS &&
      this.gaps.length > 0;
    const newest = this.gaps.slice(-HABIT_GAPS);
    // One decimal, the `cadenceOf` rule: a stable number to store.
    const habit = known
      ? Math.round(
          (newest.reduce((sum, gap) => sum + gap, 0) / newest.length) * 10,
        ) / 10
      : null;
    const { days, source } = rule.interval.daysFor(habit);
    return {
      intervalDays: days,
      graceDays: rule.graceDays,
      source,
      habitDays: source === 'personal' ? habit : null,
    };
  }

  private nominalDue(): number {
    return (this.anchor ?? 0) + (this.terms?.intervalDays ?? 0);
  }

  /** The due date: a cadence after the anchor, on the first day the shop is open. */
  private due(): number {
    let due = this.nominalDue();
    while (this.book.closed.has(due)) due += 1;
    return due;
  }

  /** The last day of grace: grace counts the days the shop is open. */
  private graceEnd(due: number): number {
    let end = due;
    let left = this.terms?.graceDays ?? 0;
    while (left > 0) {
      end += 1;
      if (!this.book.closed.has(end)) left -= 1;
    }
    return end;
  }

  /** The nightly judgement on `day`: it judges the day before. */
  private judge(day: number): void {
    if (this.anchor !== null && this.broken === null) {
      const due = this.due();
      const graceEnd = this.graceEnd(due);
      if (day > graceEnd && this.holdOn(day, due, graceEnd) === null) {
        this.miss(day, due);
      } else {
        this.draw(day, graceEnd);
      }
      this.pause(day);
    }
    const kind = this.phaseOn(day).kind;
    if (kind !== this.phaseKind) {
      this.phaseKind = kind;
      this.judgedOn.push(day);
    }
  }

  /** Nobody came and nothing on the book holds the period: a protection covers it, or it is the miss. */
  private miss(day: number, due: number): void {
    if (this.banked > 0) {
      this.banked -= 1;
      this.marks.push({ mark: 'protected', on: dayOf(due), reason: 'freeze' });
      // The due date it covered closes a period, and the next one opens on it.
      this.open(due);
      this.carriedBy = 'freeze';
      return;
    }
    this.marks.push({ mark: 'missed', on: dayOf(due), reason: null });
    this.broken = { on: day, run: this.current };
    if (this.rule.onBreak === 'restart') {
      this.current = 0;
      this.counts.push({ on: day, current: 0 });
    }
    this.cover = null;
    this.carriedBy = null;
  }

  /**
   * A period that outlived its own deadline is drawn as covered, once,
   * by what carried it: the excuse or the pause that moved its due date,
   * or the closed days that made it wait.
   */
  private draw(day: number, graceEnd: number): void {
    if (this.covered) return;
    const { cover } = this;
    if (cover !== null) {
      if (day <= cover.graceEnd) return;
      this.marks.push({
        mark: 'protected',
        on: dayOf(cover.due),
        reason: cover.reason,
      });
      this.cover = null;
      this.covered = true;
      // A pause freezes the run while it lasts and no longer: once it is
      // over the period is an open one like any other, its due date moved.
      if (cover.reason !== 'pause' && cover.reason !== 'clientPause') {
        this.carriedBy = 'excuse';
      }
      return;
    }
    const nominal = this.nominalDue();
    const nominalEnd = nominal + (this.terms?.graceDays ?? 0);
    if (graceEnd > nominalEnd && day > nominalEnd) {
      // Closed days made the deadline wait, and the wait is now in use.
      this.marks.push({
        mark: 'protected',
        on: dayOf(nominal),
        reason: 'closedDays',
      });
      this.covered = true;
      this.carriedBy = 'excuse';
    }
  }

  /** P10. A paused day does not tick: the period that is open waits a day. */
  private pause(day: number): void {
    if (this.anchor === null || this.broken !== null) return;
    const pause = this.pauseOn(day);
    if (pause === null) return;
    this.coverBy(pause.reason);
    this.anchor += 1;
  }

  /** Remembers the deadline a carrier is about to move: the FIRST of a period, the one it would have been judged by. */
  private coverBy(reason: Carrier): void {
    if (this.cover !== null || this.covered) return;
    const due = this.due();
    this.cover = { due, graceEnd: this.graceEnd(due), reason };
  }

  private pauseOn(day: number): Pause | null {
    return (
      this.book.pauses.find(
        (pause) => pause.from <= day && day <= pause.until,
      ) ?? null
    );
  }

  /**
   * The days a pause that is running on `day` still has to go: the due
   * date a state promises counts them in, so it does not creep a day
   * later with every day of the pause.
   */
  private pausedAfter(day: number): number {
    if (this.pauseOn(day) === null) return 0;
    let ahead = 0;
    while (this.pauseOn(day + ahead + 1) !== null) ahead += 1;
    return ahead;
  }

  /**
   * P4. The visit on the book that holds the period on `day`: placed
   * before the period's grace ran out, still ahead, and starting no later
   * than the rule allows past the due date.
   */
  private holdOn(
    day: number,
    due: number,
    graceEnd: number,
    from = day,
  ): Booking | null {
    const { bookingHold } = this.rule;
    if (!bookingHold.enabled) return null;
    const latest = due + bookingHold.maxDaysPastDue;
    return (
      this.book.bookings.find(
        (booking) =>
          booking.day >= from &&
          booking.day <= latest &&
          booking.placedOn <= Math.min(day, graceEnd),
      ) ?? null
    );
  }

  /** The visit the state names: the one ahead that the rule lets hold the open period. */
  private heldOn(today: number): StreakHold | null {
    if (this.anchor === null) return null;
    // A booking for today is the visit that counted today, not one ahead.
    const from = this.last?.day === today ? today + 1 : today;
    const due = this.due();
    const hold = this.holdOn(today, due, this.graceEnd(due), from);
    return hold === null || hold.appointmentId === null
      ? null
      : { appointmentId: hold.appointmentId, on: dayOf(hold.day) };
  }

  /** P11. Inside the window of the break, and the year's earn-backs not used up. */
  private repairableOn(brokenOn: number, day: number): boolean {
    const { repair } = this.rule;
    return (
      repair.enabled &&
      day - brokenOn <= repair.windowDays &&
      this.repairs.filter((on) => day - on < REPAIR_YEAR_DAYS).length <
        repair.perYear
    );
  }

  private phaseOn(day: number): StreakPhase {
    const { broken, rule } = this;
    if (broken !== null) {
      const lastDay = broken.on + rule.repair.windowDays;
      const restores =
        rule.onBreak === 'restart' && this.repairableOn(broken.on, lastDay);
      return {
        kind: 'broken',
        brokenAt: dayOf(broken.on),
        repairableUntil: dayOf(restores ? lastDay : broken.on - 1),
      };
    }
    if (this.anchor === null) return { kind: 'active' };
    const pause = this.pauseOn(day);
    if (pause !== null) {
      return {
        kind: 'frozen',
        until: dayOf(pause.until),
        reason: pause.reason,
      };
    }
    const due = this.due();
    if (day <= due) {
      if (this.carriedBy !== null) {
        return { kind: 'frozen', until: dayOf(due), reason: this.carriedBy };
      }
      return due - day <= rule.riskLeadDays
        ? { kind: 'atRisk', dueBy: dayOf(due) }
        : { kind: 'active' };
    }
    const graceEnd = this.graceEnd(due);
    const hold = day > graceEnd ? this.holdOn(day, due, graceEnd) : null;
    return { kind: 'inGrace', graceUntil: dayOf(hold?.day ?? graceEnd) };
  }
}

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
  if (!definition.enabled || !isIsoDate(today)) return NOTHING;
  const now = numberOf(today);
  const past = (day: IsoDate): boolean => isIsoDate(day) && day <= today;

  const steps: Step[] = [];
  const closed = new Set<number>();
  /** The days a booking ended the way the rule keeps: a counted visit, or a visit the shop called off. */
  const resolved = new Set<number>();
  for (const visit of facts.visits) {
    if (!visit.counted || !past(visit.day)) continue;
    const day = numberOf(visit.day);
    resolved.add(day);
    steps.push({ kind: 'visit', day, at: visit.at ?? null });
  }
  for (const excused of facts.excused) {
    if (!past(excused.day)) continue;
    const day = numberOf(excused.day);
    if (excused.reason === 'closedDays') {
      if (definition.isExcused('closedDays')) closed.add(day);
      continue;
    }
    if (definition.isExcused(excused.reason)) resolved.add(day);
    steps.push({ kind: 'excuse', day, reason: excused.reason });
  }
  for (const grant of facts.grants) {
    if (!past(grant.day) || !Number.isInteger(grant.count)) continue;
    steps.push({ kind: 'grant', day: numberOf(grant.day), count: grant.count });
  }
  steps.sort(
    (a, b) => a.day - b.day || STEP_ORDER[a.kind] - STEP_ORDER[b.kind],
  );

  const bookings = facts.bookings
    .filter(
      (booking) =>
        isIsoDate(booking.day) &&
        isIsoDate(booking.placedOn) &&
        booking.placedOn <= booking.day,
    )
    .map((booking): Booking => ({
      placedOn: numberOf(booking.placedOn),
      day: numberOf(booking.day),
      appointmentId: booking.appointmentId?.trim() || null,
    }))
    .filter((booking) => booking.day >= now || resolved.has(booking.day))
    .sort((a, b) => a.day - b.day || a.placedOn - b.placedOn);

  const run = new StreakRun(definition, {
    closed,
    pauses: pausesOf(definition, facts),
    bookings,
  });
  for (const step of steps) {
    run.advance(step.day);
    switch (step.kind) {
      case 'excuse':
        run.excuse(step.day, step.reason);
        break;
      case 'visit':
        run.visit(step.day, step.at);
        break;
      case 'grant':
        run.bank(step.count);
        break;
    }
  }
  run.advance(now);
  return run.traceOn(now);
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
