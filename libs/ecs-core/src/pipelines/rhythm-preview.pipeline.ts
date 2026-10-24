import type { ClientStatsRecord } from '@core/entities';
import type { ClientStatsPage, ClientStatsPagePorts } from '@core/ports';
import {
  type CustomerId,
  type LocalDate,
  Result,
  type TimeZone,
  type UtcEpochMs,
} from '@core/primitives';
import { RepositoryError } from '@core/errors';
import {
  type StreakFacts,
  StreakPreviewSystem,
  ZonedTimeSystem,
} from '@core/systems';

/*
 * «КАКВО ЩЕ СЕ ПРОМЕНИ», THE FACTS (client-card revision 3 §2.6.4, §4.4) —
 * the browser read of the admin rhythm page's preview, moved out of the
 * feature (Law 8.4). The preview is an ESTIMATE made in the browser: every
 * client's visits of the last year folded through the projector twice, once
 * per rule (`StreakPreviewSystem.estimate`). What is this file's: where the
 * facts come from (`clientStats`, walked a page at a time), how far the walk
 * goes, the shop day's first instant placed ONCE per day on the shop's zone
 * (the ingestion boundary, `ZonedTimeSystem`), and that the walk is made
 * ONCE per visit to the page, so a recompute reads nothing. What counts as
 * a visit fact is the system's (`StreakPreviewSystem.factsOfStats`).
 */

/** A page of the walk, and how many pages it may take: five of 200. */
export const RHYTHM_PREVIEW_PAGE_SIZE = 200;
export const RHYTHM_PREVIEW_PAGES = 5;
/** «от първите 1 000 клиенти»: where the walk stops. */
export const RHYTHM_PREVIEW_CAP =
  RHYTHM_PREVIEW_PAGE_SIZE * RHYTHM_PREVIEW_PAGES;

/** The statistics the walk reads — the bundle `CLIENT_STATS_READ_PORTS` carries (Law 9). */
export type RhythmPreviewPorts = ClientStatsPagePorts;

/** What the walk read. */
export type RhythmPreviewFacts = {
  /** One person's facts each, in the order of the walk. */
  readonly clients: readonly StreakFacts[];
  /** The walk stopped at its last page with clients left: the card says so. */
  readonly capped: boolean;
};

/**
 * The facts, read once and kept: a record of closures over ONE walk. The
 * first `read(zone)` starts the walk on the shop's zone; every later one
 * answers what it read (or is still reading), a walk that failed included:
 * a failure is an answer, and asking it again by itself would read the
 * shop twice behind one notice. «Опитай пак» is `forget()`, then `read()`.
 */
export type RhythmPreviewSource = {
  readonly read: (
    zone: TimeZone,
  ) => Promise<Result<RhythmPreviewFacts, RepositoryError>>;
  /** The next `read()` walks again. */
  readonly forget: () => void;
  /** The walk was made and failed: there is nothing to wait for until `forget()`. */
  readonly failed: () => boolean;
};

/**
 * Clients' statistics as the projector's facts, through ONE reader per
 * walk (`StreakPreviewSystem.factsOfStats`): it places the first instant
 * of each shop day once on the shop's `zone` (a statistic holds a visit's
 * day and minute, never its instant, so the visit is stamped with the first
 * instant of its shop day — flatten-spec T3), however many people the walk
 * reads.
 */
export function streakFactsReader(
  zone: TimeZone,
): (record: ClientStatsRecord) => StreakFacts {
  const dayStarts = new Map<LocalDate, UtcEpochMs>();
  const dayStart = (day: LocalDate): UtcEpochMs => {
    let start = dayStarts.get(day);
    if (start === undefined) {
      start = ZonedTimeSystem.startOfLocalDay(day, zone);
      dayStarts.set(day, start);
    }
    return start;
  };
  return (record) => StreakPreviewSystem.factsOfStats(record, dayStart);
}

/**
 * The walk: `clientStats` in the order of its ids (client records, D29), a
 * page after a page, until nobody is left or the fifth page is read. A page
 * that fails fails the walk: a preview over half the shop would be a wrong
 * number, not an estimate. A directory that throws is a failed read. The
 * days are placed on the shop's `zone`.
 */
export async function readRhythmPreviewFacts(
  stats: RhythmPreviewPorts,
  zone: TimeZone,
): Promise<Result<RhythmPreviewFacts, RepositoryError>> {
  const factsOf = streakFactsReader(zone);
  const clients: StreakFacts[] = [];
  let after: CustomerId | null = null;
  for (let page = 0; page < RHYTHM_PREVIEW_PAGES; page += 1) {
    let read: Result<ClientStatsPage, RepositoryError>;
    try {
      read = await stats.pageClientStats(after, RHYTHM_PREVIEW_PAGE_SIZE);
    } catch {
      return Result.err(RepositoryError.readFailed(null, 'threw'));
    }
    if (!read.ok) return read;
    for (const record of read.value.records) {
      clients.push(factsOf(record));
    }
    after = read.value.nextAfterCustomerId;
    if (after === null) return Result.ok({ clients, capped: false });
  }
  return Result.ok({ clients, capped: true });
}

/**
 * The walk made once per visit to the page ({@link RhythmPreviewSource}):
 * two readers of one walk get the same answer; a walk forgotten while it
 * was out says nothing of the one after it.
 */
export function rhythmPreviewSource(
  stats: RhythmPreviewPorts,
): RhythmPreviewSource {
  let walk: Promise<Result<RhythmPreviewFacts, RepositoryError>> | null = null;
  let walkFailed = false;
  const read = (
    zone: TimeZone,
  ): Promise<Result<RhythmPreviewFacts, RepositoryError>> => {
    if (walk !== null) return walk;
    const started = readRhythmPreviewFacts(stats, zone).then((facts) => {
      // A walk that was forgotten meanwhile says nothing of the one after it.
      if (walk === started) walkFailed = !facts.ok;
      return facts;
    });
    walk = started;
    return started;
  };
  return {
    read,
    forget: () => {
      walk = null;
      walkFailed = false;
    },
    failed: () => walkFailed,
  };
}
