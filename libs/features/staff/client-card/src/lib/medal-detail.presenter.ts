import type { Appointment, BadgeProgress, BadgeSeries } from '@core/entities';
import {
  AwardKind,
  type BadgeSeriesId,
  type BarberId,
  type CustomerId,
  type LocalDate,
  type TimeZone,
  defect,
} from '@core/primitives';
import {
  type BadgeLevel,
  BadgeSubject,
  type EarnedLevel,
  LadderRung,
  MedalDetailState,
  MedalProgressCard,
  Metric,
  MetricRef,
  type SeriesStanding,
} from '@core/components';
import {
  AchievementsSystem,
  BadgeSystem,
  type CountedDraft,
  type CountedVisit,
  LoyaltyCatalogSystem,
  type MedalDetailReading,
  ZonedTimeSystem,
} from '@core/systems';
import {
  type RhythmRuleWords,
  type VisitRowVm,
  firstNameOf,
} from '@creativo/features/shared/visits';
import {
  type AchievementsContext,
  completesWithThisVisit,
  draftStart,
  draftVisitOf,
  familyOfMedal,
  inEndedSeason,
  isOneOff,
  isSingleLevel,
  landsOn,
  latestEarned,
  localeOf,
  progressOf,
  relatedOf,
  seasonOfSeries,
  seasonPhaseOfSeries,
  seriesById,
  standingOf,
} from './achievements.presenter';
import type { ClientCardCatalog } from './client-card.contracts';
import {
  NO_BREAK,
  dayLong,
  dayWithYear,
  figure,
  inSentence,
  levelNumeral,
} from './client-card.format';
import {
  AchievementHowWord,
  AchievementWhoWord,
  achievementMetricWord,
} from './client-card.words';
import {
  type AchievementsData,
  type DetailActionVm,
  type DetailFaceVm,
  type DetailHowVm,
  DetailLevelTone,
  type DetailLevelVm,
  type DetailPictureVm,
  type DetailRelatedVm,
  type LinePart,
  type MedalDetailVm,
  type MedalProgressVm,
  type MedalVm,
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
 * as every presenter of the card. The systems decide standing
 * (`BadgeSystem.standing`); `medalRingVm` decides how a family's medal is drawn,
 * here as on every grid, so the hero, a neighbour's tile and a tile of
 * «Постижения» never tell one family two ways. This file words the rest.
 *
 * The page's one verb («Добави фейд») is the DOCK's, never the body's
 * (DV-C): `detailActionOf` answers it for the store, and the view model
 * only carries what it was handed.
 */

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

/** A medal's day — a stored shop day a level was earned on (T5) — always names its year: a ladder spans years («24.09.2025 г.»). */
function dayWord(day: LocalDate, lang: string): string {
  return asOneUnit(dayWithYear(day, lang));
}

/** {@link dayWord} of an earned level. */
function medalDay(earned: EarnedLevel, lang: string): string {
  return dayWord(earned.earnedLocalDate, lang);
}

/**
 * The family can still move: it is awarded, its season (if it has one) has
 * not ended, and a level is left to earn. What cannot move offers no verb
 * and counts no visit (`BadgeSystem.canStillMove`).
 */
function canStillMove(
  series: BadgeSeries,
  standing: SeriesStanding,
  data: AchievementsData,
): boolean {
  return BadgeSystem.canStillMove(
    series,
    standing,
    inEndedSeason(series, data),
  );
}

// ── What counts ─────────────────────────────────────────────────────────

/**
 * One loaded visit as the client RECORD's counted visit (D29: whom the
 * shop served) — `AchievementsSystem.workedVisitOf`'s zone-free facts, and
 * the instant its worked start falls on, read on the shop's zone HERE, at
 * the edge (Law 7): the punctuality rule compares it with the arrival
 * stamp (T2); the visit's own instant when the minute names none. `null`
 * when the record holds no worked seat on it.
 */
function countedVisitOf(
  visit: Appointment,
  subjectCustomerId: CustomerId | null,
  zone: TimeZone,
): CountedVisit | null {
  if (subjectCustomerId === null) return null;
  const facts = AchievementsSystem.workedVisitOf(visit, subjectCustomerId);
  if (facts === null) return null;
  const start = ZonedTimeSystem.toUtc(
    facts.localDate,
    facts.startMinutes,
    zone,
  );
  return { ...facts, startUtcMs: start.ok ? start.value : visit.utcEpochMs };
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
 * `medalDetailVm` applies both (`AchievementsSystem.countsToward` over
 * the visit as counted, `countedVisitOf`).
 */
export function countsToward(
  series: BadgeSeries,
  visit: Appointment,
  subjectCustomerId: CustomerId | null,
  zone: TimeZone,
): boolean {
  const counted = countedVisitOf(visit, subjectCustomerId, zone);
  return counted !== null && AchievementsSystem.countsToward(series, counted);
}

/**
 * The visit on screen as a visit the counting rule can judge
 * (`AchievementsSystem.countedDraft`: a start or a shop the draft does
 * not hold yet is `null`, which never counts); `null` with no visit on
 * screen.
 */
function countedDraftOf(ctx: AchievementsContext): CountedDraft | null {
  const visit = ctx.visit;
  const draft = draftVisitOf(ctx);
  if (visit === null || draft === null) return null;
  return AchievementsSystem.countedDraft({
    start: draftStart(visit, ctx.zone),
    serviceIds: draft.serviceIds,
    barberIds: draft.barberIds,
    locationId: draft.locationId,
  });
}

/**
 * DE's third line — the visit on screen, still open, will count towards
 * the family once it is over: its DRAFT holds what the family counts (the
 * service, the barber, the shop, an early start, a weekend day). The same
 * measure as «с това посещение» (`completesWithThisVisit`), without asking
 * how far the next level is. What only the day itself decides is not
 * promised: whether the client arrives on time, whether company comes
 * (`AchievementsSystem.draftCountsToward`). The counted draft when it
 * counts, else `null`.
 */
function countingDraftOf(
  series: BadgeSeries,
  standing: SeriesStanding,
  data: AchievementsData,
  ctx: AchievementsContext,
): CountedDraft | null {
  const draft = countedDraftOf(ctx);
  return AchievementsSystem.draftCountsToward(
    series,
    standing,
    draft,
    seasonPhaseOfSeries(series, data),
    inEndedSeason(series, data),
  )
    ? draft
    : null;
}

/** {@link countingDraftOf}: whether the visit on screen counts towards the family. */
function thisVisitCounts(
  series: BadgeSeries,
  standing: SeriesStanding,
  data: AchievementsData,
  ctx: AchievementsContext,
): boolean {
  return countingDraftOf(series, standing, data, ctx) !== null;
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
  const draft = draftVisitOf(ctx);
  if (draft === null) return null;
  // Without the data only what the family and the visit say is read.
  const canMove =
    data === null || canStillMove(series, standingOf(series, data), data);
  const serviceId = AchievementsSystem.serviceToAdd(
    series,
    draft.serviceIds,
    canMove,
    gate,
  );
  if (serviceId === null) return null;
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

/**
 * Where the family stands as `BadgeSystem.detailState` reads it, worded: a
 * yearly act — how many times, and when last; an ended season's family —
 * that it closed, never how far a level it can no longer reach is; one
 * level earned — a single act, its day, never «Всички нива»; under way
 * with no level yet — how far is the progress card's to say; complete;
 * at a level since its day.
 */
function stateOf(
  reading: MedalDetailReading,
  ctx: AchievementsContext,
): StateSaid {
  const words = ctx.words.achievement;
  const lang = ctx.words.lang;
  const dated = (text: (day: string) => string): StateSaid => {
    const day = dayWord(
      reading.day ?? defect(`${reading.medalDetailState} without its day`),
      lang,
    );
    return { text: text(day), fact: day };
  };
  switch (reading.medalDetailState) {
    case MedalDetailState.Retired:
      return { text: words.retired, fact: null };
    case MedalDetailState.Repeated:
      return dated((day) => words.repeated(reading.count, day));
    case MedalDetailState.SeasonEnded:
      return { text: ctx.words.achievements.seasonEnded, fact: null };
    case MedalDetailState.OneOffEarned:
      return dated((day) => words.oneOffEarned(day));
    case MedalDetailState.OneOffNotYet:
    case MedalDetailState.UnderWay:
      return { text: words.oneOffNotYet, fact: null };
    case MedalDetailState.NotStarted:
      return { text: words.stateNotStarted, fact: null };
    case MedalDetailState.Complete:
      return { text: ctx.words.achievements.complete, fact: null };
    case MedalDetailState.CompleteSince:
      return dated((day) => words.completeSince(day));
    case MedalDetailState.LevelSince:
      return dated((day) => words.levelSince(levelNumeral(reading.level), day));
  }
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
      LoyaltyCatalogSystem.category(data.catalog, series.categoryId)?.title[
        locale
      ] ?? null
    );
  }
  if (series.seasonId !== null) {
    return seasonOfSeries(series, data)?.title[locale] ?? null;
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
  const reading = BadgeSystem.detailState(
    series,
    standing,
    progress,
    inEndedSeason(series, data),
    BadgeSystem.isRetired(series),
  );
  if (reading.medalDetailState === MedalDetailState.Retired) {
    return lineAround(ctx.words.achievement.retired, null);
  }
  const state = stateOf(reading, ctx);
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
  const own = inSentence(series.requirement[localeOf(ctx)], lang);
  const metric = series.metric;
  if (metric === null) return isOneOff(series) ? own : words.whatRhythm(count);
  if (metric !== Metric.VisitsCompleted) {
    return words.what(achievementMetricWord(metric), count);
  }
  if (series.metricScopeServiceId !== null) {
    const service = ctx.catalog.serviceName(series.metricScopeServiceId);
    return service === null
      ? own
      : words.whatService(inSentence(service, lang), count);
  }
  if (series.metricScopeBarberId !== null) {
    // A barber in a sentence goes by first name, as every line of the card
    // names him («при Иван»); the whole name is the faces' (DF), a list.
    const barber = ctx.catalog.barberName(series.metricScopeBarberId);
    return barber === null ? own : words.whatBarber(firstNameOf(barber), count);
  }
  if (series.metricScopeLocationId !== null) {
    const shop = ctx.catalog.locationName(series.metricScopeLocationId);
    return shop === null ? own : words.whatShop(shop, count);
  }
  return words.what(AchievementHowWord.Visits, count);
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
  const on = landsOn(series, standing, data);
  const card = BadgeSystem.progressCard(
    series,
    standing,
    progress,
    canStillMove(series, standing, data),
    on,
    thisVisitCounts(series, standing, data, ctx),
  );

  switch (card.medalProgressCard) {
    case MedalProgressCard.OneOff: {
      // A single act is one: «0 от 1» until done, its day once done.
      const last = latestEarned(progress);
      return {
        value: last === null ? figure(card.value, lang) : medalDay(last, lang),
        unit: card.unitShown ? words.progressOf(1) : null,
        what: whatOf(series, ctx, 1),
        remaining: null,
        thisVisit: completesWithThisVisit(series, data, ctx)
          ? standingAlone(ctx.words.achievements.withThisVisit, lang)
          : null,
      };
    }
    case MedalProgressCard.Complete:
      return {
        value: figure(card.value, lang),
        unit: null,
        what: whatOf(series, ctx, card.value),
        remaining: isSingleLevel(series)
          ? null
          : ctx.words.achievements.complete,
        thisVisit: null,
      };
    case MedalProgressCard.Stopped:
      return {
        value: figure(card.value, lang),
        unit: null,
        what: whatOf(series, ctx, card.value),
        remaining: null,
        thisVisit: null,
      };
    case MedalProgressCard.ToNext: {
      const target = card.target ?? defect('TO_NEXT without a threshold');
      const level = levelNumeral(BadgeSystem.nextLevelNumber(standing));
      return {
        value: figure(card.value, lang),
        unit: words.progressOf(target),
        what: whatOf(series, ctx, target),
        // Tenure is worded by the day its next level lands.
        remaining:
          on !== null
            ? words.stateToNextOn(level, asOneUnit(dayWithYear(on, lang)))
            : card.remaining === null
              ? null
              : words.remaining(card.remaining, level),
        thisVisit:
          card.projected === null
            ? null
            : words.thisVisitCounts(card.projected, target),
      };
    }
  }
}

// ── DF · «Как се печели» ────────────────────────────────────────────────

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
  const own = oneStop(series.requirement[localeOf(ctx)]);
  const metric = series.metric;
  if (metric === null) {
    return isOneOff(series) ? own : (rule?.sentence ?? own);
  }
  if (metric !== Metric.VisitsCompleted) {
    return words.how(achievementMetricWord(metric));
  }
  if (series.metricScopeServiceId !== null) {
    const service = ctx.catalog.serviceName(series.metricScopeServiceId);
    return service === null ? own : words.howService(inSentence(service, lang));
  }
  if (series.metricScopeBarberId !== null) {
    const barber = ctx.catalog.barberName(series.metricScopeBarberId);
    return barber === null ? own : words.howBarber(firstNameOf(barber));
  }
  if (series.metricScopeLocationId !== null) {
    const shop = ctx.catalog.locationName(series.metricScopeLocationId);
    return shop === null ? own : words.howShop(shop);
  }
  return words.how(AchievementHowWord.Visits);
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
  const ids: readonly BarberId[] =
    catalog.barberIds?.() ?? LoyaltyCatalogSystem.barberIds(data.catalog);
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
  const cover = (
    key: string,
    title: string | null,
    caption: string | null,
    src: string | null,
  ): readonly DetailPictureVm[] =>
    title === null ? [] : [{ key, title, caption, src, more: null }];
  switch (series.badgeSubject) {
    case BadgeSubject.Service: {
      const id = series.subjectServiceId;
      return {
        covers: cover(
          id,
          catalog.serviceName(id),
          catalog.servicePrice?.(id) ?? null,
          catalog.serviceCoverSrc(id),
        ),
        ratio: '16 / 9',
        who: AchievementWhoWord.AnyBarberAnyShop,
        faces: true,
      };
    }
    case BadgeSubject.Barber: {
      const id = series.subjectBarberId;
      return {
        covers: cover(
          id,
          catalog.barberName(id),
          null,
          catalog.barberAvatarSrc(id),
        ),
        ratio: '4 / 3',
        who: AchievementWhoWord.AnyServiceAnyShop,
        faces: false,
      };
    }
    case BadgeSubject.Location: {
      const id = series.subjectLocationId;
      return {
        covers: cover(
          id,
          catalog.locationName(id),
          null,
          catalog.locationCoverSrc(id),
        ),
        ratio: '16 / 9',
        who: AchievementWhoWord.AnyBarberAnyService,
        faces: true,
      };
    }
    default:
      return {
        covers: [],
        ratio: '16 / 9',
        who: AchievementWhoWord.AnyBarberAnyShop,
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
  if (BadgeSystem.isRetired(series)) return null;
  const shown = subjectShownOf(series, ctx);
  return {
    sentence: howSentenceOf(series, ctx, rule),
    ...detailCovers(shown.covers, shown.ratio),
    faces: shown.faces ? barberFacesOf(data, ctx) : [],
    who: ctx.words.achievement.who(shown.who),
    // A count made of visits ends on the exclusion, once.
    excluded: MetricRef.countsVisits(series.metric)
      ? ctx.words.achievement.excluded
      : null,
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
    switch (award.awardKind) {
      case AwardKind.Points:
        return [ctx.words.achievement.awardPoints(award.awardPoints)];
      case AwardKind.Coupon:
        return [award.awardCouponTitle[locale]];
      case AwardKind.Freeze:
        return [ctx.words.rhythm.protections(award.awardFreezeCount)];
      case AwardKind.Perk:
        return [];
    }
  });
  return given.length === 0
    ? ctx.words.achievement.awardBadge
    : given.join(' · ');
}

/**
 * A level's threshold in the fewest words: a family that counts visits
 * (`BadgeSystem.countsInVisits`) says «25 посещения» (what kind of visit
 * is the progress card's and the sentence's to say, once); every other
 * family says the level's own requirement as the catalogue words it («2
 * години с нас»).
 */
function thresholdOf(
  series: BadgeSeries,
  level: BadgeLevel,
  ctx: AchievementsContext,
): string {
  return level.target !== null && BadgeSystem.countsInVisits(series)
    ? asOneUnit(ctx.words.visitsModule.sectionVisits(level.target))
    : level.requirement[localeOf(ctx)];
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
  return BadgeSystem.ladder(
    series,
    standing,
    progress,
    canStillMove(series, standing, data),
    inEndedSeason(series, data),
  ).map((rung) => {
    const { level, earned } = rung;
    const passed = rung.ladderRung === LadderRung.Passed;
    const numeral = levelNumeral(level.level);
    const reward = rewardOf(level, ctx);
    const accessibleName = words.levelRowName(
      numeral,
      oneOff ? level.requirement[locale] : thresholdOf(series, level, ctx),
      reward,
      earned === null
        ? null
        : dayLong(earned.earnedLocalDate, data.today, lang),
    );
    return {
      level: level.level,
      medal: {
        seriesId: face.seriesId,
        familyId: face.familyId,
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
      earnedOn: earned === null ? null : medalDay(earned, lang),
      tone: LADDER_TONES[rung.ladderRung],
      accessibleName,
    };
  });
}

/** Where a rung stands, as the ladder's row draws it: the next level's words in primary ink, the later ones quiet. */
const LADDER_TONES = {
  [LadderRung.Passed]: DetailLevelTone.Passed,
  [LadderRung.Next]: DetailLevelTone.Next,
  [LadderRung.Later]: DetailLevelTone.Later,
} as const satisfies Record<LadderRung, DetailLevelTone>;

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
  // Each loaded visit as counted, read on the shop's zone here (the edge);
  // which of them counted, inside the family's windows, newest first, is
  // `AchievementsSystem.countedVisits`.
  const counted = AchievementsSystem.countedVisits(
    series,
    seasonOfSeries(series, data),
    extra.visits.map((appointment) => ({
      appointment,
      counted: countedVisitOf(appointment, extra.subjectCustomerId, ctx.zone),
    })),
    data.today,
    countingDraftOf(series, standing, data, ctx),
    rows.currentAppointmentId,
  );
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
      const family = familyOfMedal(data, tile.medal);
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
  /** The client RECORD the card is open on (D29) — whose seats count; `null` before it exists. */
  readonly subjectCustomerId: CustomerId | null;
  /** The rhythm's rule in force, worded (`rhythmRuleWords`); `null` while it is not known, or off. */
  readonly rule: RhythmRuleWords | null;
  /** What the staff rows are worded with (`ClientCardStore.visitRowsInput`); `null` until the history is read: no rows. */
  readonly rows: HistoryRowsInput | null;
  /** The dock's verb, as the store answers it (`detailActionOf`). */
  readonly action: DetailActionVm | null;
}

/** One medal family's page (§2.4); `null` for a family the catalogue lacks. */
export function medalDetailVm(
  seriesId: BadgeSeriesId,
  data: AchievementsData,
  ctx: AchievementsContext,
  extra: MedalDetailExtra,
): MedalDetailVm | null {
  const series = seriesById(data, seriesId);
  if (series === null) return null;
  const progress = progressOf(data, series);
  const standing = BadgeSystem.standing(series, progress);
  // The hero stands alone on its stage: the title and the state line say it.
  const medal: MedalVm = {
    ...medalRingVm(series, data, ctx, 'extraLarge'),
    title: null,
    caption: null,
  };
  return {
    seriesId: series.id,
    categoryId: series.categoryId,
    title: series.title[localeOf(ctx)],
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
