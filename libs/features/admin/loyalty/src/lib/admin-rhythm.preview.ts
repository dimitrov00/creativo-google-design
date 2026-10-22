import type { ClientStatsRecord } from '@core/entities';
import type { ClientStatsPagePorts } from '@core/ports';
import {
  type CustomerId,
  LocalDate,
  RepositoryError,
  Result,
  type TimeZone,
  type UtcEpochMs,
  defect,
} from '@core/primitives';
import {
  StreakIntervalRule,
  StreakQualifier,
  StreakRule,
  type StreakState,
} from '@core/components';
import {
  type StreakFacts,
  type StreakPreview,
  StreakPreviewSystem,
  StreakSystem,
  type StreakVisitFact,
  ZonedTimeSystem,
} from '@core/systems';

/*
 * «КАКВО ЩЕ СЕ ПРОМЕНИ», THE FACTS (client-card revision 3 §2.6.4, §4.4).
 *
 * The preview is an ESTIMATE made in the browser: every client's visits of
 * the last year folded through the projector twice, once per rule. The
 * fold is `StreakPreviewSystem.estimate` (`@core/systems`, pure). What is
 * this file's: where the facts come from (`clientStats`, walked a page at a
 * time), how far the walk goes, and that it is made ONCE per visit to the
 * page, so a recompute reads nothing.
 *
 * Beside it, the rule card's sample run: one invented client under the
 * draft, through the same projector (`StreakSystem.project`), so the track
 * on the card is what the rule really does and never a drawing of it.
 */

/** The shop's zone: the day a statistic's visit began in, and the day a version was published on. */
export const RHYTHM_SHOP_ZONE: TimeZone = (() => {
  const zone = ZonedTimeSystem.checkZone('Europe/Sofia');
  // Unreachable: a constant IANA name.
  return zone.ok ? zone.value : defect('Europe/Sofia is no zone');
})();

/** A page of the walk, and how many pages it may take: five of 200. */
export const RHYTHM_PREVIEW_PAGE_SIZE = 200;
export const RHYTHM_PREVIEW_PAGES = 5;
/** «от първите 1 000 клиенти»: where the walk stops. */
export const RHYTHM_PREVIEW_CAP =
  RHYTHM_PREVIEW_PAGE_SIZE * RHYTHM_PREVIEW_PAGES;
/** The preview recomputes by itself this long after the last change. */
export const RHYTHM_PREVIEW_DELAY_MS = 600;

/** What the walk read. */
export interface RhythmPreviewFacts {
  /** One person's facts each, in the order of the walk. */
  readonly clients: readonly StreakFacts[];
  /** The walk stopped at its last page with clients left: the card says so. */
  readonly capped: boolean;
}

/** A fold of nothing: no visit, no excuse, no booking, no pause, no grant. */
const NO_FACTS: StreakFacts = {
  visits: [],
  excused: [],
  bookings: [],
  pauses: [],
  grants: [],
};

/**
 * Clients' statistics as the projector's facts, through ONE reader per
 * walk: it places the first instant of each shop day once (a statistic
 * holds a visit's day and minute, never its instant, so the visit is
 * stamped with the first instant of its Sofia day — flatten-spec T3),
 * however many people the walk reads. Every worked visit counts and
 * nothing is known of what the shop called off, of a visit on the book or
 * of a pause: that is why the preview is labelled «приблизително».
 */
export function streakFactsReader(): (
  record: ClientStatsRecord,
) => StreakFacts {
  const dayStarts = new Map<LocalDate, UtcEpochMs>();
  const startOf = (day: LocalDate): UtcEpochMs => {
    let start = dayStarts.get(day);
    if (start === undefined) {
      start = ZonedTimeSystem.startOfLocalDay(day, RHYTHM_SHOP_ZONE);
      dayStarts.set(day, start);
    }
    return start;
  };
  return (record) => {
    const visits: StreakVisitFact[] = [];
    for (const fact of record.last365VisitsCompleted) {
      visits.push({
        localDate: fact.localDate,
        counted: true,
        utcEpochMs: startOf(fact.localDate),
      });
    }
    return { ...NO_FACTS, visits };
  };
}

/** One client's statistics as the projector's facts (`streakFactsReader`, for one). */
export function streakFactsOf(record: ClientStatsRecord): StreakFacts {
  return streakFactsReader()(record);
}

/**
 * The walk: `clientStats` in the order of its ids (client records, D29), a
 * page after a page, until nobody is left or the fifth page is read. A page
 * that fails fails the walk: a preview over half the shop would be a wrong
 * number, not an estimate.
 */
export async function readRhythmPreviewFacts(
  stats: ClientStatsPagePorts,
): Promise<Result<RhythmPreviewFacts, RepositoryError>> {
  const factsOf = streakFactsReader();
  const clients: StreakFacts[] = [];
  let after: CustomerId | null = null;
  for (let page = 0; page < RHYTHM_PREVIEW_PAGES; page += 1) {
    let read: Awaited<ReturnType<ClientStatsPagePorts['pageClientStats']>>;
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
 * The facts, read once and kept: a record of closures over ONE walk. The
 * first `read()` starts the walk; every later one answers what it read (or
 * is still reading), a walk that failed included: a failure is an answer,
 * and asking it again by itself would read the shop twice behind one
 * notice. «Опитай пак» is `forget()`, then `read()`.
 */
export type RhythmPreviewSource = {
  readonly read: () => Promise<Result<RhythmPreviewFacts, RepositoryError>>;
  /** The next `read()` walks again. */
  readonly forget: () => void;
  /** The walk was made and failed: there is nothing to wait for until `forget()`. */
  readonly failed: () => boolean;
};

export function rhythmPreviewSource(
  stats: ClientStatsPagePorts,
): RhythmPreviewSource {
  let walk: Promise<Result<RhythmPreviewFacts, RepositoryError>> | null = null;
  let walkFailed = false;
  const read = (): Promise<Result<RhythmPreviewFacts, RepositoryError>> => {
    if (walk !== null) return walk;
    const started = readRhythmPreviewFacts(stats).then((facts) => {
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

/**
 * Whether the two rules can be previewed from visit days alone. A rule
 * that counts by a list asks what a visit HELD, which the statistics do
 * not say: the preview is then unavailable, and nothing has to be read to
 * know it.
 */
export function rhythmPreviewReadsFacts(
  inForce: StreakRule,
  draft: StreakRule,
): boolean {
  return (
    inForce.streakQualifier === StreakQualifier.AnyVisit &&
    draft.streakQualifier === StreakQualifier.AnyVisit
  );
}

/** The fold: `StreakPreviewSystem.estimate` (`@core/systems`), over the facts the walk read. */
export function rhythmPreviewOf(input: {
  readonly inForce: StreakRule;
  readonly draft: StreakRule;
  readonly facts: RhythmPreviewFacts;
  /** The shop's today, as written: on a day that is no day nobody is judged. */
  readonly today: string;
}): StreakPreview {
  const today = LocalDate.parse(input.today);
  return StreakPreviewSystem.estimate(
    input.inForce,
    input.draft,
    input.facts.clients,
    today.ok ? today.value : null,
  );
}

// ── The rule card's sample run ─────────────────────────────────────────────

/** How many visits the sample client makes on time before the due date they miss. */
const SAMPLE_VISITS_BEFORE_THE_MISS = 6;

/**
 * One invented client's visits under a rule, ending yesterday: six visits
 * on time (enough to earn a protection under the recommended rule), then
 * ONE due date missed by a whole period and the visit that came after it.
 * The projector marks every visit and the due date nobody met, so the run
 * ends «kept, kept, kept, the miss, kept» and an open period: the track
 * the rule card draws (§2.6.1).
 *
 * On time is the newcomer's interval, which every later period of the same
 * rule is at least as long as. The late visit falls on the day the missed
 * due date would move to under a protection: past the grace, so the miss
 * is judged, and no later than a protection forgives. Each visit is
 * stamped with the first instant of its Sofia day, as the walk's are.
 */
export function sampleRhythmFacts(
  rule: StreakRule,
  today: string,
): StreakFacts {
  // Plain calendar arithmetic on the shop's day (no zone moves a civil date).
  const day = LocalDate.parse(today);
  if (!day.ok) return NO_FACTS;

  const onTime = StreakIntervalRule.daysFor(rule, null).days;
  const late = 2 * StreakIntervalRule.daysFor(rule, onTime).days;
  const gaps = [
    ...Array.from({ length: SAMPLE_VISITS_BEFORE_THE_MISS - 1 }, () => onTime),
    late,
  ];
  // Counted back from yesterday: the newest visit first.
  let daysAgo = 1;
  const days = [daysAgo];
  for (const gap of [...gaps].reverse()) {
    daysAgo += gap;
    days.push(daysAgo);
  }
  const visits: StreakVisitFact[] = [];
  for (const ago of days.reverse()) {
    const localDate = LocalDate.addDays(day.value, -ago);
    visits.push({
      localDate,
      counted: true,
      utcEpochMs: ZonedTimeSystem.startOfLocalDay(localDate, RHYTHM_SHOP_ZONE),
    });
  }
  return { ...NO_FACTS, visits };
}

/**
 * The sample client's rhythm under a rule: what the rule card's track
 * draws. `null` under a rule that is off (it judges nobody), and on a day
 * that is no day.
 */
export function sampleRhythmRun(
  rule: StreakRule,
  today: string,
): StreakState | null {
  const day = LocalDate.parse(today);
  if (!day.ok) return null;
  return StreakSystem.project(
    StreakRule.DEFAULT_DEFINITION_ID,
    rule,
    sampleRhythmFacts(rule, day.value),
    day.value,
  );
}
