import { describe, expect, it } from 'vitest';
import type { ClientStatsPagePorts } from '@core/ports';
import {
  ClientStats,
  PolicyPassStamp,
  StreakIntervalRule,
  StreakOnBreak,
  StreakPeriodMark,
  StreakPhase,
  FreezeReason,
  StreakQualifierRule,
  StreakRule,
} from '@core/components';
import type { ClientStatsRecord } from '@core/entities';
import {
  AppointmentId,
  CustomerId,
  LocalDate,
  type MinuteOfDay,
  RepositoryError,
  RepositoryErrorCode,
  Result,
  ServiceId,
} from '@core/primitives';
import {
  StreakPreviewOutcome,
  StreakPreviewUnavailable,
  ZonedTimeSystem,
} from '@core/systems';
import {
  FIXTURE_TIME_ZONE,
  memoryClientStatsReadPorts,
  minute,
  unwrapOk,
  utcMs,
} from '@core/testing';
import {
  RHYTHM_PREVIEW_CAP,
  RHYTHM_PREVIEW_DELAY_MS,
  RHYTHM_PREVIEW_PAGES,
  RHYTHM_PREVIEW_PAGE_SIZE,
  RHYTHM_SHOP_ZONE,
  readRhythmPreviewFacts,
  rhythmPreviewOf,
  rhythmPreviewReadsFacts,
  rhythmPreviewSource,
  sampleRhythmFacts,
  sampleRhythmRun,
  streakFactsOf,
} from './admin-rhythm.preview';

// ── The shop's day, and its clients ──────────────────────────────────────

/** Monday 28 September 2026 in Sofia: the fixtures' day. */
const TODAY = '2026-09-28';

/** A visit on the shop's wall clock — the day and minute the statistics hold (Law 7.3). */
interface Reading {
  readonly localDate: LocalDate;
  readonly startMinutes: MinuteOfDay;
}

/** Noon in Sofia, that many days before today, as the statistics hold a visit. */
function daysAgo(days: number): Reading {
  return {
    localDate: LocalDate.addDays(unwrapOk(LocalDate.parse(TODAY)), -days),
    startMinutes: minute(12 * 60),
  };
}

/** An instant read ONCE in the shop's zone, the way the projector stores it. */
function instant(isoWithOffset: string): Reading {
  const wall = ZonedTimeSystem.toLocal(utcMs(isoWithOffset), FIXTURE_TIME_ZONE);
  return { localDate: wall.localDate, startMinutes: wall.minute };
}

/** A client's statistics as stored: `clientStats/{customerId}`, the flat body (Law 5). */
function statsOf(
  id: string,
  visits: readonly Reading[] = [],
): ClientStatsRecord {
  const customerId = CustomerId.of(id);
  const first = visits[0] ?? null;
  return {
    ...ClientStats.empty(),
    lifetimeVisitsCompleted: visits.length,
    last365VisitsCompleted: visits.map((visit, index) => ({
      appointmentId: AppointmentId.of(`appt-${id}-${index}`),
      localDate: visit.localDate,
      startMinutes: visit.startMinutes,
    })),
    firstVisitLocalDate: first?.localDate ?? null,
    firstVisitStartMinutes: first?.startMinutes ?? null,
    id: customerId,
    customerId,
    version: 1,
    updatedAtUtcMs: utcMs(`${TODAY}T06:00:00+00:00`),
    ...PolicyPassStamp.NONE,
  };
}

/**
 * `CLIENT_STATS_READ_PORTS.pageClientStats` over the in-memory reference
 * (`memoryClientStatsReadPorts`), each call kept (`{ limit, after }`) and a
 * failure switched on and off at will — a failing page is still a call.
 */
function statsReader(records: readonly ClientStatsRecord[] = []) {
  const memory = memoryClientStatsReadPorts({ stats: records });
  const calls: { readonly limit: number; readonly after: string | null }[] = [];
  let failure: RepositoryError | null = null;
  const reader = {
    calls,
    pageClientStats: (async (after, limit) => {
      calls.push({ limit, after });
      return failure === null
        ? memory.pageClientStats(after, limit)
        : Result.err(failure);
    }) satisfies ClientStatsPagePorts['pageClientStats'],
    failWith(error: RepositoryError = RepositoryError.unavailable()) {
      failure = error;
      return reader;
    },
    recover() {
      failure = null;
      return reader;
    },
  };
  return reader;
}

/** `count` clients in the order the directory walks them, one visit each. */
function shopOf(count: number): ClientStatsRecord[] {
  return Array.from({ length: count }, (_, index) =>
    statsOf(`client-${String(index).padStart(5, '0')}`, [daysAgo(10)]),
  );
}

/** A revision of the recommended rule: any option figure, the interval or the qualifier whole. */
type RulePatch = Partial<
  Omit<StreakRule.Options, 'version' | 'effectiveFromLocalDate'>
> & {
  readonly interval?: StreakIntervalRule;
  readonly qualifier?: StreakQualifierRule;
};

/** The recommended rule, revised from 29 September and parsed: the next version, as a publish makes it. */
function ruleOf(patch: RulePatch = {}): StreakRule {
  const { interval, qualifier, ...options } = patch;
  const revised = StreakRule.parse({
    ...StreakRule.DEFAULT,
    ...options,
    ...(interval ?? StreakIntervalRule.of(StreakRule.DEFAULT)),
    ...(qualifier ?? StreakQualifierRule.of(StreakRule.DEFAULT)),
    version: StreakRule.DEFAULT.version + 1,
    effectiveFromLocalDate: '2026-09-29',
  });
  if (!revised.ok) {
    throw new Error(
      `the rule was refused: ${revised.error.map((error) => error.errorCode).join(', ')}`,
    );
  }
  return revised.value;
}

const fade = (): StreakQualifierRule =>
  StreakQualifierRule.services([ServiceId.of('svc-fade')]);

/** The first instant of a Sofia day: what a statistic's visit is stamped with. */
const dayStart = (day: string): number =>
  ZonedTimeSystem.startOfLocalDay(
    unwrapOk(LocalDate.parse(day)),
    RHYTHM_SHOP_ZONE,
  );

const marksOf = (rule: StreakRule): readonly string[] =>
  sampleRhythmRun(rule, TODAY)?.periods.map(
    (period) => period.streakPeriodMark,
  ) ?? [];

describe('the preview’s figures', () => {
  it('walks five pages of 200, and recomputes 600 ms after the last change', () => {
    expect(RHYTHM_PREVIEW_PAGE_SIZE).toBe(200);
    expect(RHYTHM_PREVIEW_PAGES).toBe(5);
    expect(RHYTHM_PREVIEW_CAP).toBe(1_000);
    expect(RHYTHM_PREVIEW_DELAY_MS).toBe(600);
  });
});

describe('streakFactsOf', () => {
  it('counts every worked visit of the last year, on its day in Sofia', () => {
    const facts = streakFactsOf(
      statsOf('client-1', [
        instant('2026-06-10T09:00:00+00:00'),
        // 01:30 on the 28th in Sofia: the visit's day is the shop's, not UTC's.
        instant('2026-09-27T22:30:00+00:00'),
      ]),
    );

    expect(facts.visits).toEqual([
      {
        localDate: '2026-06-10',
        counted: true,
        utcEpochMs: dayStart('2026-06-10'),
      },
      {
        localDate: '2026-09-28',
        counted: true,
        utcEpochMs: dayStart('2026-09-28'),
      },
    ]);
  });

  it('knows nothing the statistics do not hold', () => {
    const facts = streakFactsOf(statsOf('client-1', [daysAgo(3)]));

    expect(facts.excused).toEqual([]);
    expect(facts.bookings).toEqual([]);
    expect(facts.pauses).toEqual([]);
    expect(facts.grants).toEqual([]);
  });

  it('hands a client who never came no visit', () => {
    expect(streakFactsOf(statsOf('client-1')).visits).toEqual([]);
  });
});

describe('readRhythmPreviewFacts', () => {
  it('reads a small shop in one page', async () => {
    const directory = statsReader(shopOf(3));

    const facts = await readRhythmPreviewFacts(directory);

    expect(facts.ok && facts.value.clients).toHaveLength(3);
    expect(facts.ok && facts.value.capped).toBe(false);
    expect(directory.calls).toEqual([{ limit: 200, after: null }]);
  });

  it('reads an empty shop as nobody', async () => {
    const facts = await readRhythmPreviewFacts(statsReader());

    expect(facts.ok && facts.value).toEqual({
      clients: [],
      capped: false,
    });
  });

  it('walks page after page, each from where the last one stopped', async () => {
    const directory = statsReader(shopOf(450));

    const facts = await readRhythmPreviewFacts(directory);

    expect(facts.ok && facts.value.clients).toHaveLength(450);
    expect(facts.ok && facts.value.capped).toBe(false);
    expect(directory.calls).toEqual([
      { limit: 200, after: null },
      { limit: 200, after: 'client-00199' },
      { limit: 200, after: 'client-00399' },
    ]);
  });

  it('reads exactly 1 000 clients whole', async () => {
    const directory = statsReader(shopOf(1_000));

    const facts = await readRhythmPreviewFacts(directory);

    expect(facts.ok && facts.value.clients).toHaveLength(1_000);
    expect(facts.ok && facts.value.capped).toBe(false);
    expect(directory.calls).toHaveLength(5);
  });

  it('stops at the fifth page and says that clients are left', async () => {
    const directory = statsReader(shopOf(1_001));

    const facts = await readRhythmPreviewFacts(directory);

    expect(facts.ok && facts.value.clients).toHaveLength(1_000);
    expect(facts.ok && facts.value.capped).toBe(true);
    expect(directory.calls).toHaveLength(5);
  });

  it('fails whole when a page fails: half a shop is a wrong number', async () => {
    const inner = statsReader(shopOf(450));
    const pageTwo = RepositoryError.readFailed('clientStats', 'page two');
    let pages = 0;
    const directory: ClientStatsPagePorts = {
      pageClientStats: (after, limit) => {
        pages += 1;
        if (pages === 2) inner.failWith(pageTwo);
        return inner.pageClientStats(after, limit);
      },
    };

    const facts = await readRhythmPreviewFacts(directory);

    expect(!facts.ok && facts.error).toEqual(pageTwo);
    expect(pages).toBe(2);
  });

  it('answers a directory that throws as a failure', async () => {
    const directory: ClientStatsPagePorts = {
      pageClientStats: () =>
        Promise.reject(new Error('the adapter did not load')),
    };

    const facts = await readRhythmPreviewFacts(directory);

    expect(!facts.ok && facts.error.errorCode).toBe(
      RepositoryErrorCode.ReadFailed,
    );
  });
});

describe('RhythmPreviewSource', () => {
  it('walks once, however often it is asked', async () => {
    const directory = statsReader(shopOf(450));
    const source = rhythmPreviewSource(directory);

    const first = await source.read();
    const second = await source.read();

    expect(second).toBe(first);
    expect(directory.calls).toHaveLength(3);
  });

  it('answers two readers of one walk with the same facts', async () => {
    const directory = statsReader(shopOf(3));
    const source = rhythmPreviewSource(directory);

    const [first, second] = await Promise.all([source.read(), source.read()]);

    expect(second).toBe(first);
    expect(directory.calls).toHaveLength(1);
  });

  it('answers a walk that failed as it failed, until it is told to forget it', async () => {
    const directory = statsReader(shopOf(3)).failWith();
    const source = rhythmPreviewSource(directory);

    const failed = await source.read();
    directory.recover();
    const again = await source.read();

    expect(failed.ok).toBe(false);
    expect(again).toBe(failed);
    expect(source.failed()).toBe(true);
    expect(directory.calls).toHaveLength(1);

    source.forget();
    expect(source.failed()).toBe(false);
    const read = await source.read();

    expect(read.ok && read.value.clients).toHaveLength(3);
    expect(source.failed()).toBe(false);
    expect(directory.calls).toHaveLength(2);
  });

  it('has not failed before it has walked, nor while it walks', async () => {
    const directory = statsReader(shopOf(3)).failWith();
    const source = rhythmPreviewSource(directory);

    expect(source.failed()).toBe(false);
    const walking = source.read();
    expect(source.failed()).toBe(false);

    await walking;
    expect(source.failed()).toBe(true);
  });

  it('is not failed by a walk it was told to forget', async () => {
    const directory = statsReader(shopOf(3)).failWith();
    const source = rhythmPreviewSource(directory);

    const forgotten = source.read();
    source.forget();
    directory.recover();
    const read = source.read();
    await forgotten;

    expect(source.failed()).toBe(false);
    expect((await read).ok).toBe(true);
  });

  it('walks again after `forget()`, even over facts it had', async () => {
    const directory = statsReader(shopOf(3));
    const source = rhythmPreviewSource(directory);

    const first = await source.read();
    source.forget();
    const second = await source.read();

    expect(second).not.toBe(first);
    expect(second.ok && second.value.clients).toHaveLength(3);
    expect(directory.calls).toHaveLength(2);
  });
});

describe('rhythmPreviewReadsFacts', () => {
  it('reads the statistics while both rules count every visit', () => {
    expect(rhythmPreviewReadsFacts(ruleOf(), ruleOf({ graceDays: 10 }))).toBe(
      true,
    );
  });

  it('reads nothing when either rule counts by a list', () => {
    const listed = ruleOf({ qualifier: fade() });

    expect(rhythmPreviewReadsFacts(ruleOf(), listed)).toBe(false);
    expect(rhythmPreviewReadsFacts(listed, ruleOf())).toBe(false);
  });
});

describe('rhythmPreviewOf', () => {
  // Four people under «на всеки 6 седмици» and under «на всеки 4 седмици»:
  // one who comes every four weeks, one who came six weeks apart and is
  // due in two days, one who came once long ago, one who never came.
  const steady = statsOf('client-steady', [
    daysAgo(94),
    daysAgo(66),
    daysAgo(38),
    daysAgo(10),
  ]);
  const sixWeeks = statsOf('client-six-weeks', [daysAgo(82), daysAgo(40)]);
  const gone = statsOf('client-gone', [daysAgo(200)]);
  const never = statsOf('client-never');
  const facts = {
    clients: [steady, sixWeeks, gone, never].map(streakFactsOf),
    capped: false,
  };

  it('counts everybody with a visit under both rules, through the projector', () => {
    const preview = rhythmPreviewOf({
      inForce: ruleOf(),
      draft: ruleOf({ interval: StreakIntervalRule.fixed(28) }),
      facts,
      today: TODAY,
    });

    expect(preview).toEqual({
      streakPreviewOutcome: StreakPreviewOutcome.Estimate,
      clients: 3,
      before: { inRhythm: 2, inGrace: 0, broken: 1 },
      after: { inRhythm: 1, inGrace: 0, broken: 2 },
      back: 0,
      out: 1,
    });
  });

  it('counts who comes back under a looser rule', () => {
    const preview = rhythmPreviewOf({
      inForce: ruleOf({ interval: StreakIntervalRule.fixed(28) }),
      draft: ruleOf(),
      facts,
      today: TODAY,
    });

    expect(preview).toMatchObject({
      streakPreviewOutcome: StreakPreviewOutcome.Estimate,
      back: 1,
      out: 0,
    });
  });

  it('judges nobody under a rule that is switched off', () => {
    const preview = rhythmPreviewOf({
      inForce: ruleOf(),
      draft: ruleOf({ enabled: false }),
      facts,
      today: TODAY,
    });

    expect(preview).toMatchObject({
      streakPreviewOutcome: StreakPreviewOutcome.Estimate,
      clients: 3,
      before: { inRhythm: 2, inGrace: 0, broken: 1 },
      after: null,
      back: 0,
      out: 0,
    });
  });

  it('is unavailable for a rule that counts chosen services', () => {
    const preview = rhythmPreviewOf({
      inForce: ruleOf(),
      draft: ruleOf({ qualifier: fade() }),
      facts,
      today: TODAY,
    });

    expect(preview).toEqual({
      streakPreviewOutcome: StreakPreviewOutcome.Unavailable,
      reason: StreakPreviewUnavailable.Qualifier,
    });
  });
});

describe('the sample run', () => {
  it('ends yesterday, seven visits long', () => {
    const { visits } = sampleRhythmFacts(ruleOf(), TODAY);

    expect(visits).toHaveLength(7);
    expect(visits.at(-1)).toEqual({
      localDate: '2026-09-27',
      counted: true,
      utcEpochMs: dayStart('2026-09-27'),
    });
    expect(visits.every((visit) => visit.counted)).toBe(true);
  });

  it('comes on time six times, then misses one due date by a whole period', () => {
    const days = sampleRhythmFacts(ruleOf(), TODAY).visits.map(
      (visit) => visit.localDate,
    );
    const gaps = days
      .slice(1)
      .map((day, index) => LocalDate.daysBetween(days.at(index) ?? day, day));

    expect(gaps).toEqual([42, 42, 42, 42, 42, 84]);
  });

  it('shows the recommended rule covering the miss with a protection', () => {
    const run = sampleRhythmRun(ruleOf(), TODAY);

    // A mark per visit, and one for the due date nobody met.
    expect(marksOf(ruleOf())).toEqual([
      StreakPeriodMark.Kept,
      StreakPeriodMark.Kept,
      StreakPeriodMark.Kept,
      StreakPeriodMark.Kept,
      StreakPeriodMark.Kept,
      StreakPeriodMark.Kept,
      StreakPeriodMark.Protected,
      StreakPeriodMark.Kept,
    ]);
    expect(run?.periods.at(-2)).toEqual({
      streakPeriodMark: StreakPeriodMark.Protected,
      on: '2026-08-16',
      periodReason: FreezeReason.Freeze,
    });
    expect(run?.streakPhase).toBe(StreakPhase.Active);
    expect(run?.current).toBe(7);
    expect(run?.best).toBe(7);
    expect(run?.freezesBanked).toBe(0);
    expect(run?.dueBy).toBe('2026-11-08');
  });

  it('ends on the track the rule card draws: three kept, the miss, a visit', () => {
    expect(marksOf(ruleOf()).slice(-5)).toEqual([
      StreakPeriodMark.Kept,
      StreakPeriodMark.Kept,
      StreakPeriodMark.Kept,
      StreakPeriodMark.Protected,
      StreakPeriodMark.Kept,
    ]);
  });

  it('shows the miss itself where nothing covers it, and the count starting over', () => {
    const bare = ruleOf({
      protectionsEnabled: false,
      protectionsMaxBanked: 2,
      protectionsEarnEvery: 5,
      protectionsStartWith: 0,
    });
    const run = sampleRhythmRun(bare, TODAY);

    expect(marksOf(bare).slice(-5)).toEqual([
      StreakPeriodMark.Kept,
      StreakPeriodMark.Kept,
      StreakPeriodMark.Kept,
      StreakPeriodMark.Missed,
      StreakPeriodMark.Kept,
    ]);
    expect(run?.current).toBe(1);
    expect(run?.best).toBe(6);
  });

  it('keeps the count across the miss under a rule that holds it', () => {
    const holding = ruleOf({
      protectionsEnabled: false,
      protectionsMaxBanked: 2,
      protectionsEarnEvery: 5,
      protectionsStartWith: 0,
      onBreak: StreakOnBreak.Hold,
    });

    expect(marksOf(holding)).toContain(StreakPeriodMark.Missed);
    expect(sampleRhythmRun(holding, TODAY)?.current).toBe(7);
  });

  it('is on time under a personal interval too: only the one due date is missed', () => {
    const personal = ruleOf({
      interval: StreakIntervalRule.personal(50, 21, 70, 42),
    });
    const marks = marksOf(personal);

    expect(marks.filter((mark) => mark !== StreakPeriodMark.Kept)).toEqual([
      StreakPeriodMark.Protected,
    ]);
    expect(sampleRhythmRun(personal, TODAY)?.streakPhase).toBe(
      StreakPhase.Active,
    );
  });

  it.each([14, 28, 42, 91, 182])(
    'misses exactly one due date under an interval of %i days',
    (days) => {
      const marks = marksOf(
        ruleOf({
          interval: StreakIntervalRule.fixed(days),
          graceDays: Math.min(7, days - 1),
          riskLeadDays: Math.min(7, days - 1),
          minGapDays: Math.min(7, days - 1),
        }),
      );

      expect(marks.filter((mark) => mark !== StreakPeriodMark.Kept)).toEqual([
        StreakPeriodMark.Protected,
      ]);
    },
  );

  it('draws nothing under a rule that is off', () => {
    expect(sampleRhythmRun(ruleOf({ enabled: false }), TODAY)).toBeNull();
  });

  it('draws nothing on a day that is no day', () => {
    expect(sampleRhythmFacts(ruleOf(), 'someday').visits).toEqual([]);
    expect(sampleRhythmRun(ruleOf(), 'someday')).toBeNull();
  });
});
