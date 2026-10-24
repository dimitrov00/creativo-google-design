import { describe, expect, it } from 'vitest';
import type { ClientStatsPagePorts } from '@core/ports';
import { ClientStats, PolicyPassStamp } from '@core/components';
import type { ClientStatsRecord } from '@core/entities';
import {
  AppointmentId,
  CustomerId,
  LocalDate,
  type MinuteOfDay,
  Result,
} from '@core/primitives';
import { RepositoryError, RepositoryErrorCode } from '@core/errors';
import { StreakPreviewSystem, ZonedTimeSystem } from '@core/systems';
import {
  FIXTURE_TIME_ZONE,
  localDate,
  memoryClientStatsReadPorts,
  minute,
  utcMs,
} from '@core/testing';
import {
  RHYTHM_PREVIEW_CAP,
  RHYTHM_PREVIEW_PAGES,
  RHYTHM_PREVIEW_PAGE_SIZE,
  readRhythmPreviewFacts,
  rhythmPreviewSource,
  streakFactsReader,
} from './rhythm-preview.pipeline';

/*
 * The admin rhythm page's preview read, moved out of
 * `admin-rhythm.preview.ts` (Law 8.4) with its spec's cases
 * (`admin-rhythm.preview.spec.ts`: the figures, `streakFactsReader`,
 * `readRhythmPreviewFacts`, `RhythmPreviewSource` — the `walk === started`
 * race included), case for case.
 */

/** Monday 28 September 2026 in Sofia: the fixtures' day. */
const TODAY = localDate('2026-09-28');

/** A visit on the shop's wall clock — the day and minute the statistics hold (Law 7.3). */
interface Reading {
  readonly localDate: LocalDate;
  readonly startMinutes: MinuteOfDay;
}

/** Noon in Sofia, that many days before today, as the statistics hold a visit. */
function daysAgo(days: number): Reading {
  return {
    localDate: LocalDate.addDays(TODAY, -days),
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
    updatedAtUtcMs: utcMs('2026-09-28T06:00:00+00:00'),
    ...PolicyPassStamp.NONE,
  };
}

/**
 * `pageClientStats` over the in-memory reference
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

/** The first instant of a Sofia day: what a statistic's visit is stamped with. */
const dayStart = (day: string) =>
  ZonedTimeSystem.startOfLocalDay(localDate(day), FIXTURE_TIME_ZONE);

describe('the preview walk’s figures', () => {
  it('walks five pages of 200: the first 1 000 clients', () => {
    expect(RHYTHM_PREVIEW_PAGE_SIZE).toBe(200);
    expect(RHYTHM_PREVIEW_PAGES).toBe(5);
    expect(RHYTHM_PREVIEW_CAP).toBe(1_000);
  });
});

describe('streakFactsReader', () => {
  const factsOf = streakFactsReader(FIXTURE_TIME_ZONE);

  it('counts every worked visit of the last year, on its day in Sofia', () => {
    const facts = factsOf(
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
    const facts = factsOf(statsOf('client-1', [daysAgo(3)]));

    expect(facts.excused).toEqual([]);
    expect(facts.bookings).toEqual([]);
    expect(facts.pauses).toEqual([]);
    expect(facts.grants).toEqual([]);
  });

  it('hands a client who never came no visit', () => {
    expect(factsOf(statsOf('client-1')).visits).toEqual([]);
  });

  it('is the system’s reading of a statistic, on the shop’s day starts', () => {
    const record = statsOf('client-1', [daysAgo(40), daysAgo(3)]);
    expect(factsOf(record)).toEqual(
      StreakPreviewSystem.factsOfStats(record, (day) =>
        ZonedTimeSystem.startOfLocalDay(day, FIXTURE_TIME_ZONE),
      ),
    );
  });
});

describe('readRhythmPreviewFacts', () => {
  it('reads a small shop in one page', async () => {
    const directory = statsReader(shopOf(3));

    const facts = await readRhythmPreviewFacts(directory, FIXTURE_TIME_ZONE);

    expect(facts.ok && facts.value.clients).toHaveLength(3);
    expect(facts.ok && facts.value.capped).toBe(false);
    expect(directory.calls).toEqual([{ limit: 200, after: null }]);
  });

  it('reads an empty shop as nobody', async () => {
    const facts = await readRhythmPreviewFacts(
      statsReader(),
      FIXTURE_TIME_ZONE,
    );

    expect(facts.ok && facts.value).toEqual({
      clients: [],
      capped: false,
    });
  });

  it('walks page after page, each from where the last one stopped', async () => {
    const directory = statsReader(shopOf(450));

    const facts = await readRhythmPreviewFacts(directory, FIXTURE_TIME_ZONE);

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

    const facts = await readRhythmPreviewFacts(directory, FIXTURE_TIME_ZONE);

    expect(facts.ok && facts.value.clients).toHaveLength(1_000);
    expect(facts.ok && facts.value.capped).toBe(false);
    expect(directory.calls).toHaveLength(5);
  });

  it('stops at the fifth page and says that clients are left', async () => {
    const directory = statsReader(shopOf(1_001));

    const facts = await readRhythmPreviewFacts(directory, FIXTURE_TIME_ZONE);

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

    const facts = await readRhythmPreviewFacts(directory, FIXTURE_TIME_ZONE);

    expect(!facts.ok && facts.error).toEqual(pageTwo);
    expect(pages).toBe(2);
  });

  it('answers a directory that throws as a failure', async () => {
    const directory: ClientStatsPagePorts = {
      pageClientStats: () =>
        Promise.reject(new Error('the adapter did not load')),
    };

    const facts = await readRhythmPreviewFacts(directory, FIXTURE_TIME_ZONE);

    expect(!facts.ok && facts.error.errorCode).toBe(
      RepositoryErrorCode.ReadFailed,
    );
  });
});

describe('RhythmPreviewSource', () => {
  it('walks once, however often it is asked', async () => {
    const directory = statsReader(shopOf(450));
    const source = rhythmPreviewSource(directory);

    const first = await source.read(FIXTURE_TIME_ZONE);
    const second = await source.read(FIXTURE_TIME_ZONE);

    expect(second).toBe(first);
    expect(directory.calls).toHaveLength(3);
  });

  it('answers two readers of one walk with the same facts', async () => {
    const directory = statsReader(shopOf(3));
    const source = rhythmPreviewSource(directory);

    const [first, second] = await Promise.all([
      source.read(FIXTURE_TIME_ZONE),
      source.read(FIXTURE_TIME_ZONE),
    ]);

    expect(second).toBe(first);
    expect(directory.calls).toHaveLength(1);
  });

  it('answers a walk that failed as it failed, until it is told to forget it', async () => {
    const directory = statsReader(shopOf(3)).failWith();
    const source = rhythmPreviewSource(directory);

    const failed = await source.read(FIXTURE_TIME_ZONE);
    directory.recover();
    const again = await source.read(FIXTURE_TIME_ZONE);

    expect(failed.ok).toBe(false);
    expect(again).toBe(failed);
    expect(source.failed()).toBe(true);
    expect(directory.calls).toHaveLength(1);

    source.forget();
    expect(source.failed()).toBe(false);
    const read = await source.read(FIXTURE_TIME_ZONE);

    expect(read.ok && read.value.clients).toHaveLength(3);
    expect(source.failed()).toBe(false);
    expect(directory.calls).toHaveLength(2);
  });

  it('has not failed before it has walked, nor while it walks', async () => {
    const directory = statsReader(shopOf(3)).failWith();
    const source = rhythmPreviewSource(directory);

    expect(source.failed()).toBe(false);
    const walking = source.read(FIXTURE_TIME_ZONE);
    expect(source.failed()).toBe(false);

    await walking;
    expect(source.failed()).toBe(true);
  });

  it('is not failed by a walk it was told to forget', async () => {
    const directory = statsReader(shopOf(3)).failWith();
    const source = rhythmPreviewSource(directory);

    const forgotten = source.read(FIXTURE_TIME_ZONE);
    source.forget();
    directory.recover();
    const read = source.read(FIXTURE_TIME_ZONE);
    await forgotten;

    expect(source.failed()).toBe(false);
    expect((await read).ok).toBe(true);
  });

  it('walks again after `forget()`, even over facts it had', async () => {
    const directory = statsReader(shopOf(3));
    const source = rhythmPreviewSource(directory);

    const first = await source.read(FIXTURE_TIME_ZONE);
    source.forget();
    const second = await source.read(FIXTURE_TIME_ZONE);

    expect(second).not.toBe(first);
    expect(second.ok && second.value.clients).toHaveLength(3);
    expect(directory.calls).toHaveLength(2);
  });
});
