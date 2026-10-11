import { UserId } from '@creativo/application/accounts';
import {
  type Appointment,
  type Seat,
  ZonedDateTime,
  subjectVisitOf,
} from '@creativo/application/booking';
import {
  type BadgeLevel,
  type BadgeProgress,
  type BadgeSeries,
  type EarnedLevel,
  type SeriesStanding,
  levelNumeral,
  sofiaDayOf,
} from '@creativo/application/engagement';
import {
  BarberId as BarberRefId,
  LocalDate,
  LocationId as LocationRefId,
  MinuteOfDay,
  ServiceId as ServiceRefId,
  UtcEpochMs,
  type Weekday,
  defect,
} from '@core/primitives';
import { type MetricRef } from '@core/components';
import { AchievementsSystem } from '@core/systems';
import {
  type RhythmRuleWords,
  type VisitRowVm,
  firstNameOf,
} from '@creativo/features/shared/visits';
import {
  type AchievementsContext,
  completesWithThisVisit,
  inEndedSeason,
  isOneOff,
  isSingleLevel,
  landsOn,
  latestEarned,
  localeOf,
  progressOf,
  relatedOf,
} from './achievements.presenter';
import type { ClientCardCatalog } from './client-card.contracts';
import {
  NO_BREAK,
  dayLong,
  dayWithYear,
  figure,
  inSentence,
} from './client-card.format';
import {
  type AchievementWhoWord,
  achievementMetricWord,
} from './client-card.words';
import type {
  AchievementsData,
  DetailActionVm,
  DetailFaceVm,
  DetailHowVm,
  DetailLevelVm,
  DetailPictureVm,
  DetailRelatedVm,
  LinePart,
  MedalDetailVm,
  MedalProgressVm,
  MedalVm,
} from './client-pages.vm';
import type { HistoryRowsInput } from './history.presenter';
import { medalRingVm } from './medals.presenter';
import { visitsRows } from './visits-page.presenter';

/*
 * A MEDAL'S DETAIL (client-card revision 3 §2.4, R2-H) — one family's page
 * as six blocks, EACH FACT ONCE: the medal on its stage and the state line
 * (where the family stands, and since when), the progress card (the ONLY
 * place for the count), «Как се печели» (one sentence chosen by the
 * family's metric, the picture of what counts, who and where, the
 * exclusion), the ladder of medals (each level's threshold, reward and
 * day), the visits that counted, the family's neighbours.
 *
 * Pure functions of the store's `AchievementsData` and the page's context,
 * as every presenter of the card. The domain decides standing
 * (`series.standing`); `medalRingVm` decides how a family's medal is drawn,
 * here as on every grid, so the hero, a neighbour's tile and a tile of
 * «Постижения» never tell one family two ways. This file words the rest.
 *
 * The page's one verb («Добави фейд») is the DOCK's, never the body's
 * (DV-C): `detailActionOf` answers it for the store, and the view model
 * only carries what it was handed.
 */

/** Where the shop's hours are read: the zone of every visit on the card. */
const SHOP_ZONE = 'Europe/Sofia';

/** A draft with no start yet: a weekday that is no weekend. */
const WEEKDAY_MONDAY: Weekday = 1;

/** DI — the visits that counted, newest first: never more than these. */
const COUNTED_VISITS_LIMIT = 5;

/** DJ — ONE grid row of three, never a rail. */
const RELATED_LIMIT = 3;

/** DF — the covers a card shows; a fifth and more fold into «+N» on the last. */
const COVERS_LIMIT = 4;

// ── The catalogue, as the detail reads it ───────────────────────────────

/*
 * «Как се печели» reads a service's price and the shop's barbers through
 * the card's own contract (`ClientCardCatalog.servicePrice`, `barberIds`,
 * both optional since W4 — contract delta P4-1): a host that answers
 * neither draws the cover without its price, and the faces of the barbers
 * the loyalty catalogue itself names (a family per barber).
 */

// ── Words and lines ─────────────────────────────────────────────────────

/** A requirement printed as the block's sentence ends on ONE full stop, whatever the catalogue ended it on. */
function oneStop(sentence: string): string {
  return /[.!?…]$/u.test(sentence) ? sentence : `${sentence}.`;
}

/** Words that stand on a line of their own open on a capital («с това посещение» → «С това посещение»). */
function standingAlone(text: string, lang: string): string {
  return text.charAt(0).toLocaleUpperCase(lang) + text.slice(1);
}

/**
 * A date, or a count and its noun, as ONE unit to the line breaker: a line
 * that wraps breaks before it, never inside it (an orphaned «г.», «25» on
 * one line and «посещения» on the next). Typography, as the built medal's
 * caption binds its date: no letter changes.
 */
function asOneUnit(text: string): string {
  return text.replace(/ /gu, NO_BREAK);
}

/**
 * ONE translated sentence, cut around the fact that was passed into it:
 * the fact becomes a run in primary ink, the rest stays quiet, and the
 * runs joined are the sentence again, letter for letter.
 */
function lineAround(
  sentence: string,
  fact: string | null,
): readonly LinePart[] {
  const at = fact === null || fact === '' ? -1 : sentence.lastIndexOf(fact);
  if (fact === null || at < 0) return [{ text: sentence, fact: false }];
  const end = at + fact.length;
  return [
    ...(at > 0 ? [{ text: sentence.slice(0, at), fact: false }] : []),
    { text: fact, fact: true },
    ...(end < sentence.length
      ? [{ text: sentence.slice(end), fact: false }]
      : []),
  ];
}

/** The level a family's medal wears: the highest one earned, with its day. */
function topEarned(progress: BadgeProgress | null): EarnedLevel | null {
  let top: EarnedLevel | null = null;
  for (const earned of progress?.earned ?? []) {
    if (top === null || earned.level > top.level) top = earned;
  }
  return top;
}

/** A medal's day always names its year: a ladder spans years («24.09.2025 г.»). */
function medalDay(at: Date, lang: string): string {
  return asOneUnit(dayWithYear(sofiaDayOf(at), lang));
}

/**
 * The family can still move: it is awarded, its season (if it has one) has
 * not ended, and a level is left to earn. What cannot move offers no verb
 * and counts no visit.
 */
function canStillMove(
  series: BadgeSeries,
  standing: SeriesStanding,
  data: AchievementsData,
): boolean {
  return (
    !series.isRetired() &&
    standing.next !== null &&
    !inEndedSeason(series, data)
  );
}

// ── What counts ─────────────────────────────────────────────────────────

/** One appointment as the person's WORKED visit: their worked seats, when it began, who else came. */
interface WorkedVisit {
  readonly seats: readonly Seat[];
  readonly start: ZonedDateTime;
  readonly withCompany: boolean;
}

function workedVisitOf(
  visit: Appointment,
  subjectUserId: string,
): WorkedVisit | null {
  const subject = UserId.create(subjectUserId);
  if (subject.isFailure()) return null;
  const own = subjectVisitOf(subject.value, visit);
  if (own === null) return null;
  const seats = own.seats.filter((seat) => seat.outcome.kind === 'worked');
  const first = seats[0];
  if (first === undefined) return null;
  return {
    seats,
    start: seats.reduce(
      (earliest, seat) =>
        seat.startsAt.isBefore(earliest) ? seat.startsAt : earliest,
      first.startsAt,
    ),
    withCompany: own.seats.length < visit.seats.length,
  };
}

/**
 * DI — did this visit count towards the family? The projection's own
 * reading of a visit (`tools/seed/loyalty.mjs`, `workedVisitsOf` and
 * `metricValue`), so the rows under «Броени посещения» and the figure over
 * them can never tell two stories:
 *
 * - only the person's own WORKED seats count: an hour still to come, a
 *   cancelled one and a no-show count nothing, and a companion's seat says
 *   nothing about the person;
 * - a count narrowed to a service, a barber or a shop (`MetricRef.where`)
 *   asks for it among those seats — the service ITSELF, never a bundle
 *   that holds it, as the projection counts;
 * - an early bird began by 10:00, a weekend visit on a Saturday or a
 *   Sunday, a punctual one was marked arrived by its start, a visit with
 *   company has someone else's seat on it.
 *
 * A family that counts no single visit answers `false` for every visit: a
 * single act and the rhythm (`metric: null`), bookings, referrals, money,
 * points and tenure, and the DISTINCT counts — which visit first brought a
 * new service cannot be told from one visit, nor from a history loaded in
 * pages.
 *
 * Two things are NOT read here, because a visit and a family do not hold
 * them: a season's window and a metric's own window (`lastDays`).
 * `medalDetailVm` applies both.
 */
export function countsToward(
  series: BadgeSeries,
  visit: Appointment,
  subjectUserId: string,
): boolean {
  const metric = series.metric;
  if (metric === null) return false;
  const worked = workedVisitOf(visit, subjectUserId);
  if (worked === null) return false;
  return AchievementsSystem.countsToward(metricRefOf(metric), {
    serviceIds: worked.seats.map((seat) =>
      ServiceRefId.of(seat.serviceId.value),
    ),
    barberIds: worked.seats.map((seat) => BarberRefId.of(seat.barberId.value)),
    locationId: LocationRefId.of(visit.locationId.value),
    // The start on the shop's wall clock, read here once (T1).
    localDate: dayOf(worked.start.toISODate()),
    startMinutes: minuteOf(worked.start.hour * 60 + worked.start.minute),
    weekday: worked.start.weekday as Weekday,
    startUtcMs: utcOf(worked.start.toMillis()),
    arrivedAtUtcMs:
      visit.arrivedAt === null ? null : utcOf(visit.arrivedAt.toMillis()),
    withCompany: worked.withCompany,
  });
}

/**
 * A counted visit falls inside the family's windows: its season's (a
 * season's families count inside the season only) and its metric's own
 * («Цяла година» counts the last 365 days).
 */
function insideWindows(
  series: BadgeSeries,
  visit: Appointment,
  data: AchievementsData,
): boolean {
  const day = sofiaDayOf(new Date(visit.timeSlot.start.toMillis()));
  const season =
    series.seasonId === null
      ? null
      : data.catalog.season(series.seasonId.value);
  return AchievementsSystem.insideWindows(
    season === null
      ? null
      : {
          windowFrom: dayOf(season.window.from),
          windowUntil: dayOf(season.window.until),
        },
    series.seasonId !== null,
    series.metric?.window?.lastDays ?? null,
    dayOf(day),
    dayOf(data.today),
  );
}

/** The visit on screen, as its draft holds it: when its first service starts. */
function draftStart(
  visit: NonNullable<AchievementsContext['visit']>,
): ZonedDateTime | null {
  let earliest: ZonedDateTime | null = null;
  for (const leg of visit.legs) {
    const start = ZonedDateTime.fromISO(leg.startsAtIso, SHOP_ZONE);
    if (start.isFailure()) continue;
    if (earliest === null || start.value.isBefore(earliest)) {
      earliest = start.value;
    }
  }
  return earliest;
}

/**
 * DE's third line — the visit on screen, still open, will count towards
 * the family once it is over: its DRAFT holds what the family counts (the
 * service, the barber, the shop, an early start, a weekend day). The same
 * measure as «с това посещение» (`completesWithThisVisit`), without asking
 * how far the next level is. What only the day itself decides is not
 * promised: whether the client arrives on time, whether company comes.
 */
function thisVisitCounts(
  series: BadgeSeries,
  standing: SeriesStanding,
  data: AchievementsData,
  ctx: AchievementsContext,
): boolean {
  const visit = ctx.visit;
  const metric = series.metric;
  if (
    visit === null ||
    metric === null ||
    standing.target === null ||
    !canStillMove(series, standing, data)
  ) {
    return false;
  }
  if (series.seasonId !== null) {
    const season = data.catalog.season(series.seasonId.value);
    if (season === null || season.phaseOn(data.today) !== 'open') return false;
  }
  // The draft as a visit the system can judge: what the day itself
  // decides (an arrival, company) is not promised, and a draft with no
  // start yet is neither early nor on a weekend.
  const start = draftStart(visit);
  return AchievementsSystem.countsToward(metricRefOf(metric), {
    serviceIds: visit.legs.flatMap((leg) =>
      leg.serviceId === null ? [] : [ServiceRefId.of(leg.serviceId)],
    ),
    barberIds: visit.legs.flatMap((leg) =>
      leg.barberId === null ? [] : [BarberRefId.of(leg.barberId)],
    ),
    // A draft with no shop yet is in none: no shop's family counts it.
    locationId: LocationRefId.of(visit.locationId ?? ''),
    // No start yet: today, the day's last minute (never early) and a
    // Monday (never a weekend) — what the old `NaN`/`∞` start answered.
    localDate: start === null ? dayOf(data.today) : dayOf(start.toISODate()),
    startMinutes:
      start === null
        ? minuteOf(LAST_MINUTE_OF_DAY)
        : minuteOf(start.hour * 60 + start.minute),
    weekday: start === null ? WEEKDAY_MONDAY : (start.weekday as Weekday),
    // Never compared: a draft has no arrival.
    startUtcMs: utcOf(start === null ? 0 : start.toMillis()),
    arrivedAtUtcMs: null,
    withCompany: false,
  });
}

// ── DK · the dock's verb ────────────────────────────────────────────────

/**
 * DK — «Добави фейд», the detail's one verb, for the editor's dock (DV-C).
 * Present when the family is about a SERVICE the shop still offers, the
 * visit on screen is open and can be edited (not gone, online, the client
 * not paused), and this person's services on it lack that one. Otherwise
 * `null`: the dock draws ✓ alone.
 *
 * `data` is optional and asked for: with it, a family that cannot move any
 * more — every level earned, its season ended — offers no verb either
 * (§2.4.4, «Complete»). Without it only what the family and the visit say
 * is read.
 */
export function detailActionOf(
  series: BadgeSeries,
  ctx: AchievementsContext,
  gate: {
    readonly online: boolean;
    readonly visitGone: boolean;
    readonly paused: boolean;
  },
  data: AchievementsData | null = null,
): DetailActionVm | null {
  if (!gate.online || gate.visitGone || gate.paused) return null;
  if (series.isRetired() || ctx.visit === null) return null;
  const subject = series.subject;
  if (subject === null || subject.kind !== 'service') return null;
  if (
    data !== null &&
    !canStillMove(series, series.standing(progressOf(data, series)), data)
  ) {
    return null;
  }
  const serviceId = subject.serviceId.value;
  if (ctx.visit.legs.some((leg) => leg.serviceId === serviceId)) return null;
  const service = ctx.catalog.serviceName(serviceId);
  if (service === null) return null;
  return {
    serviceId,
    label: ctx.words.achievement.addToVisit(
      inSentence(service, ctx.words.lang),
    ),
    accessibleName: ctx.words.achievement.addToVisitName(service),
  };
}

// ── DD · the state line ─────────────────────────────────────────────────

/** Where the family stands, and the date the line sets apart. */
interface StateSaid {
  readonly text: string;
  readonly fact: string | null;
}

function stateOf(
  series: BadgeSeries,
  standing: SeriesStanding,
  progress: BadgeProgress | null,
  data: AchievementsData,
  ctx: AchievementsContext,
): StateSaid {
  const words = ctx.words.achievement;
  const lang = ctx.words.lang;
  const last = latestEarned(progress);
  const lastDay = last === null ? null : medalDay(last.earnedAt, lang);
  // A yearly act: how many times, and when last.
  if (series.repeatable && last !== null && lastDay !== null) {
    return {
      text:
        last.count > 1
          ? words.repeated(last.count, lastDay)
          : words.oneOffEarned(lastDay),
      fact: lastDay,
    };
  }
  // An ended season's family stopped where it stopped: that it closed,
  // never how far a level it can no longer reach is.
  if (standing.next !== null && inEndedSeason(series, data)) {
    return { text: ctx.words.achievements.seasonEnded, fact: null };
  }
  // One level earned is a single act: its day, never «Всички нива».
  if (isOneOff(series) || (isSingleLevel(series) && standing.next === null)) {
    return lastDay === null
      ? { text: words.oneOffNotYet, fact: null }
      : { text: words.oneOffEarned(lastDay), fact: lastDay };
  }
  if (standing.state === 'notStarted') {
    return { text: words.stateNotStarted, fact: null };
  }
  const top = topEarned(progress);
  // Under way, no level yet. How far is the progress card's to say.
  if (top === null) return { text: words.oneOffNotYet, fact: null };
  if (standing.next === null) {
    return lastDay === null
      ? { text: ctx.words.achievements.complete, fact: null }
      : { text: words.completeSince(lastDay), fact: lastDay };
  }
  const since = medalDay(top.earnedAt, lang);
  return {
    text: words.levelSince(levelNumeral(top.level), since),
    fact: since,
  };
}

/** The shelf or the season the family lives in, by name. */
function scopeNameOf(
  series: BadgeSeries,
  data: AchievementsData,
  ctx: AchievementsContext,
): string | null {
  const locale = localeOf(ctx);
  if (series.categoryId !== null) {
    return (
      data.catalog.category(series.categoryId.value)?.title.get(locale) ?? null
    );
  }
  if (series.seasonId !== null) {
    return (
      data.catalog.season(series.seasonId.value)?.title.get(locale) ?? null
    );
  }
  return null;
}

/**
 * DD — «Майсторство · Ниво II · от 24.09.2025 г.»: the family's shelf (its
 * season, for a season's family) as the line's first fact, then where it
 * stands, the day set apart. It never counts: the count is the progress
 * card's. A retired family says only that it is no longer awarded.
 */
function stateLineOf(
  series: BadgeSeries,
  standing: SeriesStanding,
  progress: BadgeProgress | null,
  data: AchievementsData,
  ctx: AchievementsContext,
): readonly LinePart[] {
  if (series.isRetired()) {
    return lineAround(ctx.words.achievement.retired, null);
  }
  const state = stateOf(series, standing, progress, data, ctx);
  const scope = scopeNameOf(series, data, ctx);
  return lineAround(
    scope === null
      ? state.text
      : ctx.words.achievement.stateWithCategory(scope, state.text),
    state.fact,
  );
}

// ── DE · the progress card ──────────────────────────────────────────────

/**
 * WHAT the figure counts, under it: the words of the family's metric in
 * the form `count` asks for — «посещения с фейд», «приятел, дошъл по
 * препоръка». A single act has no metric and says its own requirement; a
 * subject the shop's catalogue no longer names falls back to the family's.
 */
function whatOf(
  series: BadgeSeries,
  ctx: AchievementsContext,
  count: number,
): string {
  const words = ctx.words.achievement;
  const lang = ctx.words.lang;
  const own = inSentence(series.requirement.get(localeOf(ctx)), lang);
  const metric = series.metric;
  if (metric === null) return isOneOff(series) ? own : words.whatRhythm(count);
  if (metric.metric !== 'client.visits.completed') {
    return words.what(achievementMetricWord(metric.metric), count);
  }
  const where = metric.where;
  if (where?.serviceId !== undefined) {
    const service = ctx.catalog.serviceName(where.serviceId.value);
    return service === null
      ? own
      : words.whatService(inSentence(service, lang), count);
  }
  if (where?.barberId !== undefined) {
    // A barber in a sentence goes by first name, as every line of the card
    // names him («при Иван»); the whole name is the faces' (DF), a list.
    const barber = ctx.catalog.barberName(where.barberId.value);
    return barber === null ? own : words.whatBarber(firstNameOf(barber), count);
  }
  if (where?.locationId !== undefined) {
    const shop = ctx.catalog.locationName(where.locationId.value);
    return shop === null ? own : words.whatShop(shop, count);
  }
  return words.what('visits', count);
}

/**
 * DE — the progress card, THE ONLY PLACE for the count: «23 от 25» ·
 * «посещения с фейд» · «Още 2 до ниво III», and what this visit adds when
 * its draft holds what counts.
 *
 * - A single act, once done, shows the day it was done. Until then it is
 *   «0 от 1»: its state in words («Още не е спечелено») does not fit the
 *   figure's rung on a phone, and the state line says it. When the visit
 *   on screen is the act («Рожден ден в салона», on the day), the third
 *   line says «С това посещение».
 * - A ladder climbed to its top shows its last threshold and «Всички нива»
 *   (one level earned is a single act: the state line dates it).
 * - A family that can no longer move (retired, its season ended) shows
 *   where it stopped, and nothing reads as progress.
 * - Tenure is worded by the day its next level lands, never by days left.
 */
function progressCardOf(
  series: BadgeSeries,
  standing: SeriesStanding,
  progress: BadgeProgress | null,
  data: AchievementsData,
  ctx: AchievementsContext,
): MedalProgressVm {
  const words = ctx.words.achievement;
  const lang = ctx.words.lang;

  if (isOneOff(series)) {
    const last = latestEarned(progress);
    return {
      value: last === null ? figure(0, lang) : medalDay(last.earnedAt, lang),
      unit:
        last === null && canStillMove(series, standing, data)
          ? words.progressOf(1)
          : null,
      what: whatOf(series, ctx, 1),
      remaining: null,
      thisVisit: completesWithThisVisit(series, data, ctx)
        ? standingAlone(ctx.words.achievements.withThisVisit, lang)
        : null,
    };
  }

  const lastTarget = series.levels.at(-1)?.target ?? standing.value;
  if (standing.next === null) {
    return {
      value: figure(lastTarget, lang),
      unit: null,
      what: whatOf(series, ctx, lastTarget),
      remaining: isSingleLevel(series) ? null : ctx.words.achievements.complete,
      thisVisit: null,
    };
  }

  const target = standing.target;
  if (target === null || !canStillMove(series, standing, data)) {
    return {
      value: figure(standing.value, lang),
      unit: null,
      what: whatOf(series, ctx, standing.value),
      remaining: null,
      thisVisit: null,
    };
  }

  const level = levelNumeral(standing.next.level);
  const on = landsOn(series, standing, data);
  const left = target - standing.value;
  return {
    value: figure(standing.value, lang),
    unit: words.progressOf(target),
    what: whatOf(series, ctx, target),
    remaining:
      on !== null
        ? words.stateToNextOn(level, asOneUnit(dayWithYear(on, lang)))
        : left > 0
          ? words.remaining(left, level)
          : null,
    thisVisit: thisVisitCounts(series, standing, data, ctx)
      ? words.thisVisitCounts(Math.min(standing.value + 1, target), target)
      : null,
  };
}

// ── DF · «Как се печели» ────────────────────────────────────────────────

/** The metrics that count VISITS: their block ends on the exclusion, once. */
function countsVisits(series: BadgeSeries): boolean {
  switch (series.metric?.metric) {
    case 'client.visits.completed':
    case 'client.visits.earlyBird':
    case 'client.visits.weekend':
    case 'client.visits.onTime':
    case 'client.visits.party':
    case 'client.services.distinct':
    case 'client.barbers.distinct':
    case 'client.locations.distinct':
    case 'client.months.distinct':
      return true;
    default:
      return false;
  }
}

/**
 * The ONE sentence, chosen by the family's METRIC and worded around its
 * subject (§2.4.3) — never assembled from a title. A single act prints its
 * own requirement; the rhythm family the rule in force, as «Ритъм» words it
 * (its own requirement while the rule is not known).
 */
function howSentenceOf(
  series: BadgeSeries,
  ctx: AchievementsContext,
  rule: RhythmRuleWords | null,
): string {
  const words = ctx.words.achievement;
  const lang = ctx.words.lang;
  const own = oneStop(series.requirement.get(localeOf(ctx)));
  const metric = series.metric;
  if (metric === null) {
    return isOneOff(series) ? own : (rule?.sentence ?? own);
  }
  if (metric.metric !== 'client.visits.completed') {
    return words.how(achievementMetricWord(metric.metric));
  }
  const where = metric.where;
  if (where?.serviceId !== undefined) {
    const service = ctx.catalog.serviceName(where.serviceId.value);
    return service === null ? own : words.howService(inSentence(service, lang));
  }
  if (where?.barberId !== undefined) {
    const barber = ctx.catalog.barberName(where.barberId.value);
    return barber === null ? own : words.howBarber(firstNameOf(barber));
  }
  if (where?.locationId !== undefined) {
    const shop = ctx.catalog.locationName(where.locationId.value);
    return shop === null ? own : words.howShop(shop);
  }
  return words.how('visits');
}

/**
 * DF — the covers as the card lays them out: ONE across the card at the
 * subject's own ratio; two to four in a 2-up grid at `4 / 3`; a fifth and
 * more fold into «+N» on the fourth.
 */
export function detailCovers(
  covers: readonly DetailPictureVm[],
  alone: DetailHowVm['ratio'],
): Pick<DetailHowVm, 'pictures' | 'ratio' | 'columns'> {
  if (covers.length <= 1) {
    return { pictures: covers, ratio: alone, columns: 1 };
  }
  const shown = covers.slice(0, COVERS_LIMIT);
  const folded = covers.length - shown.length;
  return {
    pictures: shown.map((cover, index) =>
      folded > 0 && index === shown.length - 1
        ? { ...cover, more: folded }
        : cover,
    ),
    ratio: '4 / 3',
    columns: 2,
  };
}

/**
 * The barbers' faces before the who line: the shop's barbers when the host
 * lists them, else the barbers the loyalty catalogue names (a family per
 * barber, in the shelf's order). A barber the shop no longer names has no
 * face here.
 */
function barberFacesOf(
  data: AchievementsData,
  ctx: AchievementsContext,
): readonly DetailFaceVm[] {
  const catalog: ClientCardCatalog = ctx.catalog;
  const ids =
    catalog.barberIds?.() ??
    data.catalog.families.flatMap((family) =>
      family.subject?.kind === 'barber' && !family.isRetired()
        ? [family.subject.barberId.value]
        : [],
    );
  return [...new Set(ids)].flatMap((id) => {
    const name = catalog.barberName(id);
    return name === null ? [] : [{ name, src: catalog.barberAvatarSrc(id) }];
  });
}

/** The picture of what counts, by the family's subject; what the who line leaves open. */
interface SubjectShown {
  readonly covers: readonly DetailPictureVm[];
  readonly ratio: DetailHowVm['ratio'];
  readonly who: AchievementWhoWord;
  /** The barber's own family draws the barber as its cover, not as a face. */
  readonly faces: boolean;
}

function subjectShownOf(
  series: BadgeSeries,
  ctx: AchievementsContext,
): SubjectShown {
  const catalog: ClientCardCatalog = ctx.catalog;
  const subject = series.subject;
  const cover = (
    key: string,
    title: string | null,
    caption: string | null,
    src: string | null,
  ): readonly DetailPictureVm[] =>
    title === null ? [] : [{ key, title, caption, src, more: null }];
  switch (subject?.kind) {
    case 'service': {
      const id = subject.serviceId.value;
      return {
        covers: cover(
          id,
          catalog.serviceName(id),
          catalog.servicePrice?.(id) ?? null,
          catalog.serviceCoverSrc(id),
        ),
        ratio: '16 / 9',
        who: 'anyBarberAnyShop',
        faces: true,
      };
    }
    case 'barber': {
      const id = subject.barberId.value;
      return {
        covers: cover(
          id,
          catalog.barberName(id),
          null,
          catalog.barberAvatarSrc(id),
        ),
        ratio: '4 / 3',
        who: 'anyServiceAnyShop',
        faces: false,
      };
    }
    case 'location': {
      const id = subject.locationId.value;
      return {
        covers: cover(
          id,
          catalog.locationName(id),
          null,
          catalog.locationCoverSrc(id),
        ),
        ratio: '16 / 9',
        who: 'anyBarberAnyService',
        faces: true,
      };
    }
    default:
      return {
        covers: [],
        ratio: '16 / 9',
        who: 'anyBarberAnyShop',
        faces: true,
      };
  }
}

/** DF — «Как се печели»: ONE block (DV-B); `null` for a family no longer awarded. */
function howOf(
  series: BadgeSeries,
  data: AchievementsData,
  ctx: AchievementsContext,
  rule: RhythmRuleWords | null,
): DetailHowVm | null {
  if (series.isRetired()) return null;
  const shown = subjectShownOf(series, ctx);
  return {
    sentence: howSentenceOf(series, ctx, rule),
    ...detailCovers(shown.covers, shown.ratio),
    faces: shown.faces ? barberFacesOf(data, ctx) : [],
    who: ctx.words.achievement.who(shown.who),
    excluded: countsVisits(series) ? ctx.words.achievement.excluded : null,
    steps: [],
  };
}

// ── DH · the ladder of medals ───────────────────────────────────────────

/**
 * What a level gives: «50 точки», a coupon by its name, the rhythm's
 * protections as «Ритъм» words them; a level that pays nothing a client
 * can hold gives the badge itself, «Значка в профила».
 */
function rewardOf(level: BadgeLevel, ctx: AchievementsContext): string {
  const locale = localeOf(ctx);
  const given = level.awards.flatMap((award) => {
    switch (award.kind) {
      case 'points':
        return [ctx.words.achievement.awardPoints(award.points)];
      case 'coupon':
        return [award.title.get(locale)];
      case 'freeze':
        return [ctx.words.rhythm.protections(award.count)];
      case 'perk':
        return [];
    }
  });
  return given.length === 0
    ? ctx.words.achievement.awardBadge
    : given.join(' · ');
}

/** The family's count is a count of VISITS: a kind of visit, or the rhythm's run (`metric: null`, with targets). */
function countedInVisits(series: BadgeSeries): boolean {
  switch (series.metric?.metric) {
    case undefined:
      return !isOneOff(series);
    case 'client.visits.completed':
    case 'client.visits.earlyBird':
    case 'client.visits.weekend':
    case 'client.visits.onTime':
    case 'client.visits.party':
      return true;
    default:
      return false;
  }
}

/**
 * A level's threshold in the fewest words: a family that counts visits
 * says «25 посещения» (what kind of visit is the progress card's and the
 * sentence's to say, once); every other family says the level's own
 * requirement as the catalogue words it («2 години с нас»).
 */
function thresholdOf(
  series: BadgeSeries,
  level: BadgeLevel,
  ctx: AchievementsContext,
): string {
  return level.target !== null && countedInVisits(series)
    ? asOneUnit(ctx.words.visitsModule.sectionVisits(level.target))
    : level.requirement.get(localeOf(ctx));
}

/**
 * DH — every level as a medal of its own: a passed level a full ring with
 * ITS numeral and the day it was earned, the rest dashed silhouettes; the
 * next level's words in primary ink, the later ones quiet. A single act is
 * one «Награда» row. An ended season's ladder is the levels it reached.
 */
function ladderOf(
  series: BadgeSeries,
  standing: SeriesStanding,
  progress: BadgeProgress | null,
  face: MedalVm,
  data: AchievementsData,
  ctx: AchievementsContext,
): readonly DetailLevelVm[] {
  const words = ctx.words.achievement;
  const lang = ctx.words.lang;
  const locale = localeOf(ctx);
  const oneOff = isOneOff(series);
  const open = canStillMove(series, standing, data);
  const levels = inEndedSeason(series, data)
    ? series.levels.filter((level) => level.level <= standing.highestLevel)
    : series.levels;
  return levels.map((level) => {
    const earned =
      progress?.earned.find((entry) => entry.level === level.level) ?? null;
    const passed = earned !== null;
    const numeral = levelNumeral(level.level);
    const reward = rewardOf(level, ctx);
    const accessibleName = words.levelRowName(
      numeral,
      oneOff ? level.requirement.get(locale) : thresholdOf(series, level, ctx),
      reward,
      earned === null
        ? null
        : dayLong(sofiaDayOf(earned.earnedAt), data.today, lang),
    );
    return {
      level: level.level,
      medal: {
        seriesId: face.seriesId,
        state: passed ? 'complete' : 'notStarted',
        icon: face.icon,
        src: face.src,
        monogram: face.monogram,
        // A single act wears no numeral: there is no second level to tell it from.
        level: passed && !oneOff ? numeral : null,
        title: null,
        caption: null,
        value: null,
        valueText: null,
        isNew: false,
        accessibleName,
      },
      title: oneOff
        ? words.awardOneOff
        : words.levelRow(numeral, thresholdOf(series, level, ctx)),
      reward,
      earnedOn: earned === null ? null : medalDay(earned.earnedAt, lang),
      tone: passed
        ? 'passed'
        : open && standing.next?.level === level.level
          ? 'next'
          : 'later',
      accessibleName,
    };
  });
}

// ── DI · the visits that counted ────────────────────────────────────────

/**
 * DI — the loaded visits that counted, newest first, five at most, as the
 * shared staff rows «Посещения» files them (`visitsRows`, §7.3: the month
 * grain, the weekday over the day on the tile, the staff's fact ending the
 * second line). The visit on screen leads them while it is open and its
 * draft holds what counts («Този час»): the progress card says what it
 * adds.
 */
function countedVisitsOf(
  series: BadgeSeries,
  standing: SeriesStanding,
  data: AchievementsData,
  ctx: AchievementsContext,
  extra: MedalDetailExtra,
): readonly VisitRowVm[] {
  const rows = extra.rows;
  if (rows === null) return [];
  const current = thisVisitCounts(series, standing, data, ctx)
    ? rows.currentAppointmentId
    : null;
  const counted = extra.visits
    .filter(
      (visit) =>
        (current !== null && visit.id.value === current) ||
        (countsToward(series, visit, extra.subjectUserId) &&
          insideWindows(series, visit, data)),
    )
    .sort((a, b) => b.timeSlot.start.toMillis() - a.timeSlot.start.toMillis());
  return visitsRows({ ...rows, appointments: counted }).slice(
    0,
    COUNTED_VISITS_LIMIT,
  );
}

// ── DJ · the neighbours ─────────────────────────────────────────────────

/** DJ — «Още от Майсторство»: the first three neighbours, each drawn as its grid draws it. */
function neighboursOf(
  series: BadgeSeries,
  data: AchievementsData,
  ctx: AchievementsContext,
): DetailRelatedVm | null {
  const related = relatedOf(series, data, ctx);
  if (related === null) return null;
  return {
    ...related,
    tiles: related.tiles.slice(0, RELATED_LIMIT).map((tile) => {
      const family = data.catalog.series(tile.medal.seriesId);
      return family === null
        ? tile
        : { ...tile, medal: medalRingVm(family, data, ctx, 'large') };
    }),
  };
}

// ── The page ────────────────────────────────────────────────────────────

/** What the page hands over beside the store's data and context. */
export interface MedalDetailExtra {
  /** The history's loaded pages (`ClientCardStore.loadedVisits`). */
  readonly visits: readonly Appointment[];
  readonly subjectUserId: string;
  /** The rhythm's rule in force, worded (`rhythmRuleWords`); `null` while it is not known, or off. */
  readonly rule: RhythmRuleWords | null;
  /** What the staff rows are worded with (`ClientCardStore.visitRowsInput`); `null` until the history is read: no rows. */
  readonly rows: HistoryRowsInput | null;
  /** The dock's verb, as the store answers it (`detailActionOf`). */
  readonly action: DetailActionVm | null;
}

/** One medal family's page (§2.4); `null` for a family the catalogue lacks. */
export function medalDetailVm(
  seriesId: string,
  data: AchievementsData,
  ctx: AchievementsContext,
  extra: MedalDetailExtra,
): MedalDetailVm | null {
  const series = data.catalog.series(seriesId);
  if (series === null) return null;
  const progress = progressOf(data, series);
  const standing = series.standing(progress);
  // The hero stands alone on its stage: the title and the state line say it.
  const medal: MedalVm = {
    ...medalRingVm(series, data, ctx, 'extraLarge'),
    title: null,
    caption: null,
  };
  return {
    seriesId: series.id.value,
    categoryId: series.categoryId?.value ?? null,
    title: series.title.get(localeOf(ctx)),
    medal,
    stateLine: stateLineOf(series, standing, progress, data, ctx),
    progress: progressCardOf(series, standing, progress, data, ctx),
    how: howOf(series, data, ctx, extra.rule),
    ladder: ladderOf(series, standing, progress, medal, data, ctx),
    visits: countedVisitsOf(series, standing, data, ctx, extra),
    related: neighboursOf(series, data, ctx),
    // A family that cannot move offers no verb, whatever it was handed.
    action: canStillMove(series, standing, data) ? extra.action : null,
  };
}

// ── The bridge: legacy shapes → ecs-core structs (Phase 4 deletes it) ────

/** The last minute of a shop day: what a visit with no start yet is held to. */
const LAST_MINUTE_OF_DAY = 1439;

/** A shop day the card holds: a guarded document day, a clock's «today», a start's own day. */
function dayOf(raw: string): LocalDate {
  const day = LocalDate.parse(raw);
  return day.ok ? day.value : defect(`${raw} is no calendar day`);
}

/** A wall-clock minute a `ZonedDateTime` read: always inside the day. */
function minuteOf(raw: number): MinuteOfDay {
  const minute = MinuteOfDay.of(raw);
  return minute.ok ? minute.value : defect(`${raw} is no minute of a day`);
}

/** An instant a `ZonedDateTime` held: always inside the brand's window. */
function utcOf(epochMs: number): UtcEpochMs {
  const utc = UtcEpochMs.of(epochMs);
  return utc.ok ? utc.value : defect(`${epochMs} is not an instant`);
}

/** A family's metric as `AchievementsSystem` reads it: flat, every part present, absent is `null`. */
function metricRefOf(metric: NonNullable<BadgeSeries['metric']>): MetricRef {
  const where = metric.where;
  return {
    metric: metric.metric as MetricRef['metric'],
    metricWindowDays: metric.window?.lastDays ?? null,
    metricScopeServiceId:
      where?.serviceId === undefined
        ? null
        : ServiceRefId.of(where.serviceId.value),
    metricScopeBarberId:
      where?.barberId === undefined
        ? null
        : BarberRefId.of(where.barberId.value),
    metricScopeLocationId:
      where?.locationId === undefined
        ? null
        : LocationRefId.of(where.locationId.value),
  };
}
