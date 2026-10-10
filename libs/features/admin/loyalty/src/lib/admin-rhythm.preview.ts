import {
  type ClientStatsDirectory,
  type ClientStatsRecord,
  type Result,
  ZonedDateTime,
  fail,
  ok,
} from '@creativo/application/booking';
import {
  type IsoDate,
  type StreakDefinition,
  type StreakFacts,
  type StreakPreview,
  type StreakState,
  projectStreak,
  sofiaDayOf,
} from '@creativo/application/engagement';
import { RepositoryError } from '@creativo/application/shared';
import {
  DayKey,
  type ServiceCategoryId,
  type ServiceId,
  type StreakFacts as SystemFacts,
  StreakIntervalKind,
  StreakPreviewSystem,
  StreakQualifierKind,
  type StreakRule,
} from '@creativo/ecs-core';

/*
 * «КАКВО ЩЕ СЕ ПРОМЕНИ», THE FACTS (client-card revision 3 §2.6.4, §4.4).
 *
 * The preview is an ESTIMATE made in the browser: every client's visits of
 * the last year folded through the domain's projector twice, once per
 * rule. The fold is the application's (`PreviewStreakDefinitionUseCase`,
 * pure). What is this file's: where the facts come from (`clientStats`,
 * walked a page at a time), how far the walk goes, and that it is made
 * ONCE per visit to the page, so a recompute reads nothing.
 *
 * Beside it, the rule card's sample run: one invented client under the
 * draft, through the same projector, so the track on the card is what the
 * rule really does and never a drawing of it.
 */

/** A page of the walk, and how many pages it may take: five of 200. */
export const RHYTHM_PREVIEW_PAGE_SIZE = 200;
export const RHYTHM_PREVIEW_PAGES = 5;
/** «от първите 1 000 клиенти»: where the walk stops. */
export const RHYTHM_PREVIEW_CAP =
  RHYTHM_PREVIEW_PAGE_SIZE * RHYTHM_PREVIEW_PAGES;
/** The preview recomputes by itself this long after the last change. */
export const RHYTHM_PREVIEW_DELAY_MS = 600;

const SHOP_ZONE = 'Europe/Sofia';

/** What the walk read. */
export interface RhythmPreviewFacts {
  /** One person's facts each, in the order of the walk. */
  readonly clients: readonly StreakFacts[];
  /** The walk stopped at its last page with clients left: the card says so. */
  readonly capped: boolean;
}

/**
 * One client's statistics as the projector's facts. The statistics hold a
 * visit's instant and nothing else, so every worked visit counts and
 * nothing is known of what the shop called off, of a visit on the book or
 * of a pause: that is why the preview is labelled «приблизително».
 */
export function streakFactsOf(record: ClientStatsRecord): StreakFacts {
  return {
    visits: record.last365.visitsCompleted.map((fact) => ({
      day: sofiaDayOf(new Date(fact.atMs)),
      counted: true,
    })),
    excused: [],
    bookings: [],
    pauses: [],
    grants: [],
  };
}

/**
 * The walk: `clientStats` in the order of its ids, a page after a page,
 * until nobody is left or the fifth page is read. A page that fails fails
 * the walk: a preview over half the shop would be a wrong number, not an
 * estimate.
 */
export async function readRhythmPreviewFacts(
  directory: ClientStatsDirectory,
): Promise<Result<RhythmPreviewFacts, RepositoryError>> {
  const clients: StreakFacts[] = [];
  let after: string | null = null;
  for (let page = 0; page < RHYTHM_PREVIEW_PAGES; page += 1) {
    let read: Awaited<ReturnType<ClientStatsDirectory['page']>>;
    try {
      read = await directory.page(RHYTHM_PREVIEW_PAGE_SIZE, after);
    } catch (error) {
      return fail(new RepositoryError('The statistics read threw', error));
    }
    if (read.isFailure()) return fail(read.error);
    for (const record of read.value.records) {
      clients.push(streakFactsOf(record));
    }
    after = read.value.next;
    if (after === null) return ok({ clients, capped: false });
  }
  return ok({ clients, capped: true });
}

/**
 * The facts, read once and kept. The first `read()` starts the walk; every
 * later one answers what it read (or is still reading), a walk that
 * failed included: a failure is an answer, and asking it again by itself
 * would read the shop twice behind one notice. «Опитай пак» is `forget()`,
 * then `read()`.
 */
export class RhythmPreviewSource {
  private walk: Promise<Result<RhythmPreviewFacts, RepositoryError>> | null =
    null;
  private walkFailed = false;

  constructor(private readonly directory: ClientStatsDirectory) {}

  /** The walk was made and failed: there is nothing to wait for until `forget()`. */
  get failed(): boolean {
    return this.walkFailed;
  }

  read(): Promise<Result<RhythmPreviewFacts, RepositoryError>> {
    if (this.walk !== null) return this.walk;
    const walk = readRhythmPreviewFacts(this.directory).then((facts) => {
      // A walk that was forgotten meanwhile says nothing of the one after it.
      if (this.walk === walk) this.walkFailed = facts.isFailure();
      return facts;
    });
    this.walk = walk;
    return walk;
  }

  /** The next `read()` walks again. */
  forget(): void {
    this.walk = null;
    this.walkFailed = false;
  }
}

/**
 * Whether the two rules can be previewed from visit days alone. A rule
 * that counts by a list asks what a visit HELD, which the statistics do
 * not say: the preview is then unavailable, and nothing has to be read to
 * know it.
 */
export function rhythmPreviewReadsFacts(
  inForce: StreakDefinition,
  draft: StreakDefinition,
): boolean {
  return (
    inForce.qualifier.kind === 'anyVisit' && draft.qualifier.kind === 'anyVisit'
  );
}

/** The fold: `StreakPreviewSystem.estimate` (`@creativo/ecs-core`), over the facts the walk read. */
export function rhythmPreviewOf(input: {
  readonly inForce: StreakDefinition;
  readonly draft: StreakDefinition;
  readonly facts: RhythmPreviewFacts;
  readonly today: IsoDate;
}): StreakPreview {
  return StreakPreviewSystem.estimate(
    ruleOf(input.inForce),
    ruleOf(input.draft),
    input.facts.clients.map(factsOf),
    DayKey.of(input.today),
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
 * is judged, and no later than a protection forgives.
 */
export function sampleRhythmFacts(
  definition: StreakDefinition,
  today: IsoDate,
): StreakFacts {
  const none: StreakFacts = {
    visits: [],
    excused: [],
    bookings: [],
    pauses: [],
    grants: [],
  };
  const noon = ZonedDateTime.fromISO(`${today}T12:00:00`, SHOP_ZONE);
  if (noon.isFailure()) return none;

  const onTime = definition.interval.daysFor(null).days;
  const late = 2 * definition.interval.daysFor(onTime).days;
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
  return {
    ...none,
    visits: days.reverse().map((ago) => ({
      day: noon.value.plusDays(-ago).toISODate(),
      counted: true,
    })),
  };
}

/**
 * The sample client's rhythm under a rule: what the rule card's track
 * draws. `null` under a rule that is off (it judges nobody).
 */
export function sampleRhythmRun(
  definition: StreakDefinition,
  today: IsoDate,
): StreakState | null {
  return projectStreak(definition, sampleRhythmFacts(definition, today), today);
}

// ── The bridge: legacy class/facts → ecs-core struct (Phase 4 deletes it) ──

/** A version as the system reads it: the class's figures, the day as a day key. */
function ruleOf(definition: StreakDefinition): StreakRule {
  const props = definition.toProps();
  const { qualifier, interval } = props;
  return {
    version: props.version,
    effectiveFromDayKey: DayKey.of(props.effectiveFrom),
    enabled: props.enabled,
    qualifier:
      qualifier.kind === 'services'
        ? {
            kind: StreakQualifierKind.Services,
            serviceIds: qualifier.serviceIds as readonly ServiceId[],
          }
        : qualifier.kind === 'categories'
          ? {
              kind: StreakQualifierKind.Categories,
              categoryIds:
                qualifier.categoryIds as readonly ServiceCategoryId[],
            }
          : { kind: StreakQualifierKind.AnyVisit },
    minGapDays: props.minGapDays,
    bookingHold: props.bookingHold,
    interval:
      interval.kind === 'fixed'
        ? { kind: StreakIntervalKind.Fixed, days: interval.days }
        : {
            kind: StreakIntervalKind.Personal,
            tolerancePct: interval.tolerancePct,
            minDays: interval.minDays,
            maxDays: interval.maxDays,
            fallbackDays: interval.fallbackDays,
          },
    graceDays: props.graceDays,
    riskLeadDays: props.riskLeadDays,
    protections: props.protections,
    excuses: props.excuses,
    clientPause: props.clientPause,
    repair: props.repair,
    onBreak: props.onBreak,
  };
}

/** One person's facts as the system reads them: every field present. */
function factsOf(facts: StreakFacts): SystemFacts {
  return {
    visits: facts.visits.map((visit) => ({
      day: DayKey.of(visit.day),
      counted: visit.counted,
      atMs: visit.at === undefined ? null : visit.at.getTime(),
    })),
    excused: facts.excused.map((excused) => ({
      day: DayKey.of(excused.day),
      reason: excused.reason,
    })),
    bookings: facts.bookings.map((booking) => ({
      placedOn: DayKey.of(booking.placedOn),
      day: DayKey.of(booking.day),
      appointmentId: booking.appointmentId ?? null,
    })),
    pauses: facts.pauses.map((pause) => ({
      from: DayKey.of(pause.from),
      until: DayKey.of(pause.until),
      reason: pause.reason,
    })),
    grants: facts.grants.map((grant) => ({
      day: DayKey.of(grant.day),
      count: grant.count,
    })),
  };
}
