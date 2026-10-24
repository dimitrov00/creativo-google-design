import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  FreezeReason,
  StreakCapsule,
  StreakIntervalRule,
  StreakOutlook,
  STREAK_EXCUSES,
  STREAK_SHOP_EXCUSES,
  StreakExcuse,
  StreakPhase,
  StreakRule,
  StreakPhaseState,
  StreakState,
  type StreakPeriodFact,
} from '@core/components';
import {
  AppointmentId,
  LocalDate,
  StreakDefinitionId,
  UtcEpochMs,
} from '@core/primitives';
import {
  FIXTURE_TIME_ZONE,
  deepFreeze,
  localDate,
  loyaltyAccountFixtures,
  streakDefinitionFixture,
  unwrapOk,
  utcMs,
} from '@core/testing';
import { ClientStatsSystem } from './client-stats.system';
import { StreakRuleSystem } from './streak-rule.system';
import {
  StreakSystem,
  StreakTrackMarkKind,
  type StreakFacts as SystemFacts,
  type StreakOutlookView,
  type StreakTrace,
} from './streak.system';
import { ZonedTimeSystem } from './zoned-time.system';

/** An instant a case names: a safe epoch-ms inside the readable years. */
const instant = (ms: number): UtcEpochMs => unwrapOk(UtcEpochMs.of(ms));

/*
 * The cases of the legacy engagement `streak-projector.spec.ts` (deleted in
 * Phase 4b; ledger `docs/architecture/flips/phase-4b-delete.md` §11.1), COPIED,
 * never moved, while it still ran against the projector's shim. Every case body
 * is the legacy one; only this header changed, so the subject is
 * `StreakSystem.trace`. A version of the rule is the plain `StreakRule`
 * struct, the facts are written as the legacy spec wrote them and made strict
 * by `strict` (absent is `null`), and an instant is epoch ms (`lastQualifiedAt:
 * Date` → `lastQualifiedAtUtcMs`). After the copy: the purity case of the
 * system contract, and the cases of the two presenter functions the system took
 * over (`inChairDue`, `track`).
 *
 * Flattened (Laws 6 and 7): the rule's parts are its flat fields
 * (`protectionsMaxBanked`, `repairEnabled`, the interval slice), the
 * state's phase is the variant slice `streakPhase` + `phase*` (read whole
 * through `phaseOf`), its open period `period*` (read as terms through
 * `periodOf`), the visit that holds it `heldByAppointmentId` + `heldOn`,
 * and every tag is SCREAMING. The system reads no zone: `strict` stamps a
 * visit known by its day alone with the first instant of that day in Sofia
 * (`ZonedTimeSystem.startOfLocalDay`, T3), as the boundary does — so the
 * instants the cases expect are the ones they always were.
 */

const STREAK_ID = StreakRule.DEFAULT_DEFINITION_ID;
const STREAK_PERIODS_KEPT = StreakState.PERIODS_KEPT;

/** The facts as the legacy spec writes them: days as text, the instant and the visit's id left out where nobody has one. */
type StreakFacts = {
  readonly visits: readonly {
    readonly day: string;
    readonly counted: boolean;
    readonly atMs?: number;
  }[];
  readonly excused: readonly {
    readonly day: string;
    readonly reason: StreakExcuse;
  }[];
  readonly bookings: readonly {
    readonly placedOn: string;
    readonly day: string;
    readonly appointmentId?: string;
  }[];
  readonly pauses: readonly {
    readonly from: string;
    readonly until: string;
    readonly reason: 'PAUSE' | 'CLIENT_PAUSE';
  }[];
  readonly grants: readonly {
    readonly day: string;
    readonly count: number;
  }[];
};

/**
 * A shop day as a fact carries it: a real one branded, a corrupt one (a
 * stored value nobody guarded) passed through as written — what the
 * system's own day check is there for.
 */
function shopDay(raw: string): LocalDate {
  const parsed = LocalDate.parse(raw);
  return parsed.ok ? parsed.value : (raw as LocalDate);
}

/** The instant a visit began: the one it came with, else the first of its shop day (the epoch for a day that is no day). */
function startOf(raw: string, atMs: number | undefined): UtcEpochMs {
  if (atMs !== undefined) return instant(atMs);
  const parsed = LocalDate.parse(raw);
  return parsed.ok
    ? ZonedTimeSystem.startOfLocalDay(parsed.value, FIXTURE_TIME_ZONE)
    : instant(0);
}

/** Every field present: what the system reads. */
function strict(facts: StreakFacts): SystemFacts {
  return {
    visits: facts.visits.map((visit) => ({
      localDate: shopDay(visit.day),
      counted: visit.counted,
      utcEpochMs: startOf(visit.day, visit.atMs),
    })),
    excused: facts.excused.map((excused) => ({
      localDate: shopDay(excused.day),
      reason: excused.reason,
    })),
    bookings: facts.bookings.map((booking) => ({
      placedOn: shopDay(booking.placedOn),
      localDate: shopDay(booking.day),
      appointmentId:
        booking.appointmentId === undefined
          ? null
          : AppointmentId.of(booking.appointmentId),
    })),
    pauses: facts.pauses.map((pause) => ({
      from: shopDay(pause.from),
      until: shopDay(pause.until),
      reason: pause.reason,
    })),
    grants: facts.grants.map((grant) => ({
      localDate: shopDay(grant.day),
      count: grant.count,
    })),
  };
}

/** The legacy `traceStreak`, re-targeted. */
function traceStreak(
  definition: StreakRule,
  facts: StreakFacts,
  today: string,
): StreakTrace {
  return StreakSystem.trace(
    STREAK_ID,
    definition,
    strict(facts),
    shopDay(today),
  );
}

/** The legacy `projectStreak`, re-targeted. */
function projectStreak(
  definition: StreakRule,
  facts: StreakFacts,
  today: string,
): StreakState | null {
  return traceStreak(definition, facts, today).state;
}

/** The calendar day `days` after `day`: civil arithmetic, no zone. */
const addDays = (from: string, days: number): string =>
  LocalDate.addDays(localDate(from), days);

/** The shop day an instant falls on. */
function sofiaDayOf(ms: number): string {
  return ZonedTimeSystem.toLocal(instant(ms), FIXTURE_TIME_ZONE).localDate;
}

/** The phase slice of a state, whole: its tag and every `phase*` field it carries — nothing of another variant may linger. */
function phaseOf(state: StreakState): Record<string, unknown> {
  const phase: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(state)) {
    if (key === 'streakPhase' || key.startsWith('phase')) phase[key] = value;
  }
  return phase;
}

/** A state without its phase slice: what two rules that differ by the cue alone must agree on. */
function apartFromPhase(state: StreakState): Record<string, unknown> {
  const rest: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(state)) {
    if (key !== 'streakPhase' && !key.startsWith('phase')) rest[key] = value;
  }
  return rest;
}

/** The open period's terms as the projector pinned them (`StreakState.periodTerms`), `null` while none is open. */
function periodOf(
  state: StreakState | null | undefined,
): ReturnType<typeof StreakState.periodTerms> {
  return state === null || state === undefined
    ? null
    : StreakState.periodTerms(state);
}

/** The visit on the book that holds the period: both fields, `null` together. */
const heldOf = (state: StreakState) => ({
  heldByAppointmentId: state.heldByAppointmentId,
  heldOn: state.heldOn,
});

/** The seed's own day: Георги's cut is done, Мартин is in the chair. */
const TODAY = '2026-09-28';
const day = (offset: number): string => addDays(TODAY, offset);

/** The recommended rule with `patch` over it: a part in the patch replaces the whole part. */
function rule(patch: Partial<StreakRule> = {}): StreakRule {
  const result = StreakRule.parse({
    ...StreakRule.DEFAULT,
    ...patch,
  } as StreakRule);
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.value;
}

const DEFAULT = rule();
const OFF = { enabled: false } as const;
const NO_EARN_BACK = {
  repairEnabled: false,
  repairWindowDays: 14,
  repairPerYear: 1,
} as const;
const NO_PROTECTIONS = {
  protectionsEnabled: false,
  protectionsMaxBanked: 2,
  protectionsEarnEvery: 5,
  protectionsStartWith: 0,
} as const;

function facts(patch: Partial<StreakFacts> = {}): StreakFacts {
  return {
    visits: [],
    excused: [],
    bookings: [],
    pauses: [],
    grants: [],
    ...patch,
  };
}

/** Counted visits on the days `offsets` from today. */
const visitsAt = (offsets: readonly number[]): StreakFacts['visits'] =>
  offsets.map((offset) => ({ day: day(offset), counted: true }));

/** Five days after the last of `offsets`: the run as it stood then (the seed spec's `soonAfter`). */
const soonAfter = (offsets: readonly number[]): string =>
  day(Math.max(...offsets) + 5);

function stateOf(
  definition: StreakRule,
  patch: Partial<StreakFacts>,
  today = TODAY,
) {
  const state = projectStreak(definition, facts(patch), today);
  if (state === null) throw new Error('no state: nobody counted yet');
  return state;
}

const marks = (periods: readonly StreakPeriodFact[]): string[] =>
  periods.map(({ streakPeriodMark, on, periodReason }) =>
    periodReason === null
      ? `${streakPeriodMark} ${on}`
      : `${streakPeriodMark} ${on} ${periodReason}`,
  );

// ── The seed's expectations, ported (tools/seed/loyalty.spec.mjs) ─────────

const GEORGI = [
  '2025-03-01',
  '2025-03-22',
  '2025-04-15',
  '2025-05-07',
  '2025-05-31',
  '2025-06-21',
  '2025-07-16',
  '2025-08-08',
  '2025-08-30',
  '2025-09-23',
  '2025-10-14',
  '2025-11-11',
  '2025-12-08',
  '2026-01-05',
  '2026-01-31',
  '2026-02-28',
  '2026-03-27',
  '2026-04-23',
  '2026-05-19',
  '2026-06-13',
  '2026-07-11',
  '2026-08-07',
  '2026-09-04',
  '2026-09-28',
] as const;

const MARTIN = [
  '2025-05-06',
  '2025-06-12',
  '2025-07-22',
  '2025-08-30',
  '2025-10-04',
  '2025-11-15',
  '2025-12-27',
  '2026-02-07',
  '2026-03-21',
  '2026-04-28',
  '2026-06-04',
  '2026-07-14',
  '2026-08-21',
] as const;

/** «В ритъм» II (6 in rhythm) pays one protection: the seed's families grant it on the sixth visit. */
const georgi = facts({
  visits: GEORGI.map((on, index) => ({
    day: on,
    counted: true,
    // His cut today began at 10:00 in Sofia.
    ...(index === GEORGI.length - 1
      ? { atMs: utcMs('2026-09-28T07:00:00.000Z') }
      : {}),
  })),
  grants: [{ day: '2025-06-21', count: 1 }],
  bookings: [
    { placedOn: '2026-09-04', day: '2026-09-28', appointmentId: 'appt-dev-1' },
  ],
});

/** Иван was off sick on 9 May: the shop called Мартин's visit off. */
const martin = facts({
  visits: MARTIN.map((on) => ({ day: on, counted: true })),
  excused: [{ day: '2026-05-09', reason: 'BARBER_ABSENCE' }],
  grants: [{ day: '2025-11-15', count: 1 }],
  bookings: [
    { placedOn: '2026-09-21', day: '2026-09-28', appointmentId: 'appt-dev-2' },
  ],
});

describe('projectStreak, the seeded story', () => {
  it('Георги: 24 in rhythm, never broken, two protections in reserve', () => {
    const trace = traceStreak(DEFAULT, georgi, TODAY);
    expect(trace.state).toEqual({
      streakId: 'cadence',
      definitionVersion: 1,
      streakPhase: 'ACTIVE',
      current: 24,
      best: 24,
      lastQualifiedAtUtcMs: utcMs('2026-09-28T07:00:00.000Z'),
      dueBy: '2026-11-09',
      freezesBanked: 2,
      periodIntervalDays: 42,
      periodGraceDays: 7,
      periodSource: 'FIXED',
      periodHabitDays: null,
      periods: GEORGI.slice(-12).map((on) => ({
        streakPeriodMark: 'KEPT',
        on,
        periodReason: null,
      })),
      // Today's booking is the visit that counted: nothing lies ahead.
      heldByAppointmentId: null,
      heldOn: null,
      // His first visit: twelve periods before the oldest the track keeps.
      runStartedOn: '2025-03-01',
    });
    expect(trace.record).toEqual({ value: 24, on: '2026-09-28' });
    expect(trace.runStartedOn).toBe('2025-03-01');
    expect(trace.comebacks).toEqual([]);
  });

  it('Мартин: 13 in rhythm and due, the visit the shop called off never a mark', () => {
    const state = stateOf(DEFAULT, martin);
    expect(state).toMatchObject({
      current: 13,
      best: 13,
      streakPhase: 'AT_RISK',
      phaseDueBy: '2026-10-02',
      dueBy: '2026-10-02',
      freezesBanked: 2,
      // He is on the book for today, inside the period.
      heldByAppointmentId: 'appt-dev-2',
      heldOn: '2026-09-28',
    });
    // 37 days lie between the visits around 9 May: he came in time by
    // himself, so the excuse was never needed and is not drawn.
    expect(marks(state.periods)).toEqual(
      MARTIN.slice(-12).map((on) => `KEPT ${on}`),
    );
    // No instant came with the fact: the day's own beginning in Sofia.
    expect(state.lastQualifiedAtUtcMs).toEqual(
      utcMs('2026-08-20T21:00:00.000Z'),
    );
  });

  it('stays in rhythm inside the cadence and its grace, at risk a week before it is due', () => {
    // Due on day +2 of a 42-day cadence: inside the 7-day risk lead.
    expect(stateOf(DEFAULT, { visits: visitsAt([-80, -40]) })).toMatchObject({
      current: 2,
      best: 2,
      streakPhase: 'AT_RISK',
      phaseDueBy: day(2),
      dueBy: day(2),
    });
    expect(phaseOf(stateOf(DEFAULT, { visits: visitsAt([-80, -30]) }))).toEqual(
      { streakPhase: 'ACTIVE' },
    );
    // Past due, inside the grace: still the same run.
    expect(phaseOf(stateOf(DEFAULT, { visits: visitsAt([-80, -45]) }))).toEqual(
      { streakPhase: 'IN_GRACE', phaseGraceUntil: day(4) },
    );
    // A visit 49 days on (42 + 7 grace) keeps the run.
    const kept = stateOf(DEFAULT, { visits: visitsAt([-60, -11]) });
    expect(kept.current).toBe(2);
    expect(marks(kept.periods)).toEqual([
      `KEPT ${day(-60)}`,
      `KEPT ${day(-11)}`,
    ]);
  });

  it('breaks the run a day past the grace, and comes back on the next run’s second visit', () => {
    const offsets = [-300, -270, -240, -150, -120, -90, -60, -30];
    const trace = traceStreak(
      DEFAULT,
      facts({ visits: visitsAt(offsets) }),
      TODAY,
    );
    expect(trace.state).toMatchObject({ current: 5, best: 5 });
    expect(trace.comebacks).toEqual([day(-120)]);
    expect(trace.runStartedOn).toBe(day(-150));
    // Long gone since: broken on the day after the grace, repairable for 14 days.
    const gone = traceStreak(
      DEFAULT,
      facts({ visits: visitsAt([-300, -270, -240]) }),
      TODAY,
    );
    expect(gone.state).toMatchObject({
      current: 0,
      best: 3,
      dueBy: null,
      periodIntervalDays: null,
      periodGraceDays: null,
      periodSource: null,
      periodHabitDays: null,
      heldByAppointmentId: null,
      heldOn: null,
      streakPhase: 'BROKEN',
      phaseBrokenOn: day(-240 + 50),
      phaseRepairableUntil: day(-240 + 64),
    });
    expect(marks(gone.state?.periods ?? [])).toEqual([
      `KEPT ${day(-300)}`,
      `KEPT ${day(-270)}`,
      `KEPT ${day(-240)}`,
      // The due date nobody met, not the day it was judged.
      `MISSED ${day(-240 + 42)}`,
    ]);
    expect(gone.record).toEqual({ value: 3, on: day(-240) });
    expect(gone.runStartedOn).toBeNull();
  });

  it('restores the run for the first visit inside the repair window, once a year', () => {
    // Broken on day −190; back five days later.
    const offsets = [-300, -270, -240, -185];
    const repaired = traceStreak(
      DEFAULT,
      facts({ visits: visitsAt(offsets) }),
      soonAfter(offsets),
    );
    expect(repaired.state?.current).toBe(4);
    expect(repaired.comebacks).toEqual([]);
    expect(repaired.runStartedOn).toBe(day(-300));
    expect(marks(repaired.state?.periods ?? []).slice(-2)).toEqual([
      `MISSED ${day(-198)}`,
      `REPAIRED ${day(-185)}`,
    ]);
    // Broken again on day −135 and back in five days: not a second time in a year.
    const later = [...offsets, -130, -100];
    const again = traceStreak(
      DEFAULT,
      facts({ visits: visitsAt(later) }),
      soonAfter(later),
    );
    expect(again.state).toMatchObject({ current: 2, best: 4 });
    expect(again.comebacks).toEqual([day(-100)]);
  });

  it('spends a banked «защита» on a missed cadence instead of breaking', () => {
    // Five in rhythm bank one; the sixth comes 80 days on (> 49, one period covered).
    const offsets = [-400, -370, -340, -310, -280, -200];
    const state = stateOf(
      DEFAULT,
      {
        visits: visitsAt(offsets),
        // «В ритъм» II, earned by that sixth visit, pays another.
        grants: [{ day: day(-200), count: 1 }],
      },
      soonAfter(offsets),
    );
    expect(state.current).toBe(6);
    expect(state.freezesBanked).toBe(1);
    expect(marks(state.periods).slice(-2)).toEqual([
      `PROTECTED ${day(-280 + 42)} FREEZE`,
      `KEPT ${day(-200)}`,
    ]);
    // Without the fifth visit nothing was banked: the gap breaks the run.
    const unbanked = [-400, -370, -340, -310, -200];
    expect(
      stateOf(DEFAULT, { visits: visitsAt(unbanked) }, soonAfter(unbanked))
        .current,
    ).toBe(1);
  });

  it('restarts the due clock from a visit the shop called off', () => {
    // 80 days between the two visits, but only 45 since the one Иван missed.
    const visits = visitsAt([-200, -120]);
    const state = stateOf(
      DEFAULT,
      { visits, excused: [{ day: day(-165), reason: 'BARBER_ABSENCE' }] },
      day(-115),
    );
    expect(state.current).toBe(2);
    // The period outlived its own deadline: drawn as covered, the reason named.
    expect(marks(state.periods)).toEqual([
      `KEPT ${day(-200)}`,
      `PROTECTED ${day(-200 + 42)} BARBER_ABSENCE`,
      `KEPT ${day(-120)}`,
    ]);
    expect(stateOf(DEFAULT, { visits }, day(-115)).current).toBe(1);
  });
});

// ── One case per parameter ────────────────────────────────────────────────

describe('projectStreak, nothing to project', () => {
  it('is null before the first counted visit', () => {
    expect(projectStreak(DEFAULT, facts(), TODAY)).toBeNull();
    expect(
      projectStreak(
        DEFAULT,
        facts({
          visits: [{ day: day(-10), counted: false }],
          grants: [{ day: day(-10), count: 2 }],
        }),
        TODAY,
      ),
    ).toBeNull();
  });

  it('P1: projects nothing under a rule that is switched off', () => {
    expect(traceStreak(rule(OFF), georgi, TODAY)).toEqual({
      state: null,
      record: null,
      runStartedOn: null,
      counts: [],
      comebacks: [],
      judgedOn: [],
    });
  });

  it('leaves out what has not happened yet, and what is no calendar day', () => {
    const state = stateOf(DEFAULT, {
      visits: [
        ...visitsAt([-30, 5]),
        { day: '2026-02-30', counted: true },
        { day: 'yesterday', counted: true },
      ],
      excused: [{ day: day(3), reason: 'SHOP_CLOSURE' }],
      grants: [
        { day: day(1), count: 2 },
        { day: day(-30), count: 0.5 },
      ],
    });
    expect(state).toMatchObject({
      current: 1,
      freezesBanked: 0,
      dueBy: day(12),
    });
    expect(projectStreak(DEFAULT, georgi, 'today')).toBeNull();
  });

  it('is pure: the same rule, facts and day are the same state, and the facts are not touched', () => {
    const frozen = facts({
      visits: Object.freeze([...martin.visits].reverse()),
      excused: Object.freeze([...martin.excused]),
      grants: Object.freeze([...martin.grants]),
      bookings: Object.freeze([...martin.bookings]),
    });
    // In any order: the fold sorts what it is given.
    expect(projectStreak(DEFAULT, frozen, TODAY)).toEqual(
      projectStreak(DEFAULT, martin, TODAY),
    );
  });
});

describe('projectStreak, what counts (P2, P3)', () => {
  it('P2: a visit the qualifier refused neither counts nor moves the clock', () => {
    const state = stateOf(DEFAULT, {
      visits: [
        { day: day(-40), counted: true },
        { day: day(-10), counted: false },
      ],
    });
    expect(state).toMatchObject({ current: 1, dueBy: day(2) });
    expect(sofiaDayOf(state.lastQualifiedAtUtcMs ?? 0)).toBe(day(-40));
  });

  it('P3: a visit closer than the minimum gap moves the due date and adds nothing', () => {
    // The same haircut, fixed up three days later.
    const fixedUp = stateOf(DEFAULT, { visits: visitsAt([-40, -37]) });
    expect(fixedUp).toMatchObject({ current: 1, best: 1, dueBy: day(5) });
    expect(marks(fixedUp.periods)).toEqual([`KEPT ${day(-40)}`]);
    expect(sofiaDayOf(fixedUp.lastQualifiedAtUtcMs ?? 0)).toBe(day(-40));
    // On the seventh day it is a visit of its own.
    expect(stateOf(DEFAULT, { visits: visitsAt([-40, -33]) }).current).toBe(2);
    // The gap is measured from the last visit that COUNTED: day −33 is
    // four days after the fix-up and seven after the cut.
    expect(
      stateOf(DEFAULT, { visits: visitsAt([-40, -37, -33]) }).current,
    ).toBe(2);
    // With no minimum every visit counts, two on one day too.
    const every = rule({ minGapDays: 0 });
    expect(stateOf(every, { visits: visitsAt([-40, -37]) }).current).toBe(2);
    expect(stateOf(every, { visits: visitsAt([-40, -40]) }).current).toBe(2);
  });
});

describe('projectStreak, a visit on the book (P4)', () => {
  // Last in 50 days ago: due on day −8, the grace ran out yesterday.
  const visits = visitsAt([-50]);
  const booked = (placedOn: number, on: number, appointmentId?: string) => ({
    placedOn: day(placedOn),
    day: day(on),
    ...(appointmentId === undefined ? {} : { appointmentId }),
  });

  it('holds the period past its grace until the visit, and names it', () => {
    const state = stateOf(DEFAULT, {
      visits,
      bookings: [booked(-10, 3, 'appt-7')],
    });
    expect(state).toMatchObject({
      current: 1,
      dueBy: day(-8),
      streakPhase: 'IN_GRACE',
      phaseGraceUntil: day(3),
      heldByAppointmentId: 'appt-7',
      heldOn: day(3),
    });
    expect(marks(state.periods)).toEqual([`KEPT ${day(-50)}`]);
  });

  it('is the miss without one', () => {
    expect(stateOf(DEFAULT, { visits })).toMatchObject({
      current: 0,
      heldByAppointmentId: null,
      heldOn: null,
      streakPhase: 'BROKEN',
      phaseBrokenOn: day(0),
      phaseRepairableUntil: day(14),
    });
  });

  it.each([
    ['later than the rule allows past the due date', booked(-10, 7, 'a')],
    ['placed after the grace ran out', booked(0, 3, 'a')],
  ])('does not hold when %s', (_label, booking) => {
    expect(stateOf(DEFAULT, { visits, bookings: [booking] }).streakPhase).toBe(
      'BROKEN',
    );
  });

  it('holds to the last day the rule allows, and not at all when the hold is off', () => {
    expect(
      heldOf(stateOf(DEFAULT, { visits, bookings: [booked(-1, 6, 'a')] })),
    ).toEqual({ heldByAppointmentId: 'a', heldOn: day(6) });
    const off = rule({
      bookingHoldEnabled: false,
      bookingHoldMaxDaysPastDue: 14,
    });
    expect(
      stateOf(off, { visits, bookings: [booked(-10, 3, 'a')] }),
    ).toMatchObject({
      heldByAppointmentId: null,
      heldOn: null,
      streakPhase: 'BROKEN',
    });
  });

  it('holds the clock for a booking nobody named, and names no visit', () => {
    expect(
      stateOf(DEFAULT, { visits, bookings: [booked(-10, 3)] }),
    ).toMatchObject({
      heldByAppointmentId: null,
      heldOn: null,
      streakPhase: 'IN_GRACE',
      phaseGraceUntil: day(3),
    });
  });

  it('keeps the run for the booked visit that was worked, with nothing to repair', () => {
    // 55 days apart: six past the grace, on the book since day −60.
    const held = traceStreak(
      DEFAULT,
      facts({ visits: visitsAt([-100, -45]), bookings: [booked(-60, -45)] }),
      day(-40),
    );
    expect(held.state?.current).toBe(2);
    expect(marks(held.state?.periods ?? [])).toEqual([
      `KEPT ${day(-100)}`,
      `KEPT ${day(-45)}`,
    ]);
    // Walking in unannounced, the same visit is the year's one earn-back.
    const walkedIn = stateOf(
      DEFAULT,
      { visits: visitsAt([-100, -45]) },
      day(-40),
    );
    expect(marks(walkedIn.periods)).toEqual([
      `KEPT ${day(-100)}`,
      `MISSED ${day(-58)}`,
      `REPAIRED ${day(-45)}`,
    ]);
  });

  it('releases a booking nobody came to: judged as if it never existed', () => {
    expect(
      phaseOf(
        stateOf(
          DEFAULT,
          { visits: visitsAt([-100]), bookings: [booked(-60, -45, 'a')] },
          day(-40),
        ),
      ),
    ).toEqual({
      streakPhase: 'BROKEN',
      phaseBrokenOn: day(-50),
      phaseRepairableUntil: day(-36),
    });
  });

  it('holds for the booked visit the shop then called off, and restarts the clock from it', () => {
    const state = stateOf(
      DEFAULT,
      {
        visits: visitsAt([-100]),
        bookings: [booked(-60, -45, 'a')],
        excused: [{ day: day(-45), reason: 'STAFF_CANCELLED' }],
      },
      day(-40),
    );
    expect(state).toMatchObject({
      current: 1,
      dueBy: day(-3),
      streakPhase: 'FROZEN',
      phaseFrozenUntil: day(-3),
      phaseFreezeReason: 'EXCUSE',
    });
    expect(marks(state.periods)).toEqual([
      `KEPT ${day(-100)}`,
      `PROTECTED ${day(-58)} STAFF_CANCELLED`,
    ]);
  });

  it('names the visit ahead in a healthy period too', () => {
    expect(
      stateOf(DEFAULT, {
        visits: visitsAt([-10]),
        bookings: [booked(-10, 25, 'next')],
      }),
    ).toMatchObject({
      streakPhase: 'ACTIVE',
      heldByAppointmentId: 'next',
      heldOn: day(25),
    });
  });
});

describe('projectStreak, the interval (P5)', () => {
  it('fixed: one number for everyone, pinned on the period', () => {
    const five = rule({ ...StreakIntervalRule.fixed(35) });
    expect(stateOf(five, { visits: visitsAt([-10]) })).toMatchObject({
      dueBy: day(25),
      periodIntervalDays: 35,
      periodGraceDays: 7,
      periodSource: 'FIXED',
      periodHabitDays: null,
    });
  });

  const personal = rule({
    ...StreakIntervalRule.personal(50, 21, 70, 42),
  });
  /** Visits `gap` days apart, the last of them `last` days from today. */
  const every = (gap: number, count: number, last = -1) =>
    visitsAt(
      Array.from({ length: count }, (_, i) => last - gap * (count - 1 - i)),
    );

  it('personal: the newcomer’s default until the third counted visit', () => {
    expect(stateOf(personal, { visits: every(26, 2) })).toMatchObject({
      dueBy: day(41),
      periodIntervalDays: 42,
      periodSource: 'FALLBACK',
      periodHabitDays: null,
    });
  });

  it.each([
    // The report's worked examples, tolerance 50 %, clamp 21–70.
    ['Георги, a fade every 26 days', 26, 39],
    ['Мартин, every 38 days', 38, 57],
    ['a habit of 60 days, held under the ceiling', 60, 70],
    ['a habit of 8 days, held over the floor', 8, 21],
  ])('personal: %s', (_label, habit, interval) => {
    expect(
      stateOf(rule({ ...personal, minGapDays: 0 }), {
        visits: every(habit, 3),
      }),
    ).toMatchObject({
      dueBy: day(-1 + interval),
      periodIntervalDays: interval,
      periodSource: 'PERSONAL',
      periodHabitDays: habit,
    });
  });

  it('personal: a newcomer slower than the default misses before anybody knows the habit', () => {
    // Every 60 days against a default of 42 + 7: the second visit is the
    // year's earn-back, the third starts over. What the ceiling is for.
    const trace = traceStreak(personal, facts({ visits: every(60, 3) }), TODAY);
    expect(trace.counts.map(({ current }) => current)).toEqual([1, 0, 2, 0, 1]);
    expect(periodOf(trace.state)).toMatchObject({
      intervalDays: 70,
      habitDays: 60,
    });
  });

  it('personal: the habit is the mean of the last six counted gaps', () => {
    // Eight gaps of 50, then six of 20: only the six are the habit.
    const offsets = [
      ...Array.from({ length: 9 }, (_, i) => -521 + 50 * i),
      ...Array.from({ length: 6 }, (_, i) => -101 + 20 * i),
    ];
    expect(
      periodOf(stateOf(personal, { visits: visitsAt(offsets) })),
    ).toMatchObject({ habitDays: 20, intervalDays: 30 });
    // One decimal: 26, 26, 27 days.
    expect(
      periodOf(stateOf(personal, { visits: visitsAt([-80, -54, -28, -1]) })),
    ).toMatchObject({ habitDays: 26.3, intervalDays: 39 });
  });

  it('personal: a gap the shop stretched says nothing about the person', () => {
    const visits = visitsAt([-100, -60, -34]);
    expect(
      periodOf(
        stateOf(personal, {
          visits,
          excused: [{ day: day(-80), reason: 'BARBER_ABSENCE' }],
        }),
      ),
    ).toMatchObject({ habitDays: 26, intervalDays: 39 });
    expect(periodOf(stateOf(personal, { visits }))).toMatchObject({
      habitDays: 33,
      intervalDays: 50,
    });
  });

  it('personal: a fix-up moves the due date on the terms already pinned', () => {
    const state = stateOf(personal, {
      visits: [...every(26, 3, -10), { day: day(-7), counted: true }],
    });
    expect(state).toMatchObject({
      current: 3,
      dueBy: day(-7 + 39),
      periodIntervalDays: 39,
      periodSource: 'PERSONAL',
      periodHabitDays: 26,
    });
  });
});

describe('projectStreak, grace and the cue (P6, P7)', () => {
  it('P6: the last day of grace keeps the run, the day after breaks it', () => {
    const short = rule({ graceDays: 3, ...NO_EARN_BACK });
    expect(stateOf(short, { visits: visitsAt([-60, -15]) }).current).toBe(2);
    expect(stateOf(short, { visits: visitsAt([-60, -14]) }).current).toBe(1);
    const none = rule({ graceDays: 0, ...NO_EARN_BACK });
    expect(phaseOf(stateOf(none, { visits: visitsAt([-42]) }))).toEqual({
      streakPhase: 'AT_RISK',
      phaseDueBy: day(0),
    });
    expect(stateOf(none, { visits: visitsAt([-43]) }).streakPhase).toBe(
      'BROKEN',
    );
  });

  it('P6: the grace is pinned with the period', () => {
    expect(
      stateOf(rule({ graceDays: 3 }), { visits: visitsAt([-44]) }),
    ).toMatchObject({
      streakPhase: 'IN_GRACE',
      phaseGraceUntil: day(1),
      periodGraceDays: 3,
    });
  });

  it('P7: the cue turns as early as the rule says, and changes nothing else', () => {
    const early = rule({ riskLeadDays: 14 });
    // Due on day +14.
    expect(phaseOf(stateOf(early, { visits: visitsAt([-28]) }))).toEqual({
      streakPhase: 'AT_RISK',
      phaseDueBy: day(14),
    });
    expect(phaseOf(stateOf(early, { visits: visitsAt([-27]) }))).toEqual({
      streakPhase: 'ACTIVE',
    });
    const late = rule({ riskLeadDays: 0 });
    expect(stateOf(late, { visits: visitsAt([-41]) }).streakPhase).toBe(
      'ACTIVE',
    );
    expect(stateOf(late, { visits: visitsAt([-42]) }).streakPhase).toBe(
      'AT_RISK',
    );
    // Мартин is due in four days: the cue is all the two rules differ by.
    const cued = stateOf(early, martin);
    const quiet = stateOf(late, martin);
    expect(phaseOf(cued)).toEqual({
      streakPhase: 'AT_RISK',
      phaseDueBy: '2026-10-02',
    });
    expect(phaseOf(quiet)).toEqual({ streakPhase: 'ACTIVE' });
    expect(apartFromPhase(cued)).toEqual(apartFromPhase(quiet));
  });
});

describe('projectStreak, protections (P8)', () => {
  const offsets = [-400, -370, -340, -310, -280, -200];

  it('carries the period on a used protection until its moved due date', () => {
    // Judged on day −230: the due date −238 is covered and moves one interval on.
    const state = stateOf(
      DEFAULT,
      { visits: visitsAt(offsets.slice(0, 5)) },
      day(-220),
    );
    expect(state).toMatchObject({
      current: 5,
      freezesBanked: 0,
      dueBy: day(-196),
      streakPhase: 'FROZEN',
      phaseFrozenUntil: day(-196),
      phaseFreezeReason: 'FREEZE',
    });
    expect(marks(state.periods).at(-1)).toBe(`PROTECTED ${day(-238)} FREEZE`);
  });

  it('covers one due date each: two protections carry a run across two', () => {
    const two = rule({
      protectionsEnabled: true,
      protectionsMaxBanked: 2,
      protectionsEarnEvery: 2,
      protectionsStartWith: 0,
    });
    // Four in rhythm bank two; the fifth comes 130 days on (≤ 3 × 42 + 7).
    const state = stateOf(two, {
      visits: visitsAt([-250, -220, -190, -160, -30]),
    });
    expect(state).toMatchObject({ current: 5, freezesBanked: 0 });
    expect(marks(state.periods).slice(-3)).toEqual([
      `PROTECTED ${day(-118)} FREEZE`,
      `PROTECTED ${day(-76)} FREEZE`,
      `KEPT ${day(-30)}`,
    ]);
  });

  it('off: nothing is earned, given or spent', () => {
    const state = stateOf(
      rule({ ...NO_PROTECTIONS }),
      { visits: visitsAt(offsets), grants: [{ day: day(-340), count: 2 }] },
      soonAfter(offsets),
    );
    expect(state).toMatchObject({ current: 1, best: 5, freezesBanked: 0 });
  });

  it('earns one every so many counted visits of the run', () => {
    const three = rule({
      protectionsEnabled: true,
      protectionsMaxBanked: 5,
      protectionsEarnEvery: 3,
      protectionsStartWith: 0,
    });
    const offsets = [-180, -150, -120, -90, -60, -30];
    const banked = (count: number) =>
      stateOf(
        three,
        { visits: visitsAt(offsets.slice(0, count)) },
        soonAfter(offsets.slice(0, count)),
      ).freezesBanked;
    expect([1, 2, 3, 4, 5, 6].map(banked)).toEqual([0, 0, 1, 1, 1, 2]);
  });

  it('never holds more than the reserve', () => {
    const one = rule({
      protectionsEnabled: true,
      protectionsMaxBanked: 1,
      protectionsEarnEvery: 1,
      protectionsStartWith: 1,
    });
    expect(
      stateOf(one, {
        visits: visitsAt([-90, -60, -30]),
        grants: [{ day: day(-60), count: 3 }],
      }).freezesBanked,
    ).toBe(1);
    const none = rule({
      protectionsEnabled: true,
      protectionsMaxBanked: 0,
      protectionsEarnEvery: 1,
      protectionsStartWith: 0,
    });
    expect(
      stateOf(none, { visits: visitsAt([-90, -60, -30]) }).freezesBanked,
    ).toBe(0);
  });

  it('starts a client with some, once: a restart does not give them again', () => {
    const gift = rule({
      protectionsEnabled: true,
      protectionsMaxBanked: 2,
      protectionsEarnEvery: 24,
      protectionsStartWith: 1,
      ...NO_EARN_BACK,
    });
    expect(stateOf(gift, { visits: visitsAt([-30]) }).freezesBanked).toBe(1);
    // 80 days on: the gift covers the one missed due date.
    expect(stateOf(gift, { visits: visitsAt([-100, -20]) })).toMatchObject({
      current: 2,
      freezesBanked: 0,
    });
    // 200 days on: spent on the first due date, and the second is the miss.
    const long = [-300, -100];
    expect(
      stateOf(gift, { visits: visitsAt(long.slice(0, 1)) }, day(-105)),
    ).toMatchObject({ current: 0, best: 1, freezesBanked: 0 });
    // The new run starts with none.
    expect(
      stateOf(gift, { visits: visitsAt(long) }, soonAfter(long)),
    ).toMatchObject({ current: 1, best: 1, freezesBanked: 0 });
  });

  it('banks what is given on the day of a visit after the visit', () => {
    // The grant of day −200 is the sixth visit's: it cannot cover the gap before it.
    const unbanked = [-400, -370, -340, -310, -200];
    expect(
      stateOf(
        DEFAULT,
        { visits: visitsAt(unbanked), grants: [{ day: day(-200), count: 1 }] },
        soonAfter(unbanked),
      ),
    ).toMatchObject({ current: 1, freezesBanked: 1 });
  });
});

describe('projectStreak, excuses (P9)', () => {
  const visits = visitsAt([-200, -120]);

  it.each(STREAK_SHOP_EXCUSES.map((reason) => [reason]))(
    'a visit called off for %s restarts the clock where the rule excuses it',
    (reason) => {
      const excused = [{ day: day(-165), reason }];
      expect(stateOf(DEFAULT, { visits, excused }, day(-115)).current).toBe(2);
      const others = rule({
        excuses: STREAK_EXCUSES.filter((excuse) => excuse !== reason),
      });
      expect(stateOf(others, { visits, excused }, day(-115)).current).toBe(1);
    },
  );

  it('carries the period on the excuse until its moved due date', () => {
    // Due on day −18; the shop called the visit of day −30 off.
    const state = stateOf(DEFAULT, {
      visits: visitsAt([-60]),
      excused: [{ day: day(-30), reason: 'SHOP_CLOSURE' }],
    });
    expect(state).toMatchObject({
      current: 1,
      dueBy: day(12),
      streakPhase: 'FROZEN',
      phaseFrozenUntil: day(12),
      phaseFreezeReason: 'EXCUSE',
    });
    expect(marks(state.periods)).toEqual([
      `KEPT ${day(-60)}`,
      `PROTECTED ${day(-18)} SHOP_CLOSURE`,
    ]);
  });

  it('is an open period like any other while its own deadline has not passed', () => {
    const state = stateOf(
      DEFAULT,
      {
        visits: visitsAt([-60]),
        excused: [{ day: day(-30), reason: 'SHOP_CLOSURE' }],
      },
      day(-11),
    );
    expect(phaseOf(state)).toEqual({ streakPhase: 'ACTIVE' });
    expect(marks(state.periods)).toEqual([`KEPT ${day(-60)}`]);
  });

  it('covers a period once, however often the shop called it off', () => {
    const state = stateOf(DEFAULT, {
      visits: visitsAt([-100]),
      excused: [
        { day: day(-70), reason: 'BARBER_ABSENCE' },
        { day: day(-35), reason: 'STAFF_CANCELLED' },
      ],
    });
    expect(state).toMatchObject({ current: 1, dueBy: day(7) });
    expect(marks(state.periods)).toEqual([
      `KEPT ${day(-100)}`,
      `PROTECTED ${day(-58)} BARBER_ABSENCE`,
    ]);
  });

  it('covers the next due date too, after a protection covered the last', () => {
    // Five in rhythm bank one. It covers day −238; the shop calls off the
    // visit of day −200, inside the period the protection opened.
    const state = stateOf(
      DEFAULT,
      {
        visits: visitsAt([-400, -370, -340, -310, -280]),
        excused: [{ day: day(-200), reason: 'SHOP_CLOSURE' }],
      },
      day(-180),
    );
    expect(state).toMatchObject({
      current: 5,
      freezesBanked: 0,
      dueBy: day(-158),
      streakPhase: 'FROZEN',
      phaseFrozenUntil: day(-158),
      phaseFreezeReason: 'EXCUSE',
    });
    expect(marks(state.periods).slice(-2)).toEqual([
      `PROTECTED ${day(-238)} FREEZE`,
      `PROTECTED ${day(-196)} SHOP_CLOSURE`,
    ]);
  });

  it('restores nothing: an excuse after the miss is late', () => {
    expect(
      phaseOf(
        stateOf(rule({ ...NO_EARN_BACK }), {
          visits: visitsAt([-100]),
          excused: [{ day: day(-40), reason: 'SHOP_CLOSURE' }],
        }),
      ),
    ).toMatchObject({ streakPhase: 'BROKEN', phaseBrokenOn: day(-50) });
  });

  describe('CLOSED_DAYS', () => {
    const closing = rule({ excuses: STREAK_EXCUSES });
    // Due on day −7, and the shop was closed from that day for three.
    const closed = [-7, -6, -5].map((offset) => ({
      day: day(offset),
      reason: 'CLOSED_DAYS' as StreakExcuse,
    }));

    it('moves the due date to the first open day and counts grace in open days', () => {
      const state = stateOf(
        closing,
        { visits: visitsAt([-49]), excused: closed },
        day(2),
      );
      expect(state).toMatchObject({
        current: 1,
        dueBy: day(-4),
        streakPhase: 'IN_GRACE',
        phaseGraceUntil: day(3),
      });
      // The nominal deadline was day 0: the wait is in use, and drawn.
      expect(marks(state.periods)).toEqual([
        `KEPT ${day(-49)}`,
        `PROTECTED ${day(-7)} CLOSED_DAYS`,
      ]);
      expect(
        phaseOf(
          stateOf(
            closing,
            { visits: visitsAt([-49]), excused: closed },
            day(4),
          ),
        ),
      ).toMatchObject({ streakPhase: 'BROKEN', phaseBrokenOn: day(4) });
    });

    it('is not drawn while the period is inside its nominal deadline', () => {
      expect(
        marks(
          stateOf(closing, { visits: visitsAt([-49]), excused: closed }, day(0))
            .periods,
        ),
      ).toEqual([`KEPT ${day(-49)}`]);
    });

    it('does nothing where the rule does not excuse closed days, and never restarts the clock', () => {
      expect(
        phaseOf(
          stateOf(
            DEFAULT,
            { visits: visitsAt([-49]), excused: closed },
            day(2),
          ),
        ),
      ).toMatchObject({ streakPhase: 'BROKEN', phaseBrokenOn: day(1) });
      // A closed day inside the period is just a day.
      expect(
        stateOf(closing, {
          visits: visitsAt([-30]),
          excused: [{ day: day(-10), reason: 'CLOSED_DAYS' }],
        }).dueBy,
      ).toBe(day(12));
    });
  });
});

describe('projectStreak, pauses (P10)', () => {
  const pausing = rule({
    clientPauseEnabled: true,
    clientPauseMaxDaysPerYear: 90,
  });
  // Due on day −18; away for twenty days from day −30.
  const visits = visitsAt([-60]);
  const away = (reason: 'PAUSE' | 'CLIENT_PAUSE', from = -30, until = -11) => ({
    from: day(from),
    until: day(until),
    reason,
  });

  it('freezes the run while the pause lasts and moves the due date by its length', () => {
    const during = stateOf(
      pausing,
      { visits, pauses: [away('CLIENT_PAUSE')] },
      day(-20),
    );
    expect(during).toMatchObject({
      current: 1,
      // The whole pause counted in: the promise does not creep day by day.
      dueBy: day(2),
      streakPhase: 'FROZEN',
      phaseFrozenUntil: day(-11),
      phaseFreezeReason: 'CLIENT_PAUSE',
    });
    const after = stateOf(pausing, { visits, pauses: [away('CLIENT_PAUSE')] });
    expect(after).toMatchObject({
      current: 1,
      dueBy: day(2),
      streakPhase: 'AT_RISK',
      phaseDueBy: day(2),
    });
    expect(marks(after.periods)).toEqual([
      `KEPT ${day(-60)}`,
      `PROTECTED ${day(-18)} CLIENT_PAUSE`,
    ]);
  });

  it('ticks through a client’s pause where the rule allows none', () => {
    expect(
      phaseOf(stateOf(DEFAULT, { visits, pauses: [away('CLIENT_PAUSE')] })),
    ).toMatchObject({ streakPhase: 'BROKEN', phaseBrokenOn: day(-10) });
  });

  it('always stops for the account’s pause: a pause freezes, it never zeroes', () => {
    const state = stateOf(DEFAULT, { visits, pauses: [away('PAUSE')] });
    expect(state).toMatchObject({ current: 1, dueBy: day(2) });
    expect(marks(state.periods).at(-1)).toBe(`PROTECTED ${day(-18)} PAUSE`);
    expect(
      phaseOf(stateOf(DEFAULT, { visits, pauses: [away('PAUSE')] }, day(-11))),
    ).toEqual({
      streakPhase: 'FROZEN',
      phaseFrozenUntil: day(-11),
      phaseFreezeReason: 'PAUSE',
    });
  });

  it('stops for as many days a year as the allowance has left', () => {
    const ten = rule({
      clientPauseEnabled: true,
      clientPauseMaxDaysPerYear: 10,
    });
    // Ten of the twenty days: due on day −8, the grace out on day −1.
    expect(
      stateOf(ten, { visits, pauses: [away('CLIENT_PAUSE')] }, day(-1)),
    ).toMatchObject({ dueBy: day(-8), streakPhase: 'IN_GRACE' });
    expect(
      phaseOf(stateOf(ten, { visits, pauses: [away('CLIENT_PAUSE')] })),
    ).toMatchObject({ streakPhase: 'BROKEN', phaseBrokenOn: day(0) });
    // Six days in spring and six in autumn: four of the second are left.
    const twice = [
      away('CLIENT_PAUSE', -200, -195),
      away('CLIENT_PAUSE', -30, -25),
    ];
    const regular = visitsAt([-210, -180, -150, -120, -90, -60]);
    expect(
      stateOf(ten, { visits: regular, pauses: twice }, day(-10)),
    ).toMatchObject({
      current: 6,
      dueBy: day(-18 + 4),
      streakPhase: 'IN_GRACE',
      phaseGraceUntil: day(-18 + 4 + 7),
    });
    // A year on, the allowance is whole again.
    const nextYear = [
      away('CLIENT_PAUSE', -420, -411),
      away('CLIENT_PAUSE', -30, -25),
    ];
    expect(
      stateOf(ten, { visits: regular, pauses: nextYear }, day(-10)).dueBy,
    ).toBe(day(-18 + 6));
  });

  it('starts too late once the period was missed', () => {
    expect(
      stateOf(pausing, { visits, pauses: [away('CLIENT_PAUSE', -10, 10)] })
        .streakPhase,
    ).toBe('BROKEN');
  });

  it('skips a pause that ends before it starts', () => {
    expect(
      stateOf(pausing, { visits, pauses: [away('CLIENT_PAUSE', -11, -30)] })
        .streakPhase,
    ).toBe('BROKEN');
  });
});

describe('projectStreak, after a miss (P11, P12)', () => {
  const gone = visitsAt([-300, -270, -240]);

  it('P11 off: nothing is restored, and no day reads as one that would', () => {
    const none = rule({ ...NO_EARN_BACK });
    expect(phaseOf(stateOf(none, { visits: gone }))).toEqual({
      streakPhase: 'BROKEN',
      phaseBrokenOn: day(-190),
      phaseRepairableUntil: day(-191),
    });
    expect(
      stateOf(none, { visits: visitsAt([-300, -270, -240, -185]) }, day(-180))
        .current,
    ).toBe(1);
  });

  it('P11: the window is the rule’s', () => {
    const month = rule({
      repairEnabled: true,
      repairWindowDays: 30,
      repairPerYear: 1,
    });
    expect(phaseOf(stateOf(month, { visits: gone }))).toMatchObject({
      phaseRepairableUntil: day(-160),
    });
    const back = (offset: number) =>
      stateOf(month, { visits: [...gone, ...visitsAt([offset])] }, day(-150))
        .current;
    expect(back(-160)).toBe(4);
    expect(back(-159)).toBe(1);
  });

  it('P11: as many earn-backs a year as the rule gives', () => {
    const later = [-300, -270, -240, -185, -130, -100];
    const twice = rule({
      repairEnabled: true,
      repairWindowDays: 14,
      repairPerYear: 2,
    });
    const trace = traceStreak(
      twice,
      facts({ visits: visitsAt(later) }),
      soonAfter(later),
    );
    expect(trace.state).toMatchObject({ current: 6, best: 6 });
    expect(trace.comebacks).toEqual([]);
  });

  it('P11: promises no earn-back the year has none left for', () => {
    // Restored on day −185, missed again on day −135.
    expect(
      phaseOf(
        stateOf(
          DEFAULT,
          { visits: visitsAt([-300, -270, -240, -185]) },
          day(-132),
        ),
      ),
    ).toEqual({
      streakPhase: 'BROKEN',
      phaseBrokenOn: day(-135),
      phaseRepairableUntil: day(-136),
    });
  });

  it('P12 hold: the miss is drawn and the count stays', () => {
    const holding = rule({ onBreak: 'HOLD' });
    const missed = traceStreak(holding, facts({ visits: gone }), TODAY);
    expect(missed.state).toMatchObject({
      current: 3,
      best: 3,
      dueBy: null,
      periodIntervalDays: null,
      periodGraceDays: null,
      periodSource: null,
      periodHabitDays: null,
      // Nothing was lost, so nothing is there to restore.
      streakPhase: 'BROKEN',
      phaseBrokenOn: day(-190),
      phaseRepairableUntil: day(-191),
    });
    expect(marks(missed.state?.periods ?? []).at(-1)).toBe(
      `MISSED ${day(-198)}`,
    );
    expect(missed.runStartedOn).toBe(day(-300));

    const back = traceStreak(
      holding,
      facts({ visits: [...gone, ...visitsAt([-30, -5])] }),
      TODAY,
    );
    expect(back.state).toMatchObject({
      current: 5,
      best: 5,
      streakPhase: 'ACTIVE',
    });
    expect(marks(back.state?.periods ?? []).slice(-3)).toEqual([
      `MISSED ${day(-198)}`,
      `KEPT ${day(-30)}`,
      `KEPT ${day(-5)}`,
    ]);
    // The run never started over: nobody came BACK.
    expect(back.comebacks).toEqual([]);
    expect(back.counts.map(({ current }) => current)).toEqual([1, 2, 3, 4, 5]);
  });

  it('P12 hold: a protection still covers the period first', () => {
    const state = stateOf(rule({ onBreak: 'HOLD' }), {
      visits: visitsAt([-400, -370, -340, -310, -280, -200]),
    });
    expect(marks(state.periods).slice(-3)).toEqual([
      `PROTECTED ${day(-238)} FREEZE`,
      `KEPT ${day(-200)}`,
      `MISSED ${day(-158)}`,
    ]);
    expect(state.current).toBe(6);
  });
});

describe('projectStreak, what a state carries', () => {
  it('keeps the newest twelve closed periods, oldest first', () => {
    const state = stateOf(DEFAULT, georgi);
    expect(state.periods).toHaveLength(STREAK_PERIODS_KEPT);
    expect(state.periods[0]?.on).toBe('2025-12-08');
    expect(state.periods.at(-1)?.on).toBe('2026-09-28');
  });

  it('pins the version it was judged by', () => {
    const third = rule({
      version: 3,
      effectiveFromLocalDate: localDate('2026-09-01'),
    });
    expect(stateOf(third, georgi)).toMatchObject({
      streakId: 'cadence',
      definitionVersion: 3,
    });
  });

  it('never lets the best run decrease', () => {
    const offsets = [-300, -270, -240, -150, -120];
    for (let today = -300; today <= 0; today += 7) {
      const state = projectStreak(
        DEFAULT,
        facts({ visits: visitsAt(offsets) }),
        day(today),
      );
      expect(state?.best).toBe(today < -270 ? 1 : today < -240 ? 2 : 3);
      expect(state?.current).toBeLessThanOrEqual(state?.best ?? 0);
    }
  });
});

// «Ритъм сега · от март 2025 г.» (lead ruling G1-7): the track keeps
// twelve periods and a run can be longer, so the state says the day itself.
describe('projectStreak, the day the run began', () => {
  it('is the first visit the count counts, however long ago', () => {
    const state = stateOf(DEFAULT, georgi);
    expect(state.current).toBe(24);
    expect(state.runStartedOn).toBe('2025-03-01');
    // Nothing the track holds reaches back that far.
    expect(state.periods[0]?.on).toBe('2025-12-08');
    // Мартин: the visit the shop called off never started him over.
    expect(stateOf(DEFAULT, martin).runStartedOn).toBe('2025-05-06');
  });

  it('is the day of the first visit that COUNTED, from the first one on', () => {
    const state = stateOf(DEFAULT, {
      visits: [{ day: day(-60), counted: false }, ...visitsAt([-30])],
    });
    expect(state).toMatchObject({ current: 1, runStartedOn: day(-30) });
  });

  it('stays where it is when the same haircut is fixed up', () => {
    expect(
      stateOf(DEFAULT, { visits: visitsAt([-40, -37]) }).runStartedOn,
    ).toBe(day(-40));
  });

  it('is nobody’s day while the count is lost, and the day of the visit that starts over', () => {
    const visits = visitsAt([-300, -270, -240, -150, -120]);
    // Missed on day −190: nothing runs until he is back.
    expect(stateOf(DEFAULT, { visits }, day(-170))).toMatchObject({
      current: 0,
      streakPhase: 'BROKEN',
      runStartedOn: null,
    });
    expect(stateOf(DEFAULT, { visits }, day(-150))).toMatchObject({
      current: 1,
      runStartedOn: day(-150),
    });
    expect(stateOf(DEFAULT, { visits }, day(-115))).toMatchObject({
      current: 2,
      runStartedOn: day(-150),
    });
    // And lost again since.
    expect(stateOf(DEFAULT, { visits }).runStartedOn).toBeNull();
  });

  it('P11: a run the earn-back restored began when it first did', () => {
    const offsets = [-300, -270, -240, -185];
    const visits = visitsAt(offsets);
    expect(stateOf(DEFAULT, { visits }, day(-188)).runStartedOn).toBeNull();
    expect(stateOf(DEFAULT, { visits }, soonAfter(offsets))).toMatchObject({
      current: 4,
      runStartedOn: day(-300),
    });
    // Too late for the earn-back: a new run, from the visit that came.
    expect(
      stateOf(
        DEFAULT,
        { visits: visitsAt([-300, -270, -240, -170]) },
        day(-165),
      ),
    ).toMatchObject({ current: 1, runStartedOn: day(-170) });
  });

  it('P12 hold: the count was never lost, so neither was its first day', () => {
    const holding = rule({ onBreak: 'HOLD' });
    const gone = visitsAt([-300, -270, -240]);
    expect(stateOf(holding, { visits: gone })).toMatchObject({
      current: 3,
      streakPhase: 'BROKEN',
      runStartedOn: day(-300),
    });
    expect(
      stateOf(holding, { visits: [...gone, ...visitsAt([-30, -5])] }),
    ).toMatchObject({ current: 5, runStartedOn: day(-300) });
  });

  it('runs on through what covered a period: a protection, the shop’s excuse, a pause', () => {
    const banked = [-400, -370, -340, -310, -280, -200];
    expect(
      stateOf(DEFAULT, { visits: visitsAt(banked) }, soonAfter(banked)),
    ).toMatchObject({ current: 6, runStartedOn: day(-400) });
    expect(
      stateOf(
        DEFAULT,
        {
          visits: visitsAt([-200, -120]),
          excused: [{ day: day(-165), reason: 'BARBER_ABSENCE' }],
        },
        day(-115),
      ),
    ).toMatchObject({ current: 2, runStartedOn: day(-200) });
    expect(
      stateOf(
        DEFAULT,
        {
          visits: visitsAt([-200, -120]),
          pauses: [{ from: day(-180), until: day(-140), reason: 'PAUSE' }],
        },
        day(-115),
      ),
    ).toMatchObject({ current: 2, runStartedOn: day(-200) });
  });

  it('is the day the trace gives', () => {
    const offsets = [-300, -270, -240, -150, -120, -90, -60, -30];
    for (let today = -300; today <= 0; today += 5) {
      const trace = traceStreak(
        DEFAULT,
        facts({ visits: visitsAt(offsets) }),
        day(today),
      );
      expect(trace.state?.runStartedOn).toBe(trace.runStartedOn);
    }
  });
});

describe('traceStreak', () => {
  it('gives the count each day it moved', () => {
    const offsets = [-300, -270, -240, -150, -120];
    expect(
      traceStreak(DEFAULT, facts({ visits: visitsAt(offsets) }), TODAY).counts,
    ).toEqual([
      { on: day(-300), current: 1 },
      { on: day(-270), current: 2 },
      { on: day(-240), current: 3 },
      { on: day(-190), current: 0 },
      { on: day(-150), current: 1 },
      { on: day(-120), current: 2 },
      { on: day(-70), current: 0 },
    ]);
  });

  it('gives the days the nightly judgement moved the phase', () => {
    // At risk a week before day −18, in grace after it, broken after that.
    expect(
      traceStreak(DEFAULT, facts({ visits: visitsAt([-60]) }), TODAY).judgedOn,
    ).toEqual([day(-25), day(-17), day(-10)]);
  });
});

// ── What a looser rule does ───────────────────────────────────────────────

/**
 * The spec asks for one property: loosening any single parameter never
 * lowers `current`. It holds on the PLAIN CLOCK, and is tested there. It
 * is false for the rule as a whole, and the reason is the rule, not the
 * fold: a protection is earned by the count of the run and the earn-back
 * is rationed by the year, so once two rules part, the stricter one
 * restarts its count, earns and spends on other days, and can be the
 * luckier of the two at a later gap. What holds for every rule is the
 * direction of the FIRST difference, and that is tested too, with two
 * exceptions that are the reserve's cap at work and are pinned at the
 * end: a protection earned more often, and a protection GIVEN on a day
 * between two visits (the generator gives them with a counted visit,
 * which is when an achievement pays one).
 */

const START = '2024-01-08';

interface Loosening {
  readonly name: string;
  /** The looser rule, or `null` where this rule has no room to loosen. */
  readonly of: (props: StreakRule, by: number) => StreakRule | null;
  /**
   * It moves the HABIT under a personal interval, so there it bounds
   * nothing: a fix-up that counts is a short gap, a short gap is a
   * shorter habit, and a shorter habit is an earlier due date.
   */
  readonly movesHabit?: true;
}

/** A whole number from `min` to `max`, picked by `by` (0 ≤ by < 1). */
const between = (min: number, max: number, by: number): number =>
  min + Math.floor(by * (max - min + 1));

const shortestOf = (p: StreakRule): number =>
  p.streakInterval === 'FIXED' ? p.intervalDays : p.intervalMinDays;

/** The clock: what decides whether a period was kept. */
const CLOCK: readonly Loosening[] = [
  {
    name: 'a longer fixed interval',
    of: (p, by) =>
      p.streakInterval === 'FIXED' && p.intervalDays < 182
        ? { ...p, intervalDays: between(p.intervalDays + 1, 182, by) }
        : null,
  },
  {
    name: 'a wider tolerance',
    of: (p, by) =>
      p.streakInterval === 'PERSONAL' && p.intervalTolerancePct < 100
        ? {
            ...p,
            intervalTolerancePct: between(p.intervalTolerancePct + 1, 100, by),
          }
        : null,
  },
  {
    name: 'a higher floor',
    of: (p, by) =>
      p.streakInterval === 'PERSONAL' &&
      p.intervalMinDays < p.intervalFallbackDays
        ? {
            ...p,
            intervalMinDays: between(
              p.intervalMinDays + 1,
              p.intervalFallbackDays,
              by,
            ),
          }
        : null,
  },
  {
    name: 'a higher ceiling',
    of: (p, by) =>
      p.streakInterval === 'PERSONAL' && p.intervalMaxDays < 182
        ? { ...p, intervalMaxDays: between(p.intervalMaxDays + 1, 182, by) }
        : null,
  },
  {
    name: 'a longer default for newcomers',
    of: (p, by) =>
      p.streakInterval === 'PERSONAL' &&
      p.intervalFallbackDays < p.intervalMaxDays
        ? {
            ...p,
            intervalFallbackDays: between(
              p.intervalFallbackDays + 1,
              p.intervalMaxDays,
              by,
            ),
          }
        : null,
  },
  {
    name: 'more grace',
    of: (p, by) => {
      const max = Math.min(21, shortestOf(p) - 1);
      return p.graceDays < max
        ? { ...p, graceDays: between(p.graceDays + 1, max, by) }
        : null;
    },
  },
  {
    name: 'a shorter minimum gap',
    movesHabit: true,
    of: (p, by) =>
      p.minGapDays > 0
        ? { ...p, minGapDays: between(0, p.minGapDays - 1, by) }
        : null,
  },
  {
    name: 'a wider booking hold',
    of: (p, by) => {
      if (!p.bookingHoldEnabled) {
        return { ...p, bookingHoldEnabled: true };
      }
      return p.bookingHoldMaxDaysPastDue < 28
        ? {
            ...p,
            bookingHoldEnabled: true,
            bookingHoldMaxDaysPastDue: between(
              p.bookingHoldMaxDaysPastDue + 1,
              28,
              by,
            ),
          }
        : null;
    },
  },
  {
    name: 'one more excuse',
    of: (p, by) => {
      const off = STREAK_EXCUSES.filter((e) => !p.excuses.includes(e));
      const added = off[between(0, off.length - 1, by)];
      return added === undefined
        ? null
        : { ...p, excuses: [...p.excuses, added] };
    },
  },
  {
    name: 'a longer client pause',
    of: (p, by) => {
      if (!p.clientPauseEnabled) {
        return { ...p, clientPauseEnabled: true };
      }
      return p.clientPauseMaxDaysPerYear < 180
        ? {
            ...p,
            clientPauseEnabled: true,
            clientPauseMaxDaysPerYear: between(
              p.clientPauseMaxDaysPerYear + 1,
              180,
              by,
            ),
          }
        : null;
    },
  },
  {
    name: 'a miss that holds the count',
    of: (p) => (p.onBreak === 'RESTART' ? { ...p, onBreak: 'HOLD' } : null),
  },
];

/** The reserve and the earn-back: what softens a miss. */
const CUSHION: readonly Loosening[] = [
  {
    name: 'protections switched on',
    of: (p) =>
      p.protectionsEnabled ? null : { ...p, protectionsEnabled: true },
  },
  {
    name: 'a larger reserve',
    of: (p, by) =>
      p.protectionsEnabled && p.protectionsMaxBanked < 5
        ? {
            ...p,
            protectionsMaxBanked: between(p.protectionsMaxBanked + 1, 5, by),
          }
        : null,
  },
  {
    name: 'more protections to start with',
    of: (p, by) =>
      p.protectionsEnabled && p.protectionsStartWith < p.protectionsMaxBanked
        ? {
            ...p,
            protectionsStartWith: between(
              p.protectionsStartWith + 1,
              p.protectionsMaxBanked,
              by,
            ),
          }
        : null,
  },
  {
    name: 'the earn-back switched on',
    of: (p) => (p.repairEnabled ? null : { ...p, repairEnabled: true }),
  },
  {
    name: 'a longer earn-back window',
    of: (p, by) =>
      p.repairEnabled && p.repairWindowDays < 60
        ? { ...p, repairWindowDays: between(p.repairWindowDays + 1, 60, by) }
        : null,
  },
  {
    name: 'more earn-backs a year',
    of: (p, by) =>
      p.repairEnabled && p.repairPerYear < 4
        ? { ...p, repairPerYear: between(p.repairPerYear + 1, 4, by) }
        : null,
  },
];

/** Any rule the editor can publish. */
const anyRule: fc.Arbitrary<StreakRule> = fc
  .record({
    personal: fc.boolean(),
    floor: fc.integer({ min: 14, max: 60 }),
    span: fc.integer({ min: 0, max: 60 }),
    fallback: fc.double({ min: 0, max: 0.999, noNaN: true }),
    tolerancePct: fc.integer({ min: 0, max: 100 }),
    days: fc.integer({ min: 14, max: 90 }),
    graceDays: fc.integer({ min: 0, max: 21 }),
    riskLeadDays: fc.integer({ min: 0, max: 21 }),
    minGapDays: fc.integer({ min: 0, max: 14 }),
    bookingHold: fc.record({
      enabled: fc.boolean(),
      maxDaysPastDue: fc.integer({ min: 0, max: 28 }),
    }),
    protections: fc.record({
      enabled: fc.boolean(),
      maxBanked: fc.integer({ min: 0, max: 5 }),
      earnEvery: fc.integer({ min: 1, max: 8 }),
      startWith: fc.integer({ min: 0, max: 5 }),
    }),
    excuses: fc.subarray([...STREAK_EXCUSES]),
    clientPause: fc.record({
      enabled: fc.boolean(),
      maxDaysPerYear: fc.integer({ min: 0, max: 180 }),
    }),
    repair: fc.record({
      enabled: fc.boolean(),
      windowDays: fc.integer({ min: 1, max: 60 }),
      perYear: fc.integer({ min: 1, max: 4 }),
    }),
    onBreak: fc.constantFrom('RESTART' as const, 'HOLD' as const),
  })
  .map((drawn): StreakRule => {
    // The draw is the one it always was (same record, same seeds); only
    // the rule it makes is flat.
    const interval: StreakIntervalRule = drawn.personal
      ? StreakIntervalRule.personal(
          drawn.tolerancePct,
          drawn.floor,
          drawn.floor + drawn.span,
          between(drawn.floor, drawn.floor + drawn.span, drawn.fallback),
        )
      : StreakIntervalRule.fixed(drawn.days);
    const under =
      (interval.streakInterval === 'FIXED' ? drawn.days : drawn.floor) - 1;
    return StreakRule.of({
      ...StreakRule.DEFAULT,
      ...interval,
      graceDays: Math.min(drawn.graceDays, under),
      riskLeadDays: Math.min(drawn.riskLeadDays, under),
      minGapDays: Math.min(drawn.minGapDays, under),
      bookingHoldEnabled: drawn.bookingHold.enabled,
      bookingHoldMaxDaysPastDue: drawn.bookingHold.maxDaysPastDue,
      protectionsEnabled: drawn.protections.enabled,
      protectionsMaxBanked: drawn.protections.maxBanked,
      protectionsEarnEvery: drawn.protections.earnEvery,
      protectionsStartWith: Math.min(
        drawn.protections.startWith,
        drawn.protections.maxBanked,
      ),
      excuses: drawn.excuses,
      clientPauseEnabled: drawn.clientPause.enabled,
      clientPauseMaxDaysPerYear: drawn.clientPause.maxDaysPerYear,
      repairEnabled: drawn.repair.enabled,
      repairWindowDays: drawn.repair.windowDays,
      repairPerYear: drawn.repair.perYear,
      onBreak: drawn.onBreak,
    } as StreakRule);
  });

/** The clock alone: no reserve and no earn-back, so a miss is a miss. */
const plainClock = anyRule.map((props): StreakRule => ({
  ...props,
  protectionsEnabled: false,
  repairEnabled: false,
}));

/** A few years of somebody's visits, with everything the book can hold around them. */
const anyFacts: fc.Arbitrary<{
  readonly facts: StreakFacts;
  readonly today: string;
}> = fc
  .record({
    visits: fc.array(
      fc.record({
        // A fix-up, a regular's gap, a late one, a long absence.
        gap: fc.oneof(
          { weight: 1, arbitrary: fc.integer({ min: 0, max: 9 }) },
          { weight: 6, arbitrary: fc.integer({ min: 18, max: 50 }) },
          { weight: 2, arbitrary: fc.integer({ min: 50, max: 70 }) },
          { weight: 1, arbitrary: fc.integer({ min: 70, max: 160 }) },
        ),
        counted: fc.oneof(
          { weight: 19, arbitrary: fc.constant(true) },
          { weight: 1, arbitrary: fc.constant(false) },
        ),
        booked: fc.option(fc.integer({ min: 0, max: 30 }), { nil: null }),
        calledOff: fc.option(
          fc.record({
            at: fc.double({ min: 0, max: 0.999, noNaN: true }),
            reason: fc.constantFrom(...STREAK_SHOP_EXCUSES),
          }),
          { nil: null, freq: 6 },
        ),
        closed: fc.option(
          fc.record({
            at: fc.double({ min: 0, max: 0.999, noNaN: true }),
            days: fc.integer({ min: 1, max: 6 }),
          }),
          { nil: null, freq: 6 },
        ),
        paused: fc.option(
          fc.record({
            at: fc.double({ min: 0, max: 0.999, noNaN: true }),
            days: fc.integer({ min: 1, max: 30 }),
            reason: fc.constantFrom('PAUSE' as const, 'CLIENT_PAUSE' as const),
          }),
          { nil: null, freq: 10 },
        ),
        granted: fc.option(fc.integer({ min: 1, max: 2 }), {
          nil: null,
          freq: 20,
        }),
      }),
      { minLength: 1, maxLength: 30 },
    ),
    since: fc.integer({ min: 0, max: 80 }),
    next: fc.option(
      fc.record({
        placed: fc.integer({ min: 0, max: 20 }),
        ahead: fc.integer({ min: 0, max: 30 }),
      }),
      { nil: null },
    ),
  })
  .map(({ visits, since, next }) => {
    const on = (offset: number): string => addDays(START, offset);
    const excused: StreakFacts['excused'][number][] = [];
    const bookings: StreakFacts['bookings'][number][] = [];
    const pauses: StreakFacts['pauses'][number][] = [];
    const grants: StreakFacts['grants'][number][] = [];
    const counted: StreakFacts['visits'][number][] = [];
    let at = 0;
    visits.forEach((visit, index) => {
      const from = at;
      const gap = index === 0 ? 0 : visit.gap;
      at += gap;
      const inside = (by: number): number => from + between(1, gap - 1, by);
      if (gap > 2 && visit.calledOff !== null) {
        excused.push({
          day: on(inside(visit.calledOff.at)),
          reason: visit.calledOff.reason,
        });
      }
      if (gap > 2 && visit.closed !== null) {
        const first = inside(visit.closed.at);
        for (let k = 0; k < visit.closed.days; k += 1) {
          excused.push({ day: on(first + k), reason: 'CLOSED_DAYS' });
        }
      }
      if (gap > 2 && visit.paused !== null) {
        const first = inside(visit.paused.at);
        pauses.push({
          from: on(first),
          until: on(first + visit.paused.days - 1),
          reason: visit.paused.reason,
        });
      }
      if (visit.booked !== null) {
        bookings.push({
          placedOn: on(at - Math.min(visit.booked, gap)),
          day: on(at),
          appointmentId: `appt-${index}`,
        });
      }
      if (visit.granted !== null && visit.counted) {
        grants.push({ day: on(at), count: visit.granted });
      }
      counted.push({ day: on(at), counted: visit.counted });
    });
    const today = on(at + since);
    if (next !== null) {
      bookings.push({
        placedOn: addDays(today, -next.placed),
        day: addDays(today, next.ahead),
        appointmentId: 'appt-next',
      });
    }
    return {
      facts: { visits: counted, excused, bookings, pauses, grants },
      today,
    };
  });

const by = fc.double({ min: 0, max: 0.999, noNaN: true });

function made(props: StreakRule): StreakRule {
  const result = StreakRule.parse(props);
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.value;
}

/** The count at the end of each day it moved. */
function countsOf(trace: StreakTrace): Map<string, number> {
  return new Map(trace.counts.map(({ on, current }) => [on, current]));
}

/** The two counts on the first day they differ, or `null` if they never do. */
function firstParting(
  stricter: StreakTrace,
  looser: StreakTrace,
): { readonly stricter: number; readonly looser: number } | null {
  const before = countsOf(stricter);
  const after = countsOf(looser);
  let counts = { stricter: 0, looser: 0 };
  for (const on of [...new Set([...before.keys(), ...after.keys()])].sort()) {
    counts = {
      stricter: before.get(on) ?? counts.stricter,
      looser: after.get(on) ?? counts.looser,
    };
    if (counts.stricter !== counts.looser) return counts;
  }
  return null;
}

/** Fixed seeds: a property that fails must fail the same way for everyone. */
const RUNS = { seed: 20260929, numRuns: 300 } as const;

describe('projectStreak, a looser rule', () => {
  describe.each(CLOCK.map((loosening) => [loosening.name, loosening] as const))(
    'on the plain clock, %s',
    (_name, loosening) => {
      it('never lowers the count, nor the best run', () => {
        fc.assert(
          fc.property(
            plainClock,
            anyFacts,
            by,
            (props, { facts, today }, b) => {
              const looser = loosening.of(props, b);
              fc.pre(looser !== null);
              fc.pre(
                loosening.movesHabit !== true ||
                  props.streakInterval === 'FIXED',
              );
              const before = projectStreak(made(props), facts, today);
              const after = projectStreak(made(looser ?? props), facts, today);
              expect(after?.current ?? 0).toBeGreaterThanOrEqual(
                before?.current ?? 0,
              );
              expect(after?.best ?? 0).toBeGreaterThanOrEqual(
                before?.best ?? 0,
              );
            },
          ),
          RUNS,
        );
      });
    },
  );

  it('under any rule, the phase kind alone is the projected state’s phase kind', () => {
    // `StreakSystem.phaseKind` is the preview's hot path: the same fold,
    // no state assembled — it must never answer differently.
    fc.assert(
      fc.property(anyRule, anyFacts, (props, { facts, today }) => {
        const rule = made(props);
        expect(
          StreakSystem.phaseKind(rule, strict(facts), shopDay(today)),
        ).toBe(projectStreak(rule, facts, today)?.streakPhase ?? null);
      }),
      RUNS,
    );
  });

  it('under any rule, a miss that holds the count never lowers it', () => {
    fc.assert(
      fc.property(anyRule, anyFacts, (props, { facts, today }) => {
        fc.pre(props.onBreak === 'RESTART');
        const before = projectStreak(made(props), facts, today);
        const after = projectStreak(
          made({ ...props, onBreak: 'HOLD' }),
          facts,
          today,
        );
        expect(after?.current ?? 0).toBeGreaterThanOrEqual(
          before?.current ?? 0,
        );
        expect(after?.best ?? 0).toBeGreaterThanOrEqual(before?.best ?? 0);
      }),
      RUNS,
    );
  });

  describe.each(
    [...CLOCK, ...CUSHION].map(
      (loosening) => [loosening.name, loosening] as const,
    ),
  )('under any rule, %s', (_name, loosening) => {
    it('is the higher count where the two first part', () => {
      fc.assert(
        fc.property(anyRule, anyFacts, by, (props, { facts, today }, b) => {
          const looser = loosening.of(props, b);
          fc.pre(looser !== null);
          const parted = firstParting(
            traceStreak(made(props), facts, today),
            traceStreak(made(looser ?? props), facts, today),
          );
          if (parted === null) return;
          expect(parted.looser).toBeGreaterThan(parted.stricter);
        }),
        RUNS,
      );
    });
  });

  it('under any rule, keeps the state inside its bounds', () => {
    fc.assert(
      fc.property(anyRule, anyFacts, (props, { facts, today }) => {
        const definition = made(props);
        const trace = traceStreak(definition, facts, today);
        const { state } = trace;
        if (state === null) {
          expect(facts.visits.some((visit) => visit.counted)).toBe(false);
          return;
        }
        expect(state.current).toBeGreaterThanOrEqual(0);
        expect(state.current).toBeLessThanOrEqual(state.best);
        expect(trace.record?.value).toBe(state.best);
        expect(state.freezesBanked).toBeGreaterThanOrEqual(0);
        expect(state.freezesBanked).toBeLessThanOrEqual(
          definition.protectionsEnabled ? definition.protectionsMaxBanked : 0,
        );
        expect(state.periods.length).toBeLessThanOrEqual(STREAK_PERIODS_KEPT);
        expect(state.periods.map(({ on }) => on)).toEqual(
          state.periods.map(({ on }) => on).sort(),
        );
        // No open period, no promise; an open one is promised a day.
        expect(state.dueBy === null).toBe(state.streakPhase === 'BROKEN');
        expect(periodOf(state) === null).toBe(state.streakPhase === 'BROKEN');
        // The visit that holds the period: both its fields, or neither.
        expect(state.heldOn === null).toBe(state.heldByAppointmentId === null);
        if (state.heldByAppointmentId !== null && state.heldOn !== null) {
          expect(state.heldOn >= today).toBe(true);
          expect(state.heldByAppointmentId).not.toBe('');
        }
        // A run in progress began on a day, and only a run in progress.
        expect(state.runStartedOn === null).toBe(state.current === 0);
        expect(state.runStartedOn).toBe(trace.runStartedOn);
      }),
      RUNS,
    );
  });

  it('under any rule, dates the run by the visit that made the count one', () => {
    fc.assert(
      fc.property(anyRule, anyFacts, (props, { facts, today }) => {
        const trace = traceStreak(made(props), facts, today);
        const { state } = trace;
        if (state === null || state.current === 0) return;
        const counted = facts.visits
          .filter((visit) => visit.counted)
          .map((visit) => visit.day);
        expect(counted).toContain(state.runStartedOn);
        expect(state.runStartedOn).toBe(
          trace.counts.filter(({ current }) => current === 1).at(-1)?.on,
        );
        expect(
          (state.runStartedOn ?? '') <=
            sofiaDayOf(state.lastQualifiedAtUtcMs ?? 0),
        ).toBe(true);
        // A miss that holds the count never starts anybody over.
        if (props.onBreak === 'HOLD') {
          expect(state.runStartedOn).toBe([...counted].sort()[0]);
        }
      }),
      RUNS,
    );
  });

  /**
   * PINNED, so nobody promises it and nobody "fixes" the fold blind: a
   * looser rule CAN leave a client with a lower count. `changeFrom` calls
   * these changes `looser`, and they are: the first thing each does for
   * anybody is never a loss (above). What they cannot be is a promise
   * about every count on every later day.
   */
  describe('can still leave a count lower', () => {
    it('more grace: the earn-back is rationed by the year', () => {
      // No reserve, so the earn-back is all there is.
      const week = rule({ ...NO_PROTECTIONS });
      const fortnight = rule({ ...NO_PROTECTIONS, graceDays: 14 });
      const visits = visitsAt([
        -480,
        -450,
        // 55 days: a miss restored under the week, in time under the fortnight.
        -395,
        // 60 days: a miss under both. The week's earn-back is spent, so
        // its run starts over; the fortnight's is not, so its run goes on.
        -335,
        ...[-305, -275, -245, -215, -185, -155, -125, -95, -65],
        // 60 days again, 390 days after the week's earn-back and 330
        // after the fortnight's: now only the week has one to give.
        -5,
      ]);
      const stricter = traceStreak(week, facts({ visits }), TODAY);
      const looser = traceStreak(fortnight, facts({ visits }), TODAY);
      // They part on the day the week's grace runs out: in the fortnight's
      // favour, as every first difference is.
      expect(firstParting(stricter, looser)).toEqual({
        stricter: 0,
        looser: 2,
      });
      expect(stricter.state?.current).toBe(11);
      expect(looser.state?.current).toBe(1);
      expect(looser.state?.best).toBe(13);
    });

    it('a longer interval: a gift that finds the reserve full is lost', () => {
      const every = (days: number) =>
        rule({
          ...StreakIntervalRule.fixed(days),
          graceDays: 4,
          protectionsEnabled: true,
          protectionsMaxBanked: 1,
          protectionsEarnEvery: 24,
          protectionsStartWith: 1,
          ...NO_EARN_BACK,
        });
      const told = facts({
        visits: visitsAt([-115, -55, -5]),
        // «Дай защита», forty days after the first visit. Every 30 days:
        // the one he started with was spent five days before, so the gift
        // is banked. Every 42: it is still in the reserve, the gift finds
        // no room, and the one he has is spent a week later.
        grants: [{ day: day(-75), count: 1 }],
      });
      const stricter = traceStreak(every(30), told, TODAY);
      const looser = traceStreak(every(42), told, TODAY);
      // The second gap is a miss under both: only one has a protection left.
      expect(stricter.state).toMatchObject({ current: 3, freezesBanked: 0 });
      expect(looser.state).toMatchObject({ current: 1, freezesBanked: 0 });
      expect(firstParting(stricter, looser)).toEqual({
        stricter: 2,
        looser: 0,
      });
    });

    /**
     * Why «a protection earned more often» is in neither list above: it
     * is earned when the count is a multiple, and a reserve that is full
     * lets it go. Every four visits can be the WORSE schedule.
     */
    it('a protection earned more often: a full reserve lets one go', () => {
      const earning = (earnEvery: number) =>
        rule({
          protectionsEnabled: true,
          protectionsMaxBanked: 1,
          protectionsEarnEvery: earnEvery,
          protectionsStartWith: 0,
          ...NO_EARN_BACK,
        });
      const visits = visitsAt([
        // Nine in rhythm. Every five: one banked on the fifth. Every
        // four: one on the fourth, and the eighth's finds the reserve full.
        ...[-405, -375, -345, -315, -285, -255, -225, -195, -165],
        // 80 days: both spend the one they hold. The tenth visit is a
        // multiple of five and not of four.
        -85,
        // 80 days again: only every five has one to spend.
        -5,
      ]);
      const everyFive = traceStreak(earning(5), facts({ visits }), TODAY);
      const everyFour = traceStreak(earning(4), facts({ visits }), TODAY);
      expect(everyFive.state?.current).toBe(11);
      expect(everyFour.state?.current).toBe(1);
      expect(firstParting(everyFive, everyFour)).toEqual({
        stricter: 10,
        looser: 0,
      });
    });
  });
});

// ── The system's own contract ─────────────────────────────────────────────

describe('StreakSystem purity', () => {
  it('is pure: same input → same output, inputs untouched', () => {
    const rule = deepFreeze(DEFAULT);
    const input = deepFreeze(strict(martin));
    const today = localDate(TODAY);
    const once = StreakSystem.trace(STREAK_ID, rule, input, today);
    const twice = StreakSystem.trace(STREAK_ID, rule, input, today);
    expect(twice).toEqual(once);
    expect(input).toEqual(strict(martin));
  });

  it('is pure under any rule and any facts (property)', () => {
    fc.assert(
      fc.property(anyRule, anyFacts, (props, { facts: loose, today }) => {
        const rule = deepFreeze(made(props));
        const input = deepFreeze(strict(loose));
        const once = StreakSystem.trace(STREAK_ID, rule, input, shopDay(today));
        expect(
          StreakSystem.trace(STREAK_ID, rule, input, shopDay(today)),
        ).toEqual(once);
      }),
      { seed: 20261010, numRuns: 100 },
    );
  });

  it('stamps the instant the boundary handed with the visit: it places no day on a clock of its own', () => {
    // A zone the system could not place used to name no instant; it reads
    // no zone now, so the visit's own start is the stamp, whatever it is.
    const atMs = utcMs('2026-09-18T07:30:00.000Z');
    const state = StreakSystem.project(
      STREAK_ID,
      DEFAULT,
      strict(facts({ visits: [{ day: day(-10), counted: true, atMs }] })),
      localDate(TODAY),
    );
    expect(state?.lastQualifiedAtUtcMs).toBe(atMs);
  });

  it('trims the name of a booked visit, and a blank one names none', () => {
    const booked = (appointmentId: string) =>
      stateOf(DEFAULT, {
        visits: visitsAt([-10]),
        bookings: [{ placedOn: day(-10), day: day(25), appointmentId }],
      });
    expect(heldOf(booked('  next  '))).toEqual({
      heldByAppointmentId: 'next',
      heldOn: day(25),
    });
    expect(heldOf(booked('   '))).toEqual({
      heldByAppointmentId: null,
      heldOn: null,
    });
  });
});

// ── The card's rhythm math (wallet.presenter.ts `inChairDueOf`, `rhythmMarks`) ──

/** A state as the card holds it, healthy unless told otherwise. */
function cardState(patch: Partial<StreakState> = {}): StreakState {
  return {
    streakId: STREAK_ID,
    definitionVersion: 1,
    ...StreakPhaseState.active(),
    current: 24,
    best: 24,
    lastQualifiedAtUtcMs: instant(utcMs('2026-09-28T07:00:00.000Z')),
    dueBy: localDate('2026-11-09'),
    freezesBanked: 2,
    periodIntervalDays: 42,
    periodGraceDays: 7,
    periodSource: 'FIXED',
    periodHabitDays: null,
    periods: [],
    heldByAppointmentId: null,
    heldOn: null,
    runStartedOn: localDate('2025-03-01'),
    ...patch,
  } as StreakState;
}

const CARD_TODAY = localDate('2026-09-28');
const view = (
  patch: Partial<{
    inChairToday: boolean;
    paused: boolean;
    limit: number;
  }> = {},
) => ({
  today: CARD_TODAY,
  inChairToday: false,
  paused: false,
  limit: 8,
  ...patch,
});

describe('StreakSystem.inChairDue', () => {
  it('says when the next visit is due once the one in the chair counts: its period after today', () => {
    // Мартин in the chair on 28 September: «следващото до 9 ноември».
    expect(
      StreakSystem.inChairDue(cardState(), CARD_TODAY, {
        inChairToday: true,
        paused: false,
      }),
    ).toBe('2026-11-09');
  });

  it('names no day with nobody in the chair, for a paused client, under a used protection and with no period open', () => {
    const chair = { inChairToday: true, paused: false };
    expect(
      StreakSystem.inChairDue(cardState(), CARD_TODAY, {
        inChairToday: false,
        paused: false,
      }),
    ).toBeNull();
    expect(
      StreakSystem.inChairDue(cardState(), CARD_TODAY, {
        inChairToday: true,
        paused: true,
      }),
    ).toBeNull();
    expect(
      StreakSystem.inChairDue(
        cardState({
          ...StreakPhaseState.frozen(localDate('2026-11-16'), 'FREEZE'),
        }),
        CARD_TODAY,
        chair,
      ),
    ).toBeNull();
    expect(
      StreakSystem.inChairDue(
        cardState({
          periodIntervalDays: null,
          periodGraceDays: null,
          periodSource: null,
          periodHabitDays: null,
        }),
        CARD_TODAY,
        chair,
      ),
    ).toBeNull();
  });
});

describe('StreakSystem.track', () => {
  const closed = (
    streakPeriodMark: StreakPeriodFact['streakPeriodMark'],
    on: string,
    periodReason: StreakPeriodFact['periodReason'] = null,
  ): StreakPeriodFact => ({
    streakPeriodMark,
    on: localDate(on),
    periodReason,
  });

  it('draws what became of each closed period, the visits alone dated as visits, then the open one', () => {
    const track = StreakSystem.track(
      cardState({
        periods: [
          closed('KEPT', '2026-04-22'),
          closed('MISSED', '2026-06-10'),
          closed('REPAIRED', '2026-06-20'),
          closed('PROTECTED', '2026-08-08', 'STAFF_CANCELLED'),
          closed('PROTECTED', '2026-08-20', 'FREEZE'),
          closed('KEPT', '2026-09-28'),
        ],
      }),
      view(),
    );
    expect(track.marks).toEqual([
      {
        streakTrackMarkKind: 'KEPT',
        on: '2026-04-22',
        reason: null,
        open: false,
        visitDay: '2026-04-22',
      },
      {
        streakTrackMarkKind: 'MISSED',
        on: '2026-06-10',
        reason: null,
        open: false,
        visitDay: null,
      },
      {
        streakTrackMarkKind: 'REPAIRED',
        on: '2026-06-20',
        reason: null,
        open: false,
        visitDay: '2026-06-20',
      },
      {
        streakTrackMarkKind: 'PROTECTED',
        on: '2026-08-08',
        reason: 'STAFF_CANCELLED',
        open: false,
        visitDay: null,
      },
      {
        streakTrackMarkKind: 'PROTECTED',
        on: '2026-08-20',
        reason: 'FREEZE',
        open: false,
        visitDay: null,
      },
      {
        streakTrackMarkKind: 'KEPT',
        on: '2026-09-28',
        reason: null,
        open: false,
        visitDay: '2026-09-28',
      },
      {
        streakTrackMarkKind: StreakTrackMarkKind.Current,
        on: '2026-11-09',
        reason: null,
        open: true,
        visitDay: null,
      },
    ]);
    // April, June, September: every drawn visit has a month of its own.
    expect(track.byMonth).toBe(true);
  });

  it('captions by day once two drawn visits share a month', () => {
    const track = StreakSystem.track(
      cardState({
        periods: [closed('KEPT', '2026-09-03'), closed('KEPT', '2026-09-28')],
      }),
      view(),
    );
    expect(track.byMonth).toBe(false);
  });

  it('opens on today for the visit in the chair', () => {
    const track = StreakSystem.track(
      cardState({ periods: [closed('KEPT', '2026-08-21')] }),
      view({ inChairToday: true }),
    );
    expect(track.marks.at(-1)).toEqual({
      streakTrackMarkKind: 'CURRENT',
      on: '2026-09-28',
      reason: null,
      open: true,
      visitDay: null,
    });
  });

  it('draws a covered period open as protected, by what covers it, until its moved due date — never while paused', () => {
    const frozen = (reason: 'FREEZE' | 'PAUSE' | 'CLIENT_PAUSE' | 'EXCUSE') =>
      cardState({
        ...StreakPhaseState.frozen(localDate('2026-11-16'), reason),
        dueBy: localDate('2026-11-16'),
      });
    for (const reason of [
      'FREEZE',
      'PAUSE',
      'CLIENT_PAUSE',
      'EXCUSE',
    ] as const) {
      expect(StreakSystem.track(frozen(reason), view()).marks.at(-1)).toEqual({
        streakTrackMarkKind: 'PROTECTED',
        on: '2026-11-16',
        reason,
        open: true,
        visitDay: null,
      });
    }
    // Paused, the open mark is the due date like any other.
    expect(
      StreakSystem.track(frozen('PAUSE'), view({ paused: true })).marks.at(-1),
    ).toMatchObject({ streakTrackMarkKind: 'CURRENT', on: '2026-11-16' });
  });

  it('ends on the last closed mark while no period is open', () => {
    const track = StreakSystem.track(
      cardState({
        ...StreakPhaseState.broken(
          localDate('2026-09-20'),
          localDate('2026-10-04'),
        ),
        current: 0,
        dueBy: null,
        periodIntervalDays: null,
        periodGraceDays: null,
        periodSource: null,
        periodHabitDays: null,
        periods: [closed('KEPT', '2026-07-01'), closed('MISSED', '2026-08-12')],
      }),
      view(),
    );
    expect(track.marks.filter((mark) => mark.open)).toEqual([]);
    expect(track.marks.at(-1)).toMatchObject({
      streakTrackMarkKind: 'MISSED',
      open: false,
    });
  });

  it('draws eight marks at most, one of them open, whatever the run holds', () => {
    const state = stateOf(DEFAULT, georgi);
    const track = StreakSystem.track(state, view());
    expect(track.marks).toHaveLength(8);
    expect(track.marks.filter((mark) => mark.open)).toHaveLength(1);
    expect(StreakSystem.track(state, view({ limit: 6 })).marks).toHaveLength(6);
    expect(StreakSystem.track(state, view({ limit: 0 })).marks).toEqual([]);
  });

  it('draws the closed periods alone with nobody in the chair, not paused and no due date', () => {
    // The admin sample's view (law-10-decision-extraction.md R-3): every
    // closed period, uncut, and no open mark without a due date.
    const periods = [
      closed('KEPT', '2026-07-01'),
      closed('PROTECTED', '2026-08-12', 'FREEZE'),
      closed('REPAIRED', '2026-08-20'),
    ];
    const track = StreakSystem.track(cardState({ dueBy: null, periods }), {
      today: CARD_TODAY,
      inChairToday: false,
      paused: false,
      limit: periods.length + 1,
    });
    expect(track.marks).toEqual([
      {
        streakTrackMarkKind: 'KEPT',
        on: '2026-07-01',
        reason: null,
        open: false,
        visitDay: '2026-07-01',
      },
      {
        streakTrackMarkKind: 'PROTECTED',
        on: '2026-08-12',
        reason: 'FREEZE',
        open: false,
        visitDay: null,
      },
      {
        streakTrackMarkKind: 'REPAIRED',
        on: '2026-08-20',
        reason: null,
        open: false,
        visitDay: '2026-08-20',
      },
    ]);
  });

  it('is pure: same input → same output, inputs untouched', () => {
    const state = deepFreeze(stateOf(DEFAULT, georgi));
    const seen = deepFreeze(view({ inChairToday: true }));
    expect(StreakSystem.track(state, seen)).toEqual(
      StreakSystem.track(state, seen),
    );
  });
});

/*
 * THE ADMIN SAMPLE'S TRACK IS `track`'s (law-10-decision-extraction.md §7
 * R-12, for R-3). `admin-rhythm.words.ts` `samplePeriods` draws the
 * projection's closed periods, then — only with a `dueBy` — one open mark,
 * PROTECTED while FROZEN, else CURRENT, dated by `dueBy`. `track` dates a
 * FROZEN open mark by `phaseFrozenUntil` and draws it even without a
 * `dueBy`. The two agree exactly when every FROZEN state the sample can
 * meet has `dueBy === phaseFrozenUntil` (and no FROZEN state lacks a
 * `dueBy`). The projector sets `dueBy = due + the days a running pause has
 * left`: a carried period (a protection, an excuse) is frozen until `due`
 * itself, while a PAUSE freezes until its own last day. The sample's facts
 * (`admin-rhythm.preview.ts` `sampleRhythmFacts`) are visits alone — no
 * pause, ever — so on them the two are one: proven below over the sample's
 * own facts under several rules, on its day and on every day after it, as
 * the run ages through risk, grace, protections and the break.
 */
describe('StreakSystem.track ≡ the admin sample’s track (§7 R-12)', () => {
  /** `sampleRhythmFacts`, as the admin page builds them: six visits on time, then one a whole period late, the newest yesterday — visits alone. */
  function sampleFacts(definition: StreakRule, today: string): StreakFacts {
    const onTime = StreakIntervalRule.daysFor(definition, null).days;
    const late = 2 * StreakIntervalRule.daysFor(definition, onTime).days;
    const gaps = [...Array.from({ length: 5 }, () => onTime), late];
    let ago = 1;
    const agos = [ago];
    for (const gap of [...gaps].reverse()) {
      ago += gap;
      agos.push(ago);
    }
    return facts({
      visits: agos
        .reverse()
        .map((back) => ({ day: addDays(today, -back), counted: true })),
    });
  }

  type Drawn = { readonly kind: string; readonly on: string };

  /** `samplePeriods`'s marks, as tags and days (its ids and words are the page's). */
  function sampleMarks(state: StreakState): readonly Drawn[] {
    const closedMarks: Drawn[] = state.periods.map((fact) => ({
      kind: fact.streakPeriodMark,
      on: fact.on,
    }));
    if (state.dueBy === null) return closedMarks;
    return [
      ...closedMarks,
      {
        kind:
          state.streakPhase === StreakPhase.Frozen
            ? StreakTrackMarkKind.Protected
            : StreakTrackMarkKind.Current,
        on: state.dueBy,
      },
    ];
  }

  /** `track` as R-3 would call it for the sample: nobody in the chair, not paused, nothing cut. */
  function trackMarks(state: StreakState, today: string): readonly Drawn[] {
    return StreakSystem.track(state, {
      today: localDate(today),
      inChairToday: false,
      paused: false,
      limit: state.periods.length + 1,
    }).marks.map((mark) => ({ kind: mark.streakTrackMarkKind, on: mark.on }));
  }

  const RULES: readonly [string, StreakRule][] = [
    ['the recommended rule', DEFAULT],
    ['no protections', rule(NO_PROTECTIONS)],
    ['no earn-back', rule(NO_EARN_BACK)],
    ['a miss holds the count', rule({ onBreak: 'HOLD' })],
    ['five weeks', rule({ ...StreakIntervalRule.fixed(35) })],
    [
      'a personal interval',
      rule({ ...StreakIntervalRule.personal(50, 21, 70, 42) }),
    ],
    // A reserve to start with: the one way a visit-only history is ever
    // covered (protections are otherwise granted by facts the sample lacks).
    ['a reserve to start with', rule({ protectionsStartWith: 2 })],
    [
      'a personal interval and a reserve',
      rule({
        ...StreakIntervalRule.personal(50, 21, 70, 42),
        protectionsStartWith: 1,
      }),
    ],
  ];

  it.each(RULES)('agrees on the sample’s own day under %s', (_, definition) => {
    const state = projectStreak(
      definition,
      sampleFacts(definition, TODAY),
      TODAY,
    );
    if (state === null) throw new Error('the sample has no run');
    expect(trackMarks(state, TODAY)).toEqual(sampleMarks(state));
    expect(trackMarks(state, TODAY).at(-1)?.kind).toBe(
      StreakTrackMarkKind.Current,
    );
  });

  it('agrees on every later day as the sample’s run ages, FROZEN states dated by their due date', () => {
    const phases = new Set<string>();
    let frozen = 0;
    for (const [, definition] of RULES) {
      const sample = sampleFacts(definition, TODAY);
      for (let offset = 0; offset <= 240; offset++) {
        const on = day(offset);
        const state = projectStreak(definition, sample, on);
        if (state === null) continue;
        phases.add(state.streakPhase);
        if (state.streakPhase === StreakPhase.Frozen) {
          frozen += 1;
          expect(state.dueBy).toBe(state.phaseFrozenUntil);
        }
        expect(trackMarks(state, on)).toEqual(sampleMarks(state));
      }
    }
    // Not vacuous: the run went through every phase a visit-only history can reach.
    expect(frozen).toBeGreaterThan(0);
    expect([...phases].sort()).toEqual(
      [
        StreakPhase.Active,
        StreakPhase.AtRisk,
        StreakPhase.Broken,
        StreakPhase.Frozen,
        StreakPhase.InGrace,
      ].sort(),
    );
  });

  it('agrees on the admin words’ own frozen sample (dueBy = phaseFrozenUntil)', () => {
    const state = cardState({
      ...StreakPhaseState.frozen(localDate('2026-10-10'), 'FREEZE'),
      current: 3,
      best: 5,
      lastQualifiedAtUtcMs: null,
      dueBy: localDate('2026-10-10'),
      periods: [
        {
          streakPeriodMark: 'KEPT',
          on: localDate('2026-07-04'),
          periodReason: null,
        },
        {
          streakPeriodMark: 'PROTECTED',
          on: localDate('2026-08-15'),
          periodReason: 'STAFF_CANCELLED',
        },
      ],
    });
    expect(trackMarks(state, '2026-09-28')).toEqual(sampleMarks(state));
  });

  it('is NOT the rule under a pause: a paused period is frozen until the pause’s last day, not its due date', () => {
    // Why the equivalence rests on the sample's facts holding no pause.
    const state = stateOf(DEFAULT, {
      visits: visitsAt([-20]),
      pauses: [{ from: day(-5), until: day(5), reason: 'PAUSE' }],
    });
    expect(state.streakPhase).toBe(StreakPhase.Frozen);
    if (state.streakPhase !== StreakPhase.Frozen) return;
    expect(state.phaseFrozenUntil).toBe(day(5));
    expect(state.dueBy).not.toBe(state.phaseFrozenUntil);
    expect(trackMarks(state, TODAY)).not.toEqual(sampleMarks(state));
  });
});

// ── Where the rhythm stands (Law 10.2 — wallet.presenter.ts `standingOf`) ──

/*
 * `walletRhythmVm`'s cases (wallet.presenter.spec.ts), ported as outlook
 * assertions on the same book: Георги and Мартин as the loyalty fixtures
 * hold them, on Monday 28 September 2026 — Георги's fade done, Мартин in
 * the chair. The line's words, the capsule's text and the track's sentence
 * stay the wallet's; the state, the day each names, the due date the
 * sentence names, the capsule and its urgency are the system's.
 */
describe('StreakSystem.outlook — where the rhythm stands', () => {
  const stateFound = (holder: {
    readonly account: { readonly streaks: readonly StreakState[] };
  }): StreakState => {
    const state = StreakState.find(holder.account.streaks, STREAK_ID);
    if (state === null) throw new Error('the holder has no rhythm');
    return state;
  };
  const GEORGI_STATE = stateFound(loyaltyAccountFixtures.georgi);
  const MARTIN_STATE = stateFound(loyaltyAccountFixtures.martin);
  /** The last counted visit's shop day — the presenter's zone edge (D-11). */
  const lastOn = (state: StreakState): LocalDate | null =>
    state.lastQualifiedAtUtcMs === null
      ? null
      : ZonedTimeSystem.toLocal(state.lastQualifiedAtUtcMs, FIXTURE_TIME_ZONE)
          .localDate;
  const seen = (
    state: StreakState,
    patch: Partial<StreakOutlookView> = {},
  ): StreakOutlookView => ({
    today: CARD_TODAY,
    inChairDue: null,
    paused: false,
    lastQualifiedOn: lastOn(state),
    ...patch,
  });
  /** Георги's rhythm in another state: any field, the phase a slice of its own. */
  const georgiIn = (
    phase: StreakPhaseState,
    patch: Partial<StreakState> = {},
  ): StreakState => ({ ...GEORGI_STATE, ...patch, ...phase }) as StreakState;
  const outlookOf = (
    state: StreakState,
    patch: Partial<StreakOutlookView> = {},
  ) => StreakSystem.outlook(state, seen(state, patch));
  const NOT_HELD = { heldByAppointmentId: null, heldOn: null } as const;
  const NO_PERIOD = {
    periodIntervalDays: null,
    periodGraceDays: null,
    periodSource: null,
    periodHabitDays: null,
  } as const;

  it('holds the outlooks and capsules as SCREAMING tags', () => {
    expect(Object.values(StreakOutlook)).toEqual([
      'PAUSED',
      'IN_CHAIR',
      'NOT_STARTED',
      'FROZEN',
      'BROKEN_REPAIRABLE',
      'BROKEN_FINAL',
      'HELD',
      'DUE',
      'DUE_NONE',
      'AT_RISK',
      'IN_GRACE',
    ]);
    expect(Object.values(StreakCapsule)).toEqual([
      'FROZEN',
      'BROKEN',
      'HELD',
      'AT_RISK',
      'IN_GRACE',
    ]);
  });

  it('names a healthy run’s due date, with no capsule (Георги)', () => {
    expect(outlookOf(GEORGI_STATE)).toEqual({
      streakOutlook: StreakOutlook.Due,
      day: '2026-11-09',
      nextDue: '2026-11-09',
      dueNamed: true,
      streakCapsule: null,
      urgent: false,
      weeksSinceLast: 0,
      phaseFreezeReason: null,
    });
  });

  it('coaches towards the visit after the one in the chair, whatever the phase (Мартин)', () => {
    const inChairDue = StreakSystem.inChairDue(MARTIN_STATE, CARD_TODAY, {
      inChairToday: true,
      paused: false,
    });
    expect(inChairDue).toBe('2026-11-09');
    expect(outlookOf(MARTIN_STATE, { inChairDue })).toEqual({
      streakOutlook: StreakOutlook.InChair,
      day: '2026-11-09',
      nextDue: '2026-11-09',
      dueNamed: true,
      streakCapsule: null,
      urgent: false,
      weeksSinceLast: 0,
      phaseFreezeReason: null,
    });
  });

  it('names the visit on the book that holds the due date, where a warning would have stood', () => {
    // Мартин off the chair: at risk, his booking for today holds the period.
    expect(outlookOf(MARTIN_STATE)).toEqual({
      streakOutlook: StreakOutlook.Held,
      day: '2026-09-28',
      // The line names the booking: the track's sentence names no due date.
      nextDue: null,
      dueNamed: false,
      streakCapsule: StreakCapsule.Held,
      urgent: false,
      weeksSinceLast: 0,
      phaseFreezeReason: null,
    });
    // Beside a healthy figure nothing stands.
    expect(
      outlookOf(
        georgiIn(StreakPhaseState.active(), {
          heldByAppointmentId: AppointmentId.of('appt-next'),
          heldOn: localDate('2026-10-29'),
        }),
      ),
    ).toMatchObject({
      streakOutlook: StreakOutlook.Held,
      day: '2026-10-29',
      streakCapsule: null,
      dueNamed: false,
      nextDue: null,
    });
  });

  it('warns when the due date is near, with the weeks since the last visit, and in grace', () => {
    const atRisk = { ...MARTIN_STATE, ...NOT_HELD } as StreakState;
    expect(outlookOf(atRisk)).toEqual({
      streakOutlook: StreakOutlook.AtRisk,
      day: '2026-09-30',
      nextDue: '2026-09-30',
      dueNamed: true,
      streakCapsule: StreakCapsule.AtRisk,
      urgent: true,
      // «Последно преди 6 седмици»: 19 August to 28 September is 40 days.
      weeksSinceLast: 6,
      phaseFreezeReason: null,
    });
    expect(lastOn(MARTIN_STATE)).toBe('2026-08-19');

    expect(
      outlookOf(
        georgiIn(StreakPhaseState.inGrace(localDate('2026-10-05')), {
          dueBy: localDate('2026-09-28'),
          ...NOT_HELD,
        }),
      ),
    ).toEqual({
      streakOutlook: StreakOutlook.InGrace,
      day: '2026-10-05',
      nextDue: '2026-09-28',
      dueNamed: true,
      streakCapsule: StreakCapsule.InGrace,
      urgent: true,
      weeksSinceLast: 0,
      phaseFreezeReason: null,
    });
  });

  it.each([
    [3, 1],
    [10, 1],
    [11, 2],
    [40, 6],
    [0, 1],
  ])(
    'rounds %i days since the last counted visit to %i whole weeks, at least one',
    (days, weeks) => {
      const atRisk = { ...MARTIN_STATE, ...NOT_HELD } as StreakState;
      expect(
        outlookOf(atRisk, {
          lastQualifiedOn: LocalDate.addDays(CARD_TODAY, -days),
        }).weeksSinceLast,
      ).toBe(weeks);
    },
  );

  it('reads the weeks through ClientStatsSystem.cadenceWeeks, and 0 with no counted visit', () => {
    const atRisk = { ...MARTIN_STATE, ...NOT_HELD } as StreakState;
    for (let days = 0; days <= 120; days++) {
      expect(
        outlookOf(atRisk, {
          lastQualifiedOn: LocalDate.addDays(CARD_TODAY, -days),
        }).weeksSinceLast,
      ).toBe(ClientStatsSystem.cadenceWeeks(days));
    }
    expect(outlookOf(atRisk, { lastQualifiedOn: null }).weeksSinceLast).toBe(0);
    // Outside AT_RISK no weeks are counted.
    expect(outlookOf(GEORGI_STATE).weeksSinceLast).toBe(0);
  });

  it('says a covered period is FROZEN, by what covers it, naming no day', () => {
    for (const reason of Object.values(FreezeReason)) {
      expect(
        outlookOf(
          georgiIn(StreakPhaseState.frozen(localDate('2026-11-16'), reason), {
            dueBy: localDate('2026-11-16'),
          }),
        ),
      ).toEqual({
        streakOutlook: StreakOutlook.Frozen,
        day: null,
        nextDue: null,
        dueNamed: false,
        streakCapsule: StreakCapsule.Frozen,
        urgent: false,
        weeksSinceLast: 0,
        phaseFreezeReason: reason,
      });
    }
  });

  it('coaches a broken run back while a visit can still restore it, and never after', () => {
    const broken = (repairableUntil: string) =>
      outlookOf(
        georgiIn(
          StreakPhaseState.broken(
            localDate('2026-09-20'),
            localDate(repairableUntil),
          ),
          { current: 0, dueBy: null, ...NO_PERIOD },
        ),
      );
    expect(broken('2026-10-04')).toEqual({
      streakOutlook: StreakOutlook.BrokenRepairable,
      day: '2026-10-04',
      nextDue: null,
      dueNamed: false,
      streakCapsule: StreakCapsule.Broken,
      urgent: true,
      weeksSinceLast: 0,
      phaseFreezeReason: null,
    });
    // The last day to restore it is today: still restorable.
    expect(broken('2026-09-28')).toMatchObject({
      streakOutlook: StreakOutlook.BrokenRepairable,
      day: '2026-09-28',
      urgent: true,
    });
    // Past it — or the day before the break, where nothing can be restored —
    // no day is named (never a repair day already gone, §7 R-6).
    for (const until of ['2026-09-27', '2026-09-19']) {
      expect(broken(until)).toEqual({
        streakOutlook: StreakOutlook.BrokenFinal,
        day: null,
        nextDue: null,
        dueNamed: false,
        streakCapsule: StreakCapsule.Broken,
        urgent: false,
        weeksSinceLast: 0,
        phaseFreezeReason: null,
      });
    }
  });

  it('starts a rhythm nobody has begun — no count AND no counted visit, exactly', () => {
    const fresh = georgiIn(StreakPhaseState.active(), {
      current: 0,
      best: 0,
      lastQualifiedAtUtcMs: null,
      dueBy: null,
      periods: [],
      ...NO_PERIOD,
    });
    expect(outlookOf(fresh)).toEqual({
      streakOutlook: StreakOutlook.NotStarted,
      day: null,
      nextDue: null,
      dueNamed: false,
      streakCapsule: null,
      urgent: false,
      weeksSinceLast: 0,
      phaseFreezeReason: null,
    });
    // A count with no stamp, or a stamp with no count, has begun.
    expect(
      outlookOf(
        georgiIn(StreakPhaseState.active(), {
          current: 1,
          lastQualifiedAtUtcMs: null,
        }),
      ).streakOutlook,
    ).toBe(StreakOutlook.Due);
    expect(
      outlookOf(georgiIn(StreakPhaseState.active(), { current: 0 }))
        .streakOutlook,
    ).toBe(StreakOutlook.Due);
    // A run of one names its due date.
    expect(
      outlookOf(georgiIn(StreakPhaseState.active(), { current: 1, best: 1 })),
    ).toMatchObject({
      streakOutlook: StreakOutlook.Due,
      nextDue: '2026-11-09',
    });
  });

  it('says a healthy run with no due date names none', () => {
    expect(
      outlookOf(georgiIn(StreakPhaseState.active(), { dueBy: null })),
    ).toEqual({
      streakOutlook: StreakOutlook.DueNone,
      day: null,
      nextDue: null,
      dueNamed: true,
      streakCapsule: null,
      urgent: false,
      weeksSinceLast: 0,
      phaseFreezeReason: null,
    });
  });

  it('keeps a paused client’s run frozen where it stands, before anything else', () => {
    const paused = {
      streakOutlook: StreakOutlook.Paused,
      day: null,
      nextDue: null,
      dueNamed: false,
      streakCapsule: null,
      urgent: false,
      weeksSinceLast: 0,
      phaseFreezeReason: null,
    };
    expect(outlookOf(GEORGI_STATE, { paused: true })).toEqual(paused);
    expect(
      outlookOf(MARTIN_STATE, {
        paused: true,
        inChairDue: localDate('2026-11-09'),
      }),
    ).toEqual(paused);
    expect(
      outlookOf({ ...MARTIN_STATE, ...NOT_HELD } as StreakState, {
        paused: true,
      }),
    ).toEqual(paused);
  });

  it('names the in-chair line before the unbegun one, in `standingOf`’s order', () => {
    expect(
      outlookOf(
        georgiIn(StreakPhaseState.active(), {
          current: 0,
          lastQualifiedAtUtcMs: null,
        }),
        { inChairDue: localDate('2026-11-09') },
      ).streakOutlook,
    ).toBe(StreakOutlook.InChair);
  });

  it('never names a due date for a FROZEN, HELD, BROKEN or paused line, whatever dueBy holds', () => {
    const states: readonly [StreakState, Partial<StreakOutlookView>][] = [
      [
        georgiIn(
          StreakPhaseState.frozen(localDate('2026-11-16'), FreezeReason.Freeze),
        ),
        {},
      ],
      [MARTIN_STATE, {}],
      [
        georgiIn(
          StreakPhaseState.broken(
            localDate('2026-09-20'),
            localDate('2026-10-04'),
          ),
        ),
        {},
      ],
      [GEORGI_STATE, { paused: true }],
    ];
    for (const [state, patch] of states) {
      expect(state.dueBy).not.toBeNull();
      const answer = outlookOf(state, patch);
      expect(answer.dueNamed).toBe(false);
      expect(answer.nextDue).toBeNull();
    }
  });
});

describe('StreakSystem.record — the best run, said while the run is shorter', () => {
  it('says the best only while the run in progress is shorter', () => {
    expect(StreakSystem.record({ current: 9, best: 23 })).toBe(23);
    expect(StreakSystem.record({ current: 0, best: 24 })).toBe(24);
    expect(StreakSystem.record({ current: 24, best: 24 })).toBeNull();
    expect(StreakSystem.record({ current: 0, best: 0 })).toBeNull();
  });
});

describe('StreakSystem.dueAfter — the day the next visit keeps the rhythm by', () => {
  const inChair = shopDay('2026-11-09');
  const dueBy = shopDay('2026-10-30');

  it('names the in-chair due date first, whatever the state is due by', () => {
    expect(StreakSystem.dueAfter({ dueBy }, inChair)).toBe('2026-11-09');
    expect(StreakSystem.dueAfter({ dueBy: null }, inChair)).toBe('2026-11-09');
  });

  it('falls back on the state’s own due date with nobody in the chair', () => {
    expect(StreakSystem.dueAfter({ dueBy }, null)).toBe('2026-10-30');
  });

  it('names no day when neither does', () => {
    expect(StreakSystem.dueAfter({ dueBy: null }, null)).toBeNull();
  });

  it('is pure: same input → same output, inputs untouched', () => {
    const state = deepFreeze({ dueBy });
    const once = StreakSystem.dueAfter(state, inChair);
    expect(StreakSystem.dueAfter(state, inChair)).toBe(once);
    expect(state).toEqual({ dueBy: '2026-10-30' });
  });
});

describe('StreakSystem.protectionsHeld — the reserve, where the rule grants it', () => {
  const granted = StreakRuleSystem.summary(DEFAULT);

  it('counts the protections in reserve', () => {
    expect(StreakSystem.protectionsHeld({ freezesBanked: 2 }, granted)).toBe(2);
    expect(StreakSystem.protectionsHeld({ freezesBanked: 1 }, granted)).toBe(1);
  });

  it('says nothing with an empty reserve', () => {
    expect(
      StreakSystem.protectionsHeld({ freezesBanked: 0 }, granted),
    ).toBeNull();
  });

  it('says nothing where the rule grants none, whatever was banked', () => {
    for (const definition of [
      rule(NO_PROTECTIONS),
      rule({
        ...NO_PROTECTIONS,
        protectionsEnabled: true,
        protectionsMaxBanked: 0,
      }),
    ]) {
      expect(
        StreakSystem.protectionsHeld(
          { freezesBanked: 2 },
          StreakRuleSystem.summary(definition),
        ),
      ).toBeNull();
    }
  });
});

describe('StreakSystem outlook purity', () => {
  it('is pure: same input → same output, inputs untouched', () => {
    const state = deepFreeze(
      loyaltyAccountFixtures.martin.account.streaks[0] as StreakState,
    );
    const seenBy = deepFreeze({
      today: CARD_TODAY,
      inChairDue: null,
      paused: false,
      lastQualifiedOn: localDate('2026-08-19'),
    });
    const summary = deepFreeze(StreakRuleSystem.summary(DEFAULT));
    const run = () => [
      StreakSystem.outlook(state, seenBy),
      StreakSystem.record(state),
      StreakSystem.protectionsHeld(state, summary),
    ];
    expect(run()).toEqual(run());
  });
});

describe('StreakSystem.headOf — the rhythm a card is judged by', () => {
  const cadence = streakDefinitionFixture();
  const other = streakDefinitionFixture({
    id: StreakDefinitionId.of('weekly'),
  });
  const held = (id: StreakDefinitionId) => ({ streakId: id });

  it('takes the first head the account holds a state for, in the catalogue’s order', () => {
    expect(StreakSystem.headOf([cadence, other], [held(other.id)])).toBe(other);
    expect(
      StreakSystem.headOf([other, cadence], [held(cadence.id), held(other.id)]),
    ).toBe(other);
  });

  it('falls to the catalogue’s first head when the account holds none', () => {
    expect(StreakSystem.headOf([cadence, other], [])).toBe(cadence);
    expect(
      StreakSystem.headOf(
        [cadence, other],
        [held(StreakDefinitionId.of('retired'))],
      ),
    ).toBe(cadence);
  });

  it('answers nothing for a shop without a rhythm', () => {
    expect(StreakSystem.headOf([], [held(cadence.id)])).toBeNull();
    expect(StreakSystem.headOf([], [])).toBeNull();
  });

  it('is pure: same input → same output, inputs untouched', () => {
    const heads = deepFreeze([cadence, other]);
    const states = deepFreeze([held(other.id)]);
    expect(StreakSystem.headOf(heads, states)).toBe(
      StreakSystem.headOf(heads, states),
    );
    expect(heads).toEqual([cadence, other]);
    expect(states).toEqual([held(other.id)]);
  });
});
