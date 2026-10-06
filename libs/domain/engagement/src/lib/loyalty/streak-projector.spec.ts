import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { sofiaDayOf } from './loyalty-calendar';
import type { StreakPeriodFact } from './projections';
import {
  STREAK_EXCUSES,
  STREAK_SHOP_EXCUSES,
  StreakDefinition,
  StreakDefinitionProps,
  StreakExcuse,
} from './streak-definition';
import {
  STREAK_PERIODS_KEPT,
  StreakFacts,
  StreakTrace,
  projectStreak,
  traceStreak,
} from './streak-projector';
import { addDays } from './streak-schedule';

/** The seed's own day: Георги's cut is done, Мартин is in the chair. */
const TODAY = '2026-09-28';
const day = (offset: number): string => addDays(TODAY, offset);

/** The recommended rule with `patch` over it: a part in the patch replaces the whole part. */
function rule(patch: Partial<StreakDefinitionProps> = {}): StreakDefinition {
  const result = StreakDefinition.create({
    ...StreakDefinition.default().toProps(),
    ...patch,
  });
  if (result.isFailure()) throw new Error(JSON.stringify(result.error));
  return result.value;
}

const DEFAULT = rule();
const OFF = { enabled: false } as const;
const NO_EARN_BACK = { enabled: false, windowDays: 14, perYear: 1 } as const;
const NO_PROTECTIONS = {
  enabled: false,
  maxBanked: 2,
  earnEvery: 5,
  startWith: 0,
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
  definition: StreakDefinition,
  patch: Partial<StreakFacts>,
  today = TODAY,
) {
  const state = projectStreak(definition, facts(patch), today);
  if (state === null) throw new Error('no state: nobody counted yet');
  return state;
}

const marks = (periods: readonly StreakPeriodFact[]): string[] =>
  periods.map(({ mark, on, reason }) =>
    reason === null ? `${mark} ${on}` : `${mark} ${on} ${reason}`,
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
      ? { at: new Date('2026-09-28T07:00:00.000Z') }
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
  excused: [{ day: '2026-05-09', reason: 'barberAbsence' }],
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
      phase: { kind: 'active' },
      current: 24,
      best: 24,
      lastQualifiedAt: new Date('2026-09-28T07:00:00.000Z'),
      dueBy: '2026-11-09',
      freezesBanked: 2,
      period: {
        intervalDays: 42,
        graceDays: 7,
        source: 'fixed',
        habitDays: null,
      },
      periods: GEORGI.slice(-12).map((on) => ({
        mark: 'kept',
        on,
        reason: null,
      })),
      // Today's booking is the visit that counted: nothing lies ahead.
      heldBy: null,
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
      phase: { kind: 'atRisk', dueBy: '2026-10-02' },
      dueBy: '2026-10-02',
      freezesBanked: 2,
      // He is on the book for today, inside the period.
      heldBy: { appointmentId: 'appt-dev-2', on: '2026-09-28' },
    });
    // 37 days lie between the visits around 9 May: he came in time by
    // himself, so the excuse was never needed and is not drawn.
    expect(marks(state.periods)).toEqual(
      MARTIN.slice(-12).map((on) => `kept ${on}`),
    );
    // No instant came with the fact: the day's own beginning in Sofia.
    expect(state.lastQualifiedAt).toEqual(new Date('2026-08-20T21:00:00.000Z'));
  });

  it('stays in rhythm inside the cadence and its grace, at risk a week before it is due', () => {
    // Due on day +2 of a 42-day cadence: inside the 7-day risk lead.
    expect(stateOf(DEFAULT, { visits: visitsAt([-80, -40]) })).toMatchObject({
      current: 2,
      best: 2,
      phase: { kind: 'atRisk', dueBy: day(2) },
      dueBy: day(2),
    });
    expect(stateOf(DEFAULT, { visits: visitsAt([-80, -30]) }).phase).toEqual({
      kind: 'active',
    });
    // Past due, inside the grace: still the same run.
    expect(stateOf(DEFAULT, { visits: visitsAt([-80, -45]) }).phase).toEqual({
      kind: 'inGrace',
      graceUntil: day(4),
    });
    // A visit 49 days on (42 + 7 grace) keeps the run.
    const kept = stateOf(DEFAULT, { visits: visitsAt([-60, -11]) });
    expect(kept.current).toBe(2);
    expect(marks(kept.periods)).toEqual([
      `kept ${day(-60)}`,
      `kept ${day(-11)}`,
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
      period: null,
      heldBy: null,
      phase: {
        kind: 'broken',
        brokenAt: day(-240 + 50),
        repairableUntil: day(-240 + 64),
      },
    });
    expect(marks(gone.state?.periods ?? [])).toEqual([
      `kept ${day(-300)}`,
      `kept ${day(-270)}`,
      `kept ${day(-240)}`,
      // The due date nobody met, not the day it was judged.
      `missed ${day(-240 + 42)}`,
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
      `missed ${day(-198)}`,
      `repaired ${day(-185)}`,
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
      `protected ${day(-280 + 42)} freeze`,
      `kept ${day(-200)}`,
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
      { visits, excused: [{ day: day(-165), reason: 'barberAbsence' }] },
      day(-115),
    );
    expect(state.current).toBe(2);
    // The period outlived its own deadline: drawn as covered, the reason named.
    expect(marks(state.periods)).toEqual([
      `kept ${day(-200)}`,
      `protected ${day(-200 + 42)} barberAbsence`,
      `kept ${day(-120)}`,
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
      excused: [{ day: day(3), reason: 'shopClosure' }],
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
    expect(sofiaDayOf(state.lastQualifiedAt ?? new Date(0))).toBe(day(-40));
  });

  it('P3: a visit closer than the minimum gap moves the due date and adds nothing', () => {
    // The same haircut, fixed up three days later.
    const fixedUp = stateOf(DEFAULT, { visits: visitsAt([-40, -37]) });
    expect(fixedUp).toMatchObject({ current: 1, best: 1, dueBy: day(5) });
    expect(marks(fixedUp.periods)).toEqual([`kept ${day(-40)}`]);
    expect(sofiaDayOf(fixedUp.lastQualifiedAt ?? new Date(0))).toBe(day(-40));
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
      phase: { kind: 'inGrace', graceUntil: day(3) },
      heldBy: { appointmentId: 'appt-7', on: day(3) },
    });
    expect(marks(state.periods)).toEqual([`kept ${day(-50)}`]);
  });

  it('is the miss without one', () => {
    expect(stateOf(DEFAULT, { visits })).toMatchObject({
      current: 0,
      heldBy: null,
      phase: { kind: 'broken', brokenAt: day(0), repairableUntil: day(14) },
    });
  });

  it.each([
    ['later than the rule allows past the due date', booked(-10, 7, 'a')],
    ['placed after the grace ran out', booked(0, 3, 'a')],
  ])('does not hold when %s', (_label, booking) => {
    expect(stateOf(DEFAULT, { visits, bookings: [booking] }).phase.kind).toBe(
      'broken',
    );
  });

  it('holds to the last day the rule allows, and not at all when the hold is off', () => {
    expect(
      stateOf(DEFAULT, { visits, bookings: [booked(-1, 6, 'a')] }).heldBy,
    ).toEqual({ appointmentId: 'a', on: day(6) });
    const off = rule({ bookingHold: { enabled: false, maxDaysPastDue: 14 } });
    expect(
      stateOf(off, { visits, bookings: [booked(-10, 3, 'a')] }),
    ).toMatchObject({ heldBy: null, phase: { kind: 'broken' } });
  });

  it('holds the clock for a booking nobody named, and names no visit', () => {
    expect(
      stateOf(DEFAULT, { visits, bookings: [booked(-10, 3)] }),
    ).toMatchObject({
      heldBy: null,
      phase: { kind: 'inGrace', graceUntil: day(3) },
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
      `kept ${day(-100)}`,
      `kept ${day(-45)}`,
    ]);
    // Walking in unannounced, the same visit is the year's one earn-back.
    const walkedIn = stateOf(
      DEFAULT,
      { visits: visitsAt([-100, -45]) },
      day(-40),
    );
    expect(marks(walkedIn.periods)).toEqual([
      `kept ${day(-100)}`,
      `missed ${day(-58)}`,
      `repaired ${day(-45)}`,
    ]);
  });

  it('releases a booking nobody came to: judged as if it never existed', () => {
    expect(
      stateOf(
        DEFAULT,
        { visits: visitsAt([-100]), bookings: [booked(-60, -45, 'a')] },
        day(-40),
      ).phase,
    ).toEqual({
      kind: 'broken',
      brokenAt: day(-50),
      repairableUntil: day(-36),
    });
  });

  it('holds for the booked visit the shop then called off, and restarts the clock from it', () => {
    const state = stateOf(
      DEFAULT,
      {
        visits: visitsAt([-100]),
        bookings: [booked(-60, -45, 'a')],
        excused: [{ day: day(-45), reason: 'staffCancelled' }],
      },
      day(-40),
    );
    expect(state).toMatchObject({
      current: 1,
      dueBy: day(-3),
      phase: { kind: 'frozen', until: day(-3), reason: 'excuse' },
    });
    expect(marks(state.periods)).toEqual([
      `kept ${day(-100)}`,
      `protected ${day(-58)} staffCancelled`,
    ]);
  });

  it('names the visit ahead in a healthy period too', () => {
    expect(
      stateOf(DEFAULT, {
        visits: visitsAt([-10]),
        bookings: [booked(-10, 25, 'next')],
      }),
    ).toMatchObject({
      phase: { kind: 'active' },
      heldBy: { appointmentId: 'next', on: day(25) },
    });
  });
});

describe('projectStreak, the interval (P5)', () => {
  it('fixed: one number for everyone, pinned on the period', () => {
    const five = rule({ interval: { kind: 'fixed', days: 35 } });
    expect(stateOf(five, { visits: visitsAt([-10]) })).toMatchObject({
      dueBy: day(25),
      period: {
        intervalDays: 35,
        graceDays: 7,
        source: 'fixed',
        habitDays: null,
      },
    });
  });

  const personal = rule({
    interval: {
      kind: 'personal',
      tolerancePct: 50,
      minDays: 21,
      maxDays: 70,
      fallbackDays: 42,
    },
  });
  /** Visits `gap` days apart, the last of them `last` days from today. */
  const every = (gap: number, count: number, last = -1) =>
    visitsAt(
      Array.from({ length: count }, (_, i) => last - gap * (count - 1 - i)),
    );

  it('personal: the newcomer’s default until the third counted visit', () => {
    expect(stateOf(personal, { visits: every(26, 2) })).toMatchObject({
      dueBy: day(41),
      period: { intervalDays: 42, source: 'fallback', habitDays: null },
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
      stateOf(rule({ ...personal.toProps(), minGapDays: 0 }), {
        visits: every(habit, 3),
      }),
    ).toMatchObject({
      dueBy: day(-1 + interval),
      period: { intervalDays: interval, source: 'personal', habitDays: habit },
    });
  });

  it('personal: a newcomer slower than the default misses before anybody knows the habit', () => {
    // Every 60 days against a default of 42 + 7: the second visit is the
    // year's earn-back, the third starts over. What the ceiling is for.
    const trace = traceStreak(personal, facts({ visits: every(60, 3) }), TODAY);
    expect(trace.counts.map(({ current }) => current)).toEqual([1, 0, 2, 0, 1]);
    expect(trace.state?.period).toMatchObject({
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
      stateOf(personal, { visits: visitsAt(offsets) }).period,
    ).toMatchObject({ habitDays: 20, intervalDays: 30 });
    // One decimal: 26, 26, 27 days.
    expect(
      stateOf(personal, { visits: visitsAt([-80, -54, -28, -1]) }).period,
    ).toMatchObject({ habitDays: 26.3, intervalDays: 39 });
  });

  it('personal: a gap the shop stretched says nothing about the person', () => {
    const visits = visitsAt([-100, -60, -34]);
    expect(
      stateOf(personal, {
        visits,
        excused: [{ day: day(-80), reason: 'barberAbsence' }],
      }).period,
    ).toMatchObject({ habitDays: 26, intervalDays: 39 });
    expect(stateOf(personal, { visits }).period).toMatchObject({
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
      period: { intervalDays: 39, source: 'personal', habitDays: 26 },
    });
  });
});

describe('projectStreak, grace and the cue (P6, P7)', () => {
  it('P6: the last day of grace keeps the run, the day after breaks it', () => {
    const short = rule({ graceDays: 3, repair: NO_EARN_BACK });
    expect(stateOf(short, { visits: visitsAt([-60, -15]) }).current).toBe(2);
    expect(stateOf(short, { visits: visitsAt([-60, -14]) }).current).toBe(1);
    const none = rule({ graceDays: 0, repair: NO_EARN_BACK });
    expect(stateOf(none, { visits: visitsAt([-42]) }).phase).toEqual({
      kind: 'atRisk',
      dueBy: day(0),
    });
    expect(stateOf(none, { visits: visitsAt([-43]) }).phase.kind).toBe(
      'broken',
    );
  });

  it('P6: the grace is pinned with the period', () => {
    expect(
      stateOf(rule({ graceDays: 3 }), { visits: visitsAt([-44]) }),
    ).toMatchObject({
      phase: { kind: 'inGrace', graceUntil: day(1) },
      period: { graceDays: 3 },
    });
  });

  it('P7: the cue turns as early as the rule says, and changes nothing else', () => {
    const early = rule({ riskLeadDays: 14 });
    // Due on day +14.
    expect(stateOf(early, { visits: visitsAt([-28]) }).phase).toEqual({
      kind: 'atRisk',
      dueBy: day(14),
    });
    expect(stateOf(early, { visits: visitsAt([-27]) }).phase).toEqual({
      kind: 'active',
    });
    const late = rule({ riskLeadDays: 0 });
    expect(stateOf(late, { visits: visitsAt([-41]) }).phase.kind).toBe(
      'active',
    );
    expect(stateOf(late, { visits: visitsAt([-42]) }).phase.kind).toBe(
      'atRisk',
    );
    // Мартин is due in four days: the cue is all the two rules differ by.
    const cued = stateOf(early, martin);
    const quiet = stateOf(late, martin);
    expect(cued.phase).toEqual({ kind: 'atRisk', dueBy: '2026-10-02' });
    expect(quiet.phase).toEqual({ kind: 'active' });
    expect({ ...cued, phase: null }).toEqual({ ...quiet, phase: null });
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
      phase: { kind: 'frozen', until: day(-196), reason: 'freeze' },
    });
    expect(marks(state.periods).at(-1)).toBe(`protected ${day(-238)} freeze`);
  });

  it('covers one due date each: two protections carry a run across two', () => {
    const two = rule({
      protections: { enabled: true, maxBanked: 2, earnEvery: 2, startWith: 0 },
    });
    // Four in rhythm bank two; the fifth comes 130 days on (≤ 3 × 42 + 7).
    const state = stateOf(two, {
      visits: visitsAt([-250, -220, -190, -160, -30]),
    });
    expect(state).toMatchObject({ current: 5, freezesBanked: 0 });
    expect(marks(state.periods).slice(-3)).toEqual([
      `protected ${day(-118)} freeze`,
      `protected ${day(-76)} freeze`,
      `kept ${day(-30)}`,
    ]);
  });

  it('off: nothing is earned, given or spent', () => {
    const state = stateOf(
      rule({ protections: NO_PROTECTIONS }),
      { visits: visitsAt(offsets), grants: [{ day: day(-340), count: 2 }] },
      soonAfter(offsets),
    );
    expect(state).toMatchObject({ current: 1, best: 5, freezesBanked: 0 });
  });

  it('earns one every so many counted visits of the run', () => {
    const three = rule({
      protections: { enabled: true, maxBanked: 5, earnEvery: 3, startWith: 0 },
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
      protections: { enabled: true, maxBanked: 1, earnEvery: 1, startWith: 1 },
    });
    expect(
      stateOf(one, {
        visits: visitsAt([-90, -60, -30]),
        grants: [{ day: day(-60), count: 3 }],
      }).freezesBanked,
    ).toBe(1);
    const none = rule({
      protections: { enabled: true, maxBanked: 0, earnEvery: 1, startWith: 0 },
    });
    expect(
      stateOf(none, { visits: visitsAt([-90, -60, -30]) }).freezesBanked,
    ).toBe(0);
  });

  it('starts a client with some, once: a restart does not give them again', () => {
    const gift = rule({
      protections: { enabled: true, maxBanked: 2, earnEvery: 24, startWith: 1 },
      repair: NO_EARN_BACK,
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
      excused: [{ day: day(-30), reason: 'shopClosure' }],
    });
    expect(state).toMatchObject({
      current: 1,
      dueBy: day(12),
      phase: { kind: 'frozen', until: day(12), reason: 'excuse' },
    });
    expect(marks(state.periods)).toEqual([
      `kept ${day(-60)}`,
      `protected ${day(-18)} shopClosure`,
    ]);
  });

  it('is an open period like any other while its own deadline has not passed', () => {
    const state = stateOf(
      DEFAULT,
      {
        visits: visitsAt([-60]),
        excused: [{ day: day(-30), reason: 'shopClosure' }],
      },
      day(-11),
    );
    expect(state.phase).toEqual({ kind: 'active' });
    expect(marks(state.periods)).toEqual([`kept ${day(-60)}`]);
  });

  it('covers a period once, however often the shop called it off', () => {
    const state = stateOf(DEFAULT, {
      visits: visitsAt([-100]),
      excused: [
        { day: day(-70), reason: 'barberAbsence' },
        { day: day(-35), reason: 'staffCancelled' },
      ],
    });
    expect(state).toMatchObject({ current: 1, dueBy: day(7) });
    expect(marks(state.periods)).toEqual([
      `kept ${day(-100)}`,
      `protected ${day(-58)} barberAbsence`,
    ]);
  });

  it('covers the next due date too, after a protection covered the last', () => {
    // Five in rhythm bank one. It covers day −238; the shop calls off the
    // visit of day −200, inside the period the protection opened.
    const state = stateOf(
      DEFAULT,
      {
        visits: visitsAt([-400, -370, -340, -310, -280]),
        excused: [{ day: day(-200), reason: 'shopClosure' }],
      },
      day(-180),
    );
    expect(state).toMatchObject({
      current: 5,
      freezesBanked: 0,
      dueBy: day(-158),
      phase: { kind: 'frozen', until: day(-158), reason: 'excuse' },
    });
    expect(marks(state.periods).slice(-2)).toEqual([
      `protected ${day(-238)} freeze`,
      `protected ${day(-196)} shopClosure`,
    ]);
  });

  it('restores nothing: an excuse after the miss is late', () => {
    expect(
      stateOf(rule({ repair: NO_EARN_BACK }), {
        visits: visitsAt([-100]),
        excused: [{ day: day(-40), reason: 'shopClosure' }],
      }).phase,
    ).toMatchObject({ kind: 'broken', brokenAt: day(-50) });
  });

  describe('closedDays', () => {
    const closing = rule({ excuses: STREAK_EXCUSES });
    // Due on day −7, and the shop was closed from that day for three.
    const closed = [-7, -6, -5].map((offset) => ({
      day: day(offset),
      reason: 'closedDays' as StreakExcuse,
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
        phase: { kind: 'inGrace', graceUntil: day(3) },
      });
      // The nominal deadline was day 0: the wait is in use, and drawn.
      expect(marks(state.periods)).toEqual([
        `kept ${day(-49)}`,
        `protected ${day(-7)} closedDays`,
      ]);
      expect(
        stateOf(closing, { visits: visitsAt([-49]), excused: closed }, day(4))
          .phase,
      ).toMatchObject({ kind: 'broken', brokenAt: day(4) });
    });

    it('is not drawn while the period is inside its nominal deadline', () => {
      expect(
        marks(
          stateOf(closing, { visits: visitsAt([-49]), excused: closed }, day(0))
            .periods,
        ),
      ).toEqual([`kept ${day(-49)}`]);
    });

    it('does nothing where the rule does not excuse closed days, and never restarts the clock', () => {
      expect(
        stateOf(DEFAULT, { visits: visitsAt([-49]), excused: closed }, day(2))
          .phase,
      ).toMatchObject({ kind: 'broken', brokenAt: day(1) });
      // A closed day inside the period is just a day.
      expect(
        stateOf(closing, {
          visits: visitsAt([-30]),
          excused: [{ day: day(-10), reason: 'closedDays' }],
        }).dueBy,
      ).toBe(day(12));
    });
  });
});

describe('projectStreak, pauses (P10)', () => {
  const pausing = rule({ clientPause: { enabled: true, maxDaysPerYear: 90 } });
  // Due on day −18; away for twenty days from day −30.
  const visits = visitsAt([-60]);
  const away = (reason: 'pause' | 'clientPause', from = -30, until = -11) => ({
    from: day(from),
    until: day(until),
    reason,
  });

  it('freezes the run while the pause lasts and moves the due date by its length', () => {
    const during = stateOf(
      pausing,
      { visits, pauses: [away('clientPause')] },
      day(-20),
    );
    expect(during).toMatchObject({
      current: 1,
      // The whole pause counted in: the promise does not creep day by day.
      dueBy: day(2),
      phase: { kind: 'frozen', until: day(-11), reason: 'clientPause' },
    });
    const after = stateOf(pausing, { visits, pauses: [away('clientPause')] });
    expect(after).toMatchObject({
      current: 1,
      dueBy: day(2),
      phase: { kind: 'atRisk', dueBy: day(2) },
    });
    expect(marks(after.periods)).toEqual([
      `kept ${day(-60)}`,
      `protected ${day(-18)} clientPause`,
    ]);
  });

  it('ticks through a client’s pause where the rule allows none', () => {
    expect(
      stateOf(DEFAULT, { visits, pauses: [away('clientPause')] }).phase,
    ).toMatchObject({ kind: 'broken', brokenAt: day(-10) });
  });

  it('always stops for the account’s pause: a pause freezes, it never zeroes', () => {
    const state = stateOf(DEFAULT, { visits, pauses: [away('pause')] });
    expect(state).toMatchObject({ current: 1, dueBy: day(2) });
    expect(marks(state.periods).at(-1)).toBe(`protected ${day(-18)} pause`);
    expect(
      stateOf(DEFAULT, { visits, pauses: [away('pause')] }, day(-11)).phase,
    ).toEqual({ kind: 'frozen', until: day(-11), reason: 'pause' });
  });

  it('stops for as many days a year as the allowance has left', () => {
    const ten = rule({ clientPause: { enabled: true, maxDaysPerYear: 10 } });
    // Ten of the twenty days: due on day −8, the grace out on day −1.
    expect(
      stateOf(ten, { visits, pauses: [away('clientPause')] }, day(-1)),
    ).toMatchObject({ dueBy: day(-8), phase: { kind: 'inGrace' } });
    expect(
      stateOf(ten, { visits, pauses: [away('clientPause')] }).phase,
    ).toMatchObject({ kind: 'broken', brokenAt: day(0) });
    // Six days in spring and six in autumn: four of the second are left.
    const twice = [
      away('clientPause', -200, -195),
      away('clientPause', -30, -25),
    ];
    const regular = visitsAt([-210, -180, -150, -120, -90, -60]);
    expect(
      stateOf(ten, { visits: regular, pauses: twice }, day(-10)),
    ).toMatchObject({
      current: 6,
      dueBy: day(-18 + 4),
      phase: { kind: 'inGrace', graceUntil: day(-18 + 4 + 7) },
    });
    // A year on, the allowance is whole again.
    const nextYear = [
      away('clientPause', -420, -411),
      away('clientPause', -30, -25),
    ];
    expect(
      stateOf(ten, { visits: regular, pauses: nextYear }, day(-10)).dueBy,
    ).toBe(day(-18 + 6));
  });

  it('starts too late once the period was missed', () => {
    expect(
      stateOf(pausing, { visits, pauses: [away('clientPause', -10, 10)] }).phase
        .kind,
    ).toBe('broken');
  });

  it('skips a pause that ends before it starts', () => {
    expect(
      stateOf(pausing, { visits, pauses: [away('clientPause', -11, -30)] })
        .phase.kind,
    ).toBe('broken');
  });
});

describe('projectStreak, after a miss (P11, P12)', () => {
  const gone = visitsAt([-300, -270, -240]);

  it('P11 off: nothing is restored, and no day reads as one that would', () => {
    const none = rule({ repair: NO_EARN_BACK });
    expect(stateOf(none, { visits: gone }).phase).toEqual({
      kind: 'broken',
      brokenAt: day(-190),
      repairableUntil: day(-191),
    });
    expect(
      stateOf(none, { visits: visitsAt([-300, -270, -240, -185]) }, day(-180))
        .current,
    ).toBe(1);
  });

  it('P11: the window is the rule’s', () => {
    const month = rule({
      repair: { enabled: true, windowDays: 30, perYear: 1 },
    });
    expect(stateOf(month, { visits: gone }).phase).toMatchObject({
      repairableUntil: day(-160),
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
      repair: { enabled: true, windowDays: 14, perYear: 2 },
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
      stateOf(
        DEFAULT,
        { visits: visitsAt([-300, -270, -240, -185]) },
        day(-132),
      ).phase,
    ).toEqual({
      kind: 'broken',
      brokenAt: day(-135),
      repairableUntil: day(-136),
    });
  });

  it('P12 hold: the miss is drawn and the count stays', () => {
    const holding = rule({ onBreak: 'hold' });
    const missed = traceStreak(holding, facts({ visits: gone }), TODAY);
    expect(missed.state).toMatchObject({
      current: 3,
      best: 3,
      dueBy: null,
      period: null,
      // Nothing was lost, so nothing is there to restore.
      phase: {
        kind: 'broken',
        brokenAt: day(-190),
        repairableUntil: day(-191),
      },
    });
    expect(marks(missed.state?.periods ?? []).at(-1)).toBe(
      `missed ${day(-198)}`,
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
      phase: { kind: 'active' },
    });
    expect(marks(back.state?.periods ?? []).slice(-3)).toEqual([
      `missed ${day(-198)}`,
      `kept ${day(-30)}`,
      `kept ${day(-5)}`,
    ]);
    // The run never started over: nobody came BACK.
    expect(back.comebacks).toEqual([]);
    expect(back.counts.map(({ current }) => current)).toEqual([1, 2, 3, 4, 5]);
  });

  it('P12 hold: a protection still covers the period first', () => {
    const state = stateOf(rule({ onBreak: 'hold' }), {
      visits: visitsAt([-400, -370, -340, -310, -280, -200]),
    });
    expect(marks(state.periods).slice(-3)).toEqual([
      `protected ${day(-238)} freeze`,
      `kept ${day(-200)}`,
      `missed ${day(-158)}`,
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
    const third = rule({ version: 3, effectiveFrom: '2026-09-01' });
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
      phase: { kind: 'broken' },
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
    const holding = rule({ onBreak: 'hold' });
    const gone = visitsAt([-300, -270, -240]);
    expect(stateOf(holding, { visits: gone })).toMatchObject({
      current: 3,
      phase: { kind: 'broken' },
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
          excused: [{ day: day(-165), reason: 'barberAbsence' }],
        },
        day(-115),
      ),
    ).toMatchObject({ current: 2, runStartedOn: day(-200) });
    expect(
      stateOf(
        DEFAULT,
        {
          visits: visitsAt([-200, -120]),
          pauses: [{ from: day(-180), until: day(-140), reason: 'pause' }],
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
  readonly of: (
    props: StreakDefinitionProps,
    by: number,
  ) => StreakDefinitionProps | null;
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

const shortestOf = ({ interval }: StreakDefinitionProps): number =>
  interval.kind === 'fixed' ? interval.days : interval.minDays;

/** The clock: what decides whether a period was kept. */
const CLOCK: readonly Loosening[] = [
  {
    name: 'a longer fixed interval',
    of: (p, by) =>
      p.interval.kind === 'fixed' && p.interval.days < 182
        ? {
            ...p,
            interval: {
              kind: 'fixed',
              days: between(p.interval.days + 1, 182, by),
            },
          }
        : null,
  },
  {
    name: 'a wider tolerance',
    of: (p, by) =>
      p.interval.kind === 'personal' && p.interval.tolerancePct < 100
        ? {
            ...p,
            interval: {
              ...p.interval,
              tolerancePct: between(p.interval.tolerancePct + 1, 100, by),
            },
          }
        : null,
  },
  {
    name: 'a higher floor',
    of: (p, by) =>
      p.interval.kind === 'personal' &&
      p.interval.minDays < p.interval.fallbackDays
        ? {
            ...p,
            interval: {
              ...p.interval,
              minDays: between(
                p.interval.minDays + 1,
                p.interval.fallbackDays,
                by,
              ),
            },
          }
        : null,
  },
  {
    name: 'a higher ceiling',
    of: (p, by) =>
      p.interval.kind === 'personal' && p.interval.maxDays < 182
        ? {
            ...p,
            interval: {
              ...p.interval,
              maxDays: between(p.interval.maxDays + 1, 182, by),
            },
          }
        : null,
  },
  {
    name: 'a longer default for newcomers',
    of: (p, by) =>
      p.interval.kind === 'personal' &&
      p.interval.fallbackDays < p.interval.maxDays
        ? {
            ...p,
            interval: {
              ...p.interval,
              fallbackDays: between(
                p.interval.fallbackDays + 1,
                p.interval.maxDays,
                by,
              ),
            },
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
      if (!p.bookingHold.enabled) {
        return { ...p, bookingHold: { ...p.bookingHold, enabled: true } };
      }
      return p.bookingHold.maxDaysPastDue < 28
        ? {
            ...p,
            bookingHold: {
              enabled: true,
              maxDaysPastDue: between(p.bookingHold.maxDaysPastDue + 1, 28, by),
            },
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
      if (!p.clientPause.enabled) {
        return { ...p, clientPause: { ...p.clientPause, enabled: true } };
      }
      return p.clientPause.maxDaysPerYear < 180
        ? {
            ...p,
            clientPause: {
              enabled: true,
              maxDaysPerYear: between(
                p.clientPause.maxDaysPerYear + 1,
                180,
                by,
              ),
            },
          }
        : null;
    },
  },
  {
    name: 'a miss that holds the count',
    of: (p) => (p.onBreak === 'restart' ? { ...p, onBreak: 'hold' } : null),
  },
];

/** The reserve and the earn-back: what softens a miss. */
const CUSHION: readonly Loosening[] = [
  {
    name: 'protections switched on',
    of: (p) =>
      p.protections.enabled
        ? null
        : { ...p, protections: { ...p.protections, enabled: true } },
  },
  {
    name: 'a larger reserve',
    of: (p, by) =>
      p.protections.enabled && p.protections.maxBanked < 5
        ? {
            ...p,
            protections: {
              ...p.protections,
              maxBanked: between(p.protections.maxBanked + 1, 5, by),
            },
          }
        : null,
  },
  {
    name: 'more protections to start with',
    of: (p, by) =>
      p.protections.enabled && p.protections.startWith < p.protections.maxBanked
        ? {
            ...p,
            protections: {
              ...p.protections,
              startWith: between(
                p.protections.startWith + 1,
                p.protections.maxBanked,
                by,
              ),
            },
          }
        : null,
  },
  {
    name: 'the earn-back switched on',
    of: (p) =>
      p.repair.enabled
        ? null
        : { ...p, repair: { ...p.repair, enabled: true } },
  },
  {
    name: 'a longer earn-back window',
    of: (p, by) =>
      p.repair.enabled && p.repair.windowDays < 60
        ? {
            ...p,
            repair: {
              ...p.repair,
              windowDays: between(p.repair.windowDays + 1, 60, by),
            },
          }
        : null,
  },
  {
    name: 'more earn-backs a year',
    of: (p, by) =>
      p.repair.enabled && p.repair.perYear < 4
        ? {
            ...p,
            repair: {
              ...p.repair,
              perYear: between(p.repair.perYear + 1, 4, by),
            },
          }
        : null,
  },
];

/** Any rule the editor can publish. */
const anyRule: fc.Arbitrary<StreakDefinitionProps> = fc
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
    onBreak: fc.constantFrom('restart' as const, 'hold' as const),
  })
  .map((drawn) => {
    const interval: StreakDefinitionProps['interval'] = drawn.personal
      ? {
          kind: 'personal',
          tolerancePct: drawn.tolerancePct,
          minDays: drawn.floor,
          maxDays: drawn.floor + drawn.span,
          fallbackDays: between(
            drawn.floor,
            drawn.floor + drawn.span,
            drawn.fallback,
          ),
        }
      : { kind: 'fixed', days: drawn.days };
    const under = (interval.kind === 'fixed' ? drawn.days : drawn.floor) - 1;
    return {
      ...StreakDefinition.default().toProps(),
      interval,
      graceDays: Math.min(drawn.graceDays, under),
      riskLeadDays: Math.min(drawn.riskLeadDays, under),
      minGapDays: Math.min(drawn.minGapDays, under),
      bookingHold: drawn.bookingHold,
      protections: {
        ...drawn.protections,
        startWith: Math.min(
          drawn.protections.startWith,
          drawn.protections.maxBanked,
        ),
      },
      excuses: drawn.excuses,
      clientPause: drawn.clientPause,
      repair: drawn.repair,
      onBreak: drawn.onBreak,
    };
  });

/** The clock alone: no reserve and no earn-back, so a miss is a miss. */
const plainClock = anyRule.map((props): StreakDefinitionProps => ({
  ...props,
  protections: { ...props.protections, enabled: false },
  repair: { ...props.repair, enabled: false },
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
            reason: fc.constantFrom('pause' as const, 'clientPause' as const),
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
          excused.push({ day: on(first + k), reason: 'closedDays' });
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

function made(props: StreakDefinitionProps): StreakDefinition {
  const result = StreakDefinition.create(props);
  if (result.isFailure()) throw new Error(JSON.stringify(result.error));
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
                  props.interval.kind === 'fixed',
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

  it('under any rule, a miss that holds the count never lowers it', () => {
    fc.assert(
      fc.property(anyRule, anyFacts, (props, { facts, today }) => {
        fc.pre(props.onBreak === 'restart');
        const before = projectStreak(made(props), facts, today);
        const after = projectStreak(
          made({ ...props, onBreak: 'hold' }),
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
          definition.protections.enabled ? definition.protections.maxBanked : 0,
        );
        expect(state.periods.length).toBeLessThanOrEqual(STREAK_PERIODS_KEPT);
        expect(state.periods.map(({ on }) => on)).toEqual(
          state.periods.map(({ on }) => on).sort(),
        );
        // No open period, no promise; an open one is promised a day.
        expect(state.dueBy === null).toBe(state.phase.kind === 'broken');
        expect(state.period === null).toBe(state.phase.kind === 'broken');
        if (state.heldBy !== null) {
          expect(state.heldBy.on >= today).toBe(true);
          expect(state.heldBy.appointmentId).not.toBe('');
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
            sofiaDayOf(state.lastQualifiedAt ?? new Date(0)),
        ).toBe(true);
        // A miss that holds the count never starts anybody over.
        if (props.onBreak === 'hold') {
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
      const week = rule({ protections: NO_PROTECTIONS });
      const fortnight = rule({ protections: NO_PROTECTIONS, graceDays: 14 });
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
          interval: { kind: 'fixed', days },
          graceDays: 4,
          protections: {
            enabled: true,
            maxBanked: 1,
            earnEvery: 24,
            startWith: 1,
          },
          repair: NO_EARN_BACK,
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
          protections: { enabled: true, maxBanked: 1, earnEvery, startWith: 0 },
          repair: NO_EARN_BACK,
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
