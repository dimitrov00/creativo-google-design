import {
  AnalyticsPeriod,
  type AnalyticsReport,
  AnalyticsSpan,
} from '@core/components';
import { type LocationId, MinuteCount } from '@core/primitives';
import {
  AnalyticsCarouselSystem,
  type AnalyticsScopeBarber,
  StaffAnalyticsSystem,
} from '@core/systems';
import {
  formatCount,
  formatPercent,
  formatWeekdayLabels,
} from '@creativo/ui/wall-clock';
import { spanWords } from '@creativo/features/shared/visits';
import type { UiChoiceOption } from '@creativo/ui/controls';
import type { UiIconName } from '@creativo/ui/icons';
import {
  type AnalyticsScreenInput,
  blockedOf,
  bodyOf,
  money,
  periodLabelOf,
  rangeDateText,
  shopNameOf,
  statusOf,
} from './analytics.presenter';
import {
  ANALYTICS_SCOPE_ALL,
  AnalyticsCard,
  AnalyticsScopeOption,
  AnalyticsTile,
  AnalyticsTool,
  type AnalyticsAheadCardVm,
  type AnalyticsBentoCardVm,
  type AnalyticsBonesVm,
  type AnalyticsHomeVm,
  type AnalyticsLocationRowVm,
  type AnalyticsLocationsCardVm,
  type AnalyticsMenuVm,
  type AnalyticsPaceVm,
  type AnalyticsPageVm,
  type AnalyticsTeamCardVm,
  type AnalyticsToolRowVm,
} from './analytics-home.vm';
import { AnalyticsLoad, type AnalyticsBodyVm } from './analytics.vm';

/*
 * THE REVOLUT-LAYOUT HOME (`docs/designs/staff-analytics-v3-revolut.md`,
 * Law 10) — the screen's state, the carousel's pages and each page's report
 * in, the display struct out. It decides nothing: which pages exist and how
 * far back each sits are `AnalyticsCarouselSystem`'s; a card's figures are
 * the v2 presenter's body (`bodyOf`), so a card and the screen behind it
 * print the same words; the highlighted bucket, the rostered time so far
 * and the tips' share are the system's.
 */

/** The screen as the v2 presenter takes it, plus the carousel. */
export interface AnalyticsHomeInput extends AnalyticsScreenInput {
  /** The carousel's pages, oldest first (`AnalyticsCarouselSystem.pagesOf`). */
  readonly pages: readonly AnalyticsPeriod[];
  /** The page on screen. */
  readonly pageIndex: number;
  /** Each page's report, in `pages`' order — `null` while not on the device. */
  readonly pageReports: readonly (AnalyticsReport | null)[];
  /** The last report of the scope on screen (the store's `shapeReport`): the shape a loading page's bones take. */
  readonly shapeReport: AnalyticsReport | null;
}

/** The grains the period menu offers, in its order. */
const GRAINS = [
  AnalyticsSpan.Day,
  AnalyticsSpan.Week,
  AnalyticsSpan.Month,
  AnalyticsSpan.Year,
] as const;

/** The identity tones, in the catalogue's barber order. */
const IDENTITY_TONES = 5;

/** The home screen. */
export function analyticsHomeVm(input: AnalyticsHomeInput): AnalyticsHomeVm {
  const { words } = input;
  const current = input.report;
  const bones = bonesOf(input);
  const body =
    current === null || input.analyticsLoad === AnalyticsLoad.Refused
      ? null
      : bodyOf(input, current);
  return {
    title: words.title,
    backLabel: words.back,
    freshness: statusOf(input),
    retryLabel: words.freshness.retry,
    scope: scopeMenuOf(input),
    period: periodMenuOf(input),
    pages: input.pages.map((period, index) =>
      pageOf(input, period, input.pageReports.at(index) ?? null, bones),
    ),
    pageIndex: input.pageIndex,
    blocked: blockedOf(input),
    notice: input.scopeGone ? words.freshness.scopeGone : null,
    goal: body?.goal ?? null,
    ahead:
      current === null || body === null ? null : aheadOf(input, body, current),
    toolsTitle: words.home.tools,
    tools: toolsOf(input, body),
  };
}

// ── The top row ───────────────────────────────────────────────────────────

/** Past this many minutes a span is said in whole hours. */
const TEN_HOURS = 600;

/** The shop's disc — beside the barbers' faces in the scope menu and its trigger. */
const SHOP_GLYPH = 'location.shop' satisfies UiIconName;
/** The whole team's disc on its row. */
const TEAM_GLYPH = 'nav.team' satisfies UiIconName;

/**
 * THE SCOPE MENU (owner review 2026-11-09, round 2: "the selection is
 * either salons either barbers right?"): two FILTERS in force at once,
 * never a choice between them — so neither row is "chosen". Each row is
 * iOS's nested picker row: the dimension («Салони», «Екип»), its value
 * under it («Всички», «Център», «Нико Димов, Аз») and a chevron. It opens
 * its submenu: an «all» box alone at the head (ticked while nothing is
 * narrowed — it picks the row whole), then a box per location or per
 * barber, the admin's own first («Аз»). The trigger names what is
 * narrowed: «Център», «2 салона», «Нико Димов», «3 бръснари», the two
 * joined by a dot; the shop's name when nothing is.
 */
function scopeMenuOf(input: AnalyticsScreenInput): AnalyticsMenuVm | null {
  const menu = input.scopeMenu;
  if (menu === null) return null;
  const { words } = input;
  const locations = input.scopeLocationIds;
  const barbers = input.scopeBarberIds;
  const locationName = (id: LocationId) =>
    input.names.locationName(id) ?? words.scope.shop;
  const barberName = (row: AnalyticsScopeBarber) =>
    row.scopeMine
      ? words.scope.me
      : (input.names.barberName(row.barberId) ?? words.scope.barber);
  const named = (row: AnalyticsScopeBarber) => barberName(row);
  const options: UiChoiceOption[] = [];
  if (menu.locationIds.length > 0) {
    options.push({
      id: AnalyticsScopeOption.Locations,
      label: words.scope.shopsGroup,
      // The value: «Всички», or the salons ticked, in the shop's order.
      description:
        locations.length === 0
          ? words.scope.all
          : menu.locationIds
              .filter((id) => locations.includes(id))
              .map(locationName)
              .join(', '),
      icon: SHOP_GLYPH,
      avatarSrc: null,
      testId: 'analytics-scope-shop',
      childrenTitle: words.scope.shopsGroup,
      children: [
        {
          id: ANALYTICS_SCOPE_ALL,
          label: words.scope.shopOf(menu.locationIds.length),
          icon: SHOP_GLYPH,
          avatarSrc: null,
          all: true,
          checked: locations.length === 0,
          testId: 'analytics-scope-locations-all',
        },
        ...menu.locationIds.map((id): UiChoiceOption => ({
          id,
          label: locationName(id),
          icon: SHOP_GLYPH,
          avatarSrc: null,
          checked: locations.includes(id),
          testId: `analytics-scope-location-${id}`,
        })),
      ],
    });
  }
  options.push({
    id: AnalyticsScopeOption.Team,
    label: words.scope.teamGroup,
    // The value: «Всички», or the barbers ticked, in the menu's order.
    description:
      barbers.length === 0
        ? words.scope.all
        : menu.barbers
            .filter((row) => barbers.includes(row.barberId))
            .map(named)
            .join(', '),
    icon: TEAM_GLYPH,
    avatarSrc: null,
    testId: 'analytics-scope-team',
    childrenTitle: words.scope.teamGroup,
    children: [
      {
        id: ANALYTICS_SCOPE_ALL,
        label: words.scope.wholeTeam,
        icon: TEAM_GLYPH,
        avatarSrc: null,
        all: true,
        checked: barbers.length === 0,
        testId: 'analytics-scope-team-all',
      },
      ...menu.barbers.map((row): UiChoiceOption => ({
        id: row.barberId,
        label: barberName(row),
        avatarSrc: input.names.barberAvatarSrc(row.barberId),
        checked: barbers.includes(row.barberId),
        testId: `analytics-scope-${row.barberId}`,
      })),
    ],
  });
  const shopsPart =
    locations.length === 0
      ? null
      : locations.length === 1
        ? locationName(locations[0] as LocationId)
        : words.scope.shopsCount(locations.length);
  const sole =
    barbers.length === 1
      ? menu.barbers.find((row) => row.barberId === barbers[0])
      : undefined;
  const teamPart =
    barbers.length === 0
      ? null
      : sole !== undefined
        ? named(sole)
        : words.scope.barbersCount(barbers.length);
  const label =
    [shopsPart, teamPart].filter((part) => part !== null).join(' · ') ||
    shopNameOf(input);
  return {
    label,
    menuLabel: words.scope.label,
    options,
    selected: null,
    leading: {
      avatarSrc:
        sole === undefined ? null : input.names.barberAvatarSrc(sole.barberId),
      name: teamPart ?? label,
      icon: sole === undefined ? SHOP_GLYPH : null,
    },
    testId: 'analytics-scope-menu',
  };
}

/** «Тази седмица» · «Миналата седмица» · «Септември 2026» — the page on screen. */
export function pageLabelOf(
  period: AnalyticsPeriod,
  input: AnalyticsScreenInput,
): string {
  const { words } = input;
  const back = AnalyticsCarouselSystem.stepsBackOf(period, input.today);
  if (period.analyticsSpan !== AnalyticsSpan.Custom) {
    if (back === 0) return words.home.now[period.analyticsSpan];
    if (back === 1) return words.home.last[period.analyticsSpan];
  }
  return periodLabelOf(period, input);
}

function periodMenuOf(input: AnalyticsHomeInput): AnalyticsMenuVm {
  const { words } = input;
  const span = input.period.analyticsSpan;
  return {
    label: pageLabelOf(input.period, input),
    menuLabel: words.home.grainLabel,
    options: GRAINS.map((grain): UiChoiceOption => ({
      id: grain,
      label: words.home.grain[grain],
      testId: `analytics-grain-${grain}`,
    })),
    selected: span === AnalyticsSpan.Custom ? null : span,
    leading: null,
    testId: 'analytics-period-menu',
  };
}

// ── A page of the carousel ────────────────────────────────────────────────

/** No loaded page to take the shape from (the first load): the cards' bones alone. */
const NO_BONES: AnalyticsBonesVm = { teamRows: [], locationRows: [] };

/** `[0 … n)`, the rows a list of bones tracks by. */
const rowsOf = (n: number): readonly number[] =>
  Array.from({ length: n }, (_, i) => i);

/**
 * The shape of a page still loading: the one the last report of this
 * scope has — kept by the store while the carousel swipes past the
 * pages it has, since they are dropped from `pageReports` — with the same rule that
 * shows its team card (`screenOf(…).shopScope`) and its locations card (a
 * report carries `reportLocations` only over two or more).
 */
function bonesOf(input: AnalyticsHomeInput): AnalyticsBonesVm {
  const shape = input.shapeReport ?? input.report;
  if (shape === null) return NO_BONES;
  return {
    teamRows: rowsOf(
      StaffAnalyticsSystem.screenOf(shape).shopScope
        ? shape.reportBarbers.length
        : 0,
    ),
    locationRows: rowsOf(shape.reportLocations.length),
  };
}

function pageOf(
  input: AnalyticsHomeInput,
  period: AnalyticsPeriod,
  report: AnalyticsReport | null,
  bones: AnalyticsBonesVm,
): AnalyticsPageVm {
  const query = {
    span: period.analyticsSpan,
    from: period.fromLocalDate,
    to:
      period.analyticsSpan === AnalyticsSpan.Custom ? period.toLocalDate : null,
    // A list in the URL is one comma-joined parameter.
    barber: input.scopeBarberIds.join(',') || null,
    location: input.scopeLocationIds.join(',') || null,
  };
  const key = `${period.analyticsSpan}-${period.fromLocalDate}`;
  const label = pageLabelOf(period, input);
  if (report === null) {
    return {
      key,
      label,
      cards: null,
      team: null,
      locations: null,
      query,
      bones,
    };
  }
  const pageInput: AnalyticsScreenInput = { ...input, period, report };
  const body = bodyOf(pageInput, report);
  return {
    key,
    label,
    cards: cardsOf(pageInput, body, report),
    team: StaffAnalyticsSystem.screenOf(report).shopScope
      ? teamOf(pageInput, report)
      : null,
    // The report carries the comparison only over two or more locations
    // (`StaffAnalyticsSystem.comparedLocationsOf`).
    locations:
      report.reportLocations.length > 0 ? locationsOf(pageInput, report) : null,
    query,
    bones,
  };
}

function cardsOf(
  input: AnalyticsScreenInput,
  body: AnalyticsBodyVm,
  report: AnalyticsReport,
): readonly AnalyticsBentoCardVm[] {
  const { words } = input;
  const lang = words.lang;
  const card = (
    fields: Omit<AnalyticsBentoCardVm, 'accessibleName' | 'testId'>,
  ): AnalyticsBentoCardVm => ({
    ...fields,
    accessibleName: [
      fields.title,
      fields.value,
      fields.delta,
      fields.detail,
      fields.pace === null
        ? null
        : `${fields.pace.currentLabel} ${fields.pace.currentValue}`,
      fields.pace?.previousLabel && fields.pace.previousValue
        ? `${fields.pace.previousLabel} ${fields.pace.previousValue}`
        : null,
    ]
      .filter((part): part is string => part !== null && part !== '')
      .join(', '),
    testId: `analytics-card-${fields.card}`,
  });

  // «Оборот»: the figure, its change, and its PACE — the running total
  // against the previous period's by the same day (a barber's "where am I
  // against last month"); a lone bucket (a day) has no line to draw.
  const pace = AnalyticsCarouselSystem.paceOf(report, input.today);
  const previous = AnalyticsPeriod.previous(input.period);
  const takingsPace: AnalyticsPaceVm | null =
    pace.slots < 2
      ? null
      : {
          values: pace.current,
          comparison: pace.previous,
          slots: pace.slots,
          startLabel:
            rangeDateText(input.period.fromLocalDate, input) ??
            input.period.fromLocalDate,
          endLabel:
            rangeDateText(input.period.toLocalDate, input) ??
            input.period.toLocalDate,
          currentLabel: pageLabelOf(input.period, input),
          currentValue: money(report.reportTakingsCents, lang),
          previousLabel:
            pace.previousSoFar === null ? null : pageLabelOf(previous, input),
          previousValue:
            pace.previousSoFar === null
              ? null
              : money(pace.previousSoFar, lang),
        };

  // «Работно време»: worked against the roster so far.
  const rosteredSoFar = AnalyticsCarouselSystem.rosteredSoFarOf(report);
  const worked = spanWords(report.reportWorkedMinutes, words.spanWords);
  // The roster's whole is said in hours past ten («от 131 ч»).
  const rostered = spanWords(
    rosteredSoFar >= TEN_HOURS
      ? MinuteCount.roundToHour(rosteredSoFar)
      : rosteredSoFar,
    words.spanWords,
  );

  // «Бакшиши»: the tips and their share of the takings.
  const tipsShare = AnalyticsCarouselSystem.tipsShareOf(report);

  // The clients' two rates, as the v2 tiles word them.
  // «Работно време»: how full the roster was. «Свободно време»: what no
  // one booked or can still book, by weekday. «Клиенти»: who came.
  const occupancy = AnalyticsCarouselSystem.occupancyOf(report);
  const free = AnalyticsCarouselSystem.freeMinutesOf(report);
  const freeWeek = AnalyticsCarouselSystem.freeWeekOf(report);
  const weekdayLabels = formatWeekdayLabels(lang);
  const served = AnalyticsCarouselSystem.servedOf(report);

  return [
    card({
      card: AnalyticsTile.Takings,
      screen: AnalyticsCard.Takings,
      title: words.home.takings,
      value: body.hero.value,
      delta: body.hero.delta,
      trend: body.hero.trend,
      detail: takingsPace === null ? body.hero.comparison : null,
      spark: null,
      pace: takingsPace,
      bar: null,
      ring: null,
      wide: true,
    }),
    card({
      card: AnalyticsTile.Time,
      screen: AnalyticsCard.Time,
      title: words.home.time,
      value: worked,
      delta: null,
      trend: null,
      detail:
        occupancy === null
          ? words.home.timeDetail(rostered)
          : words.home.timeOccupancy(formatPercent(occupancy, lang), rostered),
      spark: null,
      pace: null,
      bar: null,
      ring: {
        value: report.reportWorkedMinutes,
        max: Math.max(rosteredSoFar, 1),
        label: words.home.time,
        valueText: `${worked} ${words.home.timeDetail(rostered)}`,
      },
      wide: false,
    }),
    card({
      card: AnalyticsTile.Free,
      screen: AnalyticsCard.Time,
      title: words.home.free,
      // Past ten hours the minutes are noise: «489 ч», not «489 ч 35 мин».
      value: spanWords(
        free >= TEN_HOURS ? MinuteCount.roundToHour(free) : free,
        words.spanWords,
      ),
      delta: null,
      trend: null,
      detail:
        freeWeek === null
          ? null
          : freeWeek.emptiest === null
            ? words.home.freeNone
            : words.home.freeDetail(weekdayLabels[freeWeek.emptiest - 1] ?? ''),
      spark:
        freeWeek === null
          ? null
          : {
              values: freeWeek.minutes,
              highlight:
                freeWeek.emptiest === null ? null : freeWeek.emptiest - 1,
              average: null,
              valueText: freeWeek.minutes.map((minutes) =>
                spanWords(minutes, words.spanWords),
              ),
              labels: weekdayLabels,
              label: words.home.freeWeek,
            },
      pace: null,
      bar: null,
      ring: null,
      wide: false,
    }),
    card({
      card: AnalyticsTile.Tips,
      screen: AnalyticsCard.Tips,
      title: words.home.tips,
      value: body.hero.tipsValue,
      delta: null,
      trend: null,
      detail:
        tipsShare === null
          ? words.home.tipsNone
          : words.home.tipsDetail(formatPercent(tipsShare, lang)),
      spark: null,
      pace: null,
      bar: null,
      ring: null,
      wide: false,
    }),
    card({
      card: AnalyticsTile.Clients,
      screen: AnalyticsCard.Rebooked,
      title: words.home.clients,
      value: formatCount(served, lang),
      delta: null,
      trend: null,
      detail: words.home.clientsDetail(
        words.home.clientsNew(report.reportNewClientCount),
        words.home.clientsMissed(report.reportNoShowCount),
      ),
      spark: null,
      pace: null,
      // Who came of everyone booked.
      bar: {
        value: served,
        max: Math.max(report.reportNoShowBase, 1),
        label: words.home.clients,
        valueText: `${formatCount(served, lang)} · ${words.home.clientsMissed(report.reportNoShowCount)}`,
      },
      ring: null,
      wide: false,
    }),
  ];
}

export function teamOf(
  input: AnalyticsScreenInput,
  report: AnalyticsReport,
): AnalyticsTeamCardVm {
  const { words } = input;
  const lang = words.lang;
  const best = report.reportBarbers.reduce(
    (max, row) => Math.max(max, row.takingsCents),
    0,
  );
  const rows = report.reportBarbers.map((row, index) => ({
    barberId: row.barberId,
    name: input.names.barberName(row.barberId) ?? words.scope.barber,
    value: money(row.takingsCents, lang),
    share: best > 0 ? row.takingsCents / best : 0,
    tone: index % IDENTITY_TONES,
  }));
  return {
    title: words.home.team,
    rows,
    accessibleName: [
      words.home.team,
      ...rows.map((row) => `${row.name} ${row.value}`),
    ].join(', '),
    testId: `analytics-card-${AnalyticsCard.Team}`,
  };
}

/**
 * The shop's locations compared (owner review 2026-11-09): a row per
 * location in the shop's order — its name, its takings, a bar against the
 * best one, its identity tone and its figures in a line.
 */
export function locationsOf(
  input: AnalyticsScreenInput,
  report: AnalyticsReport,
): AnalyticsLocationsCardVm {
  const { words } = input;
  const lang = words.lang;
  const best = report.reportLocations.reduce(
    (max, row) => Math.max(max, row.takingsCents),
    0,
  );
  const rows = report.reportLocations.map(
    (row, index): AnalyticsLocationRowVm => ({
      locationId: row.locationId,
      name: input.names.locationName(row.locationId) ?? words.scope.shop,
      value: money(row.takingsCents, lang),
      share: best > 0 ? row.takingsCents / best : 0,
      tone: index % IDENTITY_TONES,
      detail: words.card.locationDetail(
        formatPercent(row.occupancy ?? 0, lang),
        words.card.clientsCount(row.servedCount),
        words.home.clientsNew(row.newClientCount),
      ),
      testId: `analytics-location-${row.locationId}`,
    }),
  );
  return {
    title: words.home.locations,
    rows,
    accessibleName: [
      words.home.locations,
      ...rows.map((row) => `${row.name} ${row.value}`),
    ].join(', '),
    testId: `analytics-card-${AnalyticsCard.Locations}`,
  };
}

// ── Under the carousel ────────────────────────────────────────────────────

function aheadOf(
  input: AnalyticsScreenInput,
  body: AnalyticsBodyVm,
  report: AnalyticsReport,
): AnalyticsAheadCardVm {
  const { words } = input;
  const bars = body.open.bars;
  return {
    title: words.home.ahead,
    value: body.open.value,
    detail: words.home.aheadDetail,
    spark: {
      values: report.reportAheadDays.map((day) => day.openMinutes),
      highlight: bars.highlightIndex,
      average: null,
      valueText: bars.valueText,
      labels: bars.bars.map((bar) => bar.label),
      label: bars.label,
    },
    link: body.open.link,
    accessibleName: [words.home.ahead, body.open.value, words.home.aheadDetail]
      .filter(Boolean)
      .join(', '),
  };
}

function toolsOf(
  input: AnalyticsScreenInput,
  body: AnalyticsBodyVm | null,
): readonly AnalyticsToolRowVm[] {
  const { words } = input;
  if (body === null) return [];
  const rows: AnalyticsToolRowVm[] = [];
  const goal = body.goal;
  if (goal?.setLabel) {
    rows.push({
      tool: AnalyticsTool.Goal,
      title: goal.setLabel,
      detail: goal.ring === null ? words.home.goalNone : goal.ring.rangeText,
      testId: 'analytics-tool-goal',
    });
  }
  rows.push({
    tool: AnalyticsTool.Export,
    title: words.export.action,
    detail: words.home.exportDetail,
    testId: 'analytics-tool-export',
  });
  return rows;
}
