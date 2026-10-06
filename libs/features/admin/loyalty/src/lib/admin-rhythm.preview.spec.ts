import { describe, expect, it } from 'vitest';
import {
  type ClientStatsDirectory,
  type ClientStatsRecord,
  ZonedDateTime,
  clientStatsFromDocument,
} from '@creativo/application/booking';
import { InMemoryClientStatsDirectory } from '@creativo/application/booking/testing';
import {
  StreakDefinition,
  type StreakDefinitionProps,
} from '@creativo/application/engagement';
import { RepositoryError } from '@creativo/application/shared';
import {
  RHYTHM_PREVIEW_CAP,
  RHYTHM_PREVIEW_DELAY_MS,
  RHYTHM_PREVIEW_PAGES,
  RHYTHM_PREVIEW_PAGE_SIZE,
  RhythmPreviewSource,
  readRhythmPreviewFacts,
  rhythmPreviewOf,
  rhythmPreviewReadsFacts,
  sampleRhythmFacts,
  sampleRhythmRun,
  streakFactsOf,
} from './admin-rhythm.preview';

// ── The shop's day, and its clients ──────────────────────────────────────

/** Monday 28 September 2026 in Sofia: the fixtures' day. */
const TODAY = '2026-09-28';
const ZONE = 'Europe/Sofia';

/** Noon in Sofia, that many days before today, as the statistics hold an instant. */
function daysAgo(days: number): string {
  const noon = ZonedDateTime.fromISO(`${TODAY}T12:00:00`, ZONE);
  if (noon.isFailure()) throw noon.error;
  return new Date(noon.value.plusDays(-days).toMillis()).toISOString();
}

/** A client's statistics THROUGH THE WIRE'S OWN READER: a record the app could really hold. */
function statsOf(
  uid: string,
  visits: readonly string[] = [],
): ClientStatsRecord {
  const record = clientStatsFromDocument(uid, {
    userId: uid,
    lifetime: {
      visitsCompleted: visits.length,
      noShows: 0,
      lateCancels: 0,
      clientCancels: 0,
    },
    last365: {
      visitsCompleted: visits.map((at, index) => ({
        appointmentId: `appt-${uid}-${index}`,
        at,
      })),
      noShows: [],
      lateCancels: [],
    },
    firstVisitAt: visits[0] ?? null,
    lastVisit: null,
    nextVisit: null,
    avgCadenceDays: null,
    preferredBarberId: null,
    usualServiceIds: [],
    pauseSuggestion: null,
    version: 1,
    updatedAt: `${TODAY}T06:00:00.000Z`,
  });
  if (record === null) throw new Error(`the statistics of ${uid} do not parse`);
  return record;
}

/** `count` clients in the order the directory walks them, one visit each. */
function shopOf(count: number): ClientStatsRecord[] {
  return Array.from({ length: count }, (_, index) =>
    statsOf(`client-${String(index).padStart(5, '0')}`, [daysAgo(10)]),
  );
}

function ruleOf(patch: Partial<StreakDefinitionProps> = {}): StreakDefinition {
  const revised = StreakDefinition.default().revise(patch, '2026-09-29');
  if (revised.isFailure()) {
    throw new Error(
      `the rule was refused: ${revised.error.map((error) => error.code).join(', ')}`,
    );
  }
  return revised.value;
}

const marksOf = (rule: StreakDefinition): readonly string[] =>
  sampleRhythmRun(rule, TODAY)?.periods.map((period) => period.mark) ?? [];

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
        '2026-06-10T09:00:00.000Z',
        // 01:30 on the 28th in Sofia: the visit's day is the shop's, not UTC's.
        '2026-09-27T22:30:00.000Z',
      ]),
    );

    expect(facts.visits).toEqual([
      { day: '2026-06-10', counted: true },
      { day: '2026-09-28', counted: true },
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
    const directory = new InMemoryClientStatsDirectory(shopOf(3));

    const facts = await readRhythmPreviewFacts(directory);

    expect(facts.isSuccess() && facts.value.clients).toHaveLength(3);
    expect(facts.isSuccess() && facts.value.capped).toBe(false);
    expect(directory.calls).toEqual([{ limit: 200, after: null }]);
  });

  it('reads an empty shop as nobody', async () => {
    const facts = await readRhythmPreviewFacts(
      new InMemoryClientStatsDirectory(),
    );

    expect(facts.isSuccess() && facts.value).toEqual({
      clients: [],
      capped: false,
    });
  });

  it('walks page after page, each from where the last one stopped', async () => {
    const directory = new InMemoryClientStatsDirectory(shopOf(450));

    const facts = await readRhythmPreviewFacts(directory);

    expect(facts.isSuccess() && facts.value.clients).toHaveLength(450);
    expect(facts.isSuccess() && facts.value.capped).toBe(false);
    expect(directory.calls).toEqual([
      { limit: 200, after: null },
      { limit: 200, after: 'client-00199' },
      { limit: 200, after: 'client-00399' },
    ]);
  });

  it('reads exactly 1 000 clients whole', async () => {
    const directory = new InMemoryClientStatsDirectory(shopOf(1_000));

    const facts = await readRhythmPreviewFacts(directory);

    expect(facts.isSuccess() && facts.value.clients).toHaveLength(1_000);
    expect(facts.isSuccess() && facts.value.capped).toBe(false);
    expect(directory.calls).toHaveLength(5);
  });

  it('stops at the fifth page and says that clients are left', async () => {
    const directory = new InMemoryClientStatsDirectory(shopOf(1_001));

    const facts = await readRhythmPreviewFacts(directory);

    expect(facts.isSuccess() && facts.value.clients).toHaveLength(1_000);
    expect(facts.isSuccess() && facts.value.capped).toBe(true);
    expect(directory.calls).toHaveLength(5);
  });

  it('fails whole when a page fails: half a shop is a wrong number', async () => {
    const inner = new InMemoryClientStatsDirectory(shopOf(450));
    let pages = 0;
    const directory: ClientStatsDirectory = {
      page: (limit, after) => {
        pages += 1;
        if (pages === 2) inner.failWith(new RepositoryError('page two'));
        return inner.page(limit, after);
      },
    };

    const facts = await readRhythmPreviewFacts(directory);

    expect(facts.isFailure() && facts.error.message).toBe('page two');
    expect(pages).toBe(2);
  });

  it('answers a directory that throws as a failure', async () => {
    const directory: ClientStatsDirectory = {
      page: () => Promise.reject(new Error('the adapter did not load')),
    };

    const facts = await readRhythmPreviewFacts(directory);

    expect(facts.isFailure() && facts.error).toBeInstanceOf(RepositoryError);
  });
});

describe('RhythmPreviewSource', () => {
  it('walks once, however often it is asked', async () => {
    const directory = new InMemoryClientStatsDirectory(shopOf(450));
    const source = new RhythmPreviewSource(directory);

    const first = await source.read();
    const second = await source.read();

    expect(second).toBe(first);
    expect(directory.calls).toHaveLength(3);
  });

  it('answers two readers of one walk with the same facts', async () => {
    const directory = new InMemoryClientStatsDirectory(shopOf(3));
    const source = new RhythmPreviewSource(directory);

    const [first, second] = await Promise.all([source.read(), source.read()]);

    expect(second).toBe(first);
    expect(directory.calls).toHaveLength(1);
  });

  it('answers a walk that failed as it failed, until it is told to forget it', async () => {
    const directory = new InMemoryClientStatsDirectory(shopOf(3)).failWith();
    const source = new RhythmPreviewSource(directory);

    const failed = await source.read();
    directory.recover();
    const again = await source.read();

    expect(failed.isFailure()).toBe(true);
    expect(again).toBe(failed);
    expect(source.failed).toBe(true);
    expect(directory.calls).toHaveLength(1);

    source.forget();
    expect(source.failed).toBe(false);
    const read = await source.read();

    expect(read.isSuccess() && read.value.clients).toHaveLength(3);
    expect(source.failed).toBe(false);
    expect(directory.calls).toHaveLength(2);
  });

  it('has not failed before it has walked, nor while it walks', async () => {
    const directory = new InMemoryClientStatsDirectory(shopOf(3)).failWith();
    const source = new RhythmPreviewSource(directory);

    expect(source.failed).toBe(false);
    const walking = source.read();
    expect(source.failed).toBe(false);

    await walking;
    expect(source.failed).toBe(true);
  });

  it('is not failed by a walk it was told to forget', async () => {
    const directory = new InMemoryClientStatsDirectory(shopOf(3)).failWith();
    const source = new RhythmPreviewSource(directory);

    const forgotten = source.read();
    source.forget();
    directory.recover();
    const read = source.read();
    await forgotten;

    expect(source.failed).toBe(false);
    expect((await read).isSuccess()).toBe(true);
  });

  it('walks again after `forget()`, even over facts it had', async () => {
    const directory = new InMemoryClientStatsDirectory(shopOf(3));
    const source = new RhythmPreviewSource(directory);

    const first = await source.read();
    source.forget();
    const second = await source.read();

    expect(second).not.toBe(first);
    expect(second.isSuccess() && second.value.clients).toHaveLength(3);
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
    const listed = ruleOf({
      qualifier: { kind: 'services', serviceIds: ['svc-fade'] },
    });

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
      draft: ruleOf({ interval: { kind: 'fixed', days: 28 } }),
      facts,
      today: TODAY,
    });

    expect(preview).toEqual({
      kind: 'estimate',
      clients: 3,
      before: { inRhythm: 2, inGrace: 0, broken: 1 },
      after: { inRhythm: 1, inGrace: 0, broken: 2 },
      back: 0,
      out: 1,
    });
  });

  it('counts who comes back under a looser rule', () => {
    const preview = rhythmPreviewOf({
      inForce: ruleOf({ interval: { kind: 'fixed', days: 28 } }),
      draft: ruleOf(),
      facts,
      today: TODAY,
    });

    expect(preview).toMatchObject({ kind: 'estimate', back: 1, out: 0 });
  });

  it('judges nobody under a rule that is switched off', () => {
    const preview = rhythmPreviewOf({
      inForce: ruleOf(),
      draft: ruleOf({ enabled: false }),
      facts,
      today: TODAY,
    });

    expect(preview).toMatchObject({
      kind: 'estimate',
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
      draft: ruleOf({
        qualifier: { kind: 'services', serviceIds: ['svc-fade'] },
      }),
      facts,
      today: TODAY,
    });

    expect(preview).toEqual({ kind: 'unavailable', reason: 'qualifier' });
  });
});

describe('the sample run', () => {
  it('ends yesterday, seven visits long', () => {
    const { visits } = sampleRhythmFacts(ruleOf(), TODAY);

    expect(visits).toHaveLength(7);
    expect(visits.at(-1)).toEqual({ day: '2026-09-27', counted: true });
    expect(visits.every((visit) => visit.counted)).toBe(true);
  });

  it('comes on time six times, then misses one due date by a whole period', () => {
    const days = sampleRhythmFacts(ruleOf(), TODAY).visits.map(
      (visit) => visit.day,
    );
    const gaps = days
      .slice(1)
      .map(
        (day, index) =>
          (Date.parse(day) - Date.parse(days.at(index) ?? day)) / 86_400_000,
      );

    expect(gaps).toEqual([42, 42, 42, 42, 42, 84]);
  });

  it('shows the recommended rule covering the miss with a protection', () => {
    const run = sampleRhythmRun(ruleOf(), TODAY);

    // A mark per visit, and one for the due date nobody met.
    expect(marksOf(ruleOf())).toEqual([
      'kept',
      'kept',
      'kept',
      'kept',
      'kept',
      'kept',
      'protected',
      'kept',
    ]);
    expect(run?.periods.at(-2)).toEqual({
      mark: 'protected',
      on: '2026-08-16',
      reason: 'freeze',
    });
    expect(run?.phase.kind).toBe('active');
    expect(run?.current).toBe(7);
    expect(run?.best).toBe(7);
    expect(run?.freezesBanked).toBe(0);
    expect(run?.dueBy).toBe('2026-11-08');
  });

  it('ends on the track the rule card draws: three kept, the miss, a visit', () => {
    expect(marksOf(ruleOf()).slice(-5)).toEqual([
      'kept',
      'kept',
      'kept',
      'protected',
      'kept',
    ]);
  });

  it('shows the miss itself where nothing covers it, and the count starting over', () => {
    const bare = ruleOf({
      protections: { enabled: false, maxBanked: 2, earnEvery: 5, startWith: 0 },
    });
    const run = sampleRhythmRun(bare, TODAY);

    expect(marksOf(bare).slice(-5)).toEqual([
      'kept',
      'kept',
      'kept',
      'missed',
      'kept',
    ]);
    expect(run?.current).toBe(1);
    expect(run?.best).toBe(6);
  });

  it('keeps the count across the miss under a rule that holds it', () => {
    const holding = ruleOf({
      protections: { enabled: false, maxBanked: 2, earnEvery: 5, startWith: 0 },
      onBreak: 'hold',
    });

    expect(marksOf(holding)).toContain('missed');
    expect(sampleRhythmRun(holding, TODAY)?.current).toBe(7);
  });

  it('is on time under a personal interval too: only the one due date is missed', () => {
    const personal = ruleOf({
      interval: {
        kind: 'personal',
        tolerancePct: 50,
        minDays: 21,
        maxDays: 70,
        fallbackDays: 42,
      },
    });
    const marks = marksOf(personal);

    expect(marks.filter((mark) => mark !== 'kept')).toEqual(['protected']);
    expect(sampleRhythmRun(personal, TODAY)?.phase.kind).toBe('active');
  });

  it.each([14, 28, 42, 91, 182])(
    'misses exactly one due date under an interval of %i days',
    (days) => {
      const marks = marksOf(
        ruleOf({
          interval: { kind: 'fixed', days },
          graceDays: Math.min(7, days - 1),
          riskLeadDays: Math.min(7, days - 1),
          minGapDays: Math.min(7, days - 1),
        }),
      );

      expect(marks.filter((mark) => mark !== 'kept')).toEqual(['protected']);
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
