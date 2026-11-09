import {
  type AnalyticsPeriod,
  type AnalyticsReport,
  AnalyticsSpan,
} from '@core/components';
import { AnalyticsCarouselSystem, StaffAnalyticsSystem } from '@core/systems';
import { formatCount, formatPercent } from '@creativo/ui/wall-clock';
import { spanWords } from '@creativo/features/shared/visits';
import type { UiChoiceOption } from '@creativo/ui/controls';
import type { UiIconName } from '@creativo/ui/icons';
import {
  type AnalyticsScreenInput,
  blockedOf,
  bodyOf,
  money,
  periodLabelOf,
  scopeOf,
  shopNameOf,
  statusOf,
} from './analytics.presenter';
import {
  AnalyticsCard,
  AnalyticsScopeOption,
  AnalyticsTool,
  type AnalyticsAheadCardVm,
  type AnalyticsBentoCardVm,
  type AnalyticsHomeVm,
  type AnalyticsMenuVm,
  type AnalyticsPageVm,
  type AnalyticsSparkVm,
  type AnalyticsTeamCardVm,
  type AnalyticsToolRowVm,
} from './analytics-home.vm';
import {
  AnalyticsLoad,
  type AnalyticsScopeTileVm,
  AnalyticsTopic,
  type AnalyticsBodyVm,
} from './analytics.vm';

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
      pageOf(input, period, input.pageReports.at(index) ?? null),
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

/** A scope tile's menu id: the barber's id, `location:<id>`, or `shop`. */
function optionIdOf(tile: AnalyticsScopeTileVm): string {
  if (tile.scopeBarberId !== null) return tile.scopeBarberId;
  return tile.scopeLocationId === null
    ? AnalyticsScopeOption.Shop
    : `${AnalyticsScopeOption.LocationPrefix}${tile.scopeLocationId}`;
}

/** The shop's disc — beside the barbers' faces in the scope menu and its trigger. */
const SHOP_GLYPH = 'location.shop' satisfies UiIconName;

function scopeMenuOf(input: AnalyticsScreenInput): AnalyticsMenuVm | null {
  const scope = scopeOf(input);
  if (scope === null) return null;
  const selected = scope.tiles.find((tile) => tile.selected);
  const label = selected?.name ?? shopNameOf(input);
  const listsLocations = scope.tiles.some(
    (tile) => tile.scopeLocationId !== null,
  );
  return {
    label,
    menuLabel: scope.label,
    // Every option is a disc: a face, a monogram, or a shop's glyph. The
    // shops and the people are two sections; the shops' is captioned only
    // when it lists locations beside the whole.
    options: scope.tiles.map((tile): UiChoiceOption => ({
      id: optionIdOf(tile),
      label: tile.name,
      avatarSrc: tile.avatarSrc,
      ...(tile.scopeBarberId === null ? { icon: SHOP_GLYPH } : {}),
      group:
        tile.scopeBarberId !== null
          ? input.words.scope.teamGroup
          : listsLocations
            ? input.words.scope.shopsGroup
            : '',
      testId: tile.testId,
    })),
    selected: selected === undefined ? null : optionIdOf(selected),
    leading: {
      avatarSrc: selected?.avatarSrc ?? null,
      name: label,
      icon:
        selected === undefined || selected.scopeBarberId === null
          ? SHOP_GLYPH
          : null,
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

function pageOf(
  input: AnalyticsHomeInput,
  period: AnalyticsPeriod,
  report: AnalyticsReport | null,
): AnalyticsPageVm {
  const query = {
    span: period.analyticsSpan,
    from: period.fromLocalDate,
    to:
      period.analyticsSpan === AnalyticsSpan.Custom ? period.toLocalDate : null,
    barber: input.scopeBarberId,
    location: input.scopeLocationId,
  };
  const key = `${period.analyticsSpan}-${period.fromLocalDate}`;
  const label = pageLabelOf(period, input);
  if (report === null) return { key, label, cards: null, team: null, query };
  const pageInput: AnalyticsScreenInput = { ...input, period, report };
  const body = bodyOf(pageInput, report);
  return {
    key,
    label,
    cards: cardsOf(pageInput, body, report),
    team: StaffAnalyticsSystem.screenOf(report).shopScope
      ? teamOf(pageInput, report)
      : null,
    query,
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
    accessibleName: [fields.title, fields.value, fields.delta, fields.detail]
      .filter((part): part is string => part !== null && part !== '')
      .join(', '),
    testId: `analytics-card-${fields.card}`,
  });

  // «Оборот»: the figure, its change, the buckets as bars, the average.
  const series = body.series;
  const average = StaffAnalyticsSystem.seriesAverageCentsOf(report);
  const bucket = AnalyticsCarouselSystem.seriesBucketOf(report);
  const takingsSpark: AnalyticsSparkVm | null =
    series === null || series.points.length < 2
      ? null
      : {
          values: series.points.map((point) => point.value),
          highlight: AnalyticsCarouselSystem.latestBucketOf(
            report,
            input.today,
          ),
          average,
          valueText: series.valueText,
          labels: series.points.map((point) => point.label),
          label: series.label,
        };

  // «Работно време»: worked against the roster so far.
  const rosteredSoFar = AnalyticsCarouselSystem.rosteredSoFarOf(report);
  const worked = spanWords(report.reportWorkedMinutes, words.spanWords);
  const rostered = spanWords(rosteredSoFar, words.spanWords);

  // «Бакшиши»: the tips and their share of the takings.
  const tipsShare = AnalyticsCarouselSystem.tipsShareOf(report);

  // The clients' two rates, as the v2 tiles word them.
  const rebookedValue =
    body.clients.rows.find((row) => row.topic === AnalyticsTopic.Rebooked)
      ?.value ?? formatCount(report.reportRebookedCount, lang);

  return [
    card({
      card: AnalyticsCard.Takings,
      title: words.home.takings,
      value: body.hero.value,
      delta: body.hero.delta,
      trend: body.hero.trend,
      detail:
        takingsSpark === null || average === null
          ? body.hero.comparison
          : words.home.average[bucket](money(average, lang)),
      spark: takingsSpark,
      bar: null,
      ring: null,
      wide: true,
    }),
    card({
      card: AnalyticsCard.Time,
      title: words.home.time,
      value: worked,
      delta: null,
      trend: null,
      detail: words.home.timeDetail(rostered),
      spark: null,
      bar: {
        value: report.reportWorkedMinutes,
        max: Math.max(rosteredSoFar, 1),
        label: words.home.time,
        valueText: `${worked} ${words.home.timeDetail(rostered)}`,
      },
      ring: null,
      wide: false,
    }),
    card({
      card: AnalyticsCard.Tips,
      title: words.home.tips,
      value: body.hero.tipsValue,
      delta: null,
      trend: null,
      detail:
        tipsShare === null
          ? words.home.tipsNone
          : words.home.tipsDetail(formatPercent(tipsShare, lang)),
      spark: null,
      bar: null,
      ring: null,
      wide: false,
    }),
    card({
      card: AnalyticsCard.Rebooked,
      title: words.home.rebooked,
      value: rebookedValue,
      delta: null,
      trend: null,
      detail: words.home.rebookedDetail,
      spark: null,
      bar: null,
      ring: {
        value: report.reportRebookedCount,
        max: Math.max(report.reportRebookedBase, 1),
        label: words.home.rebooked,
        valueText: rebookedValue,
      },
      wide: false,
    }),
    card({
      card: AnalyticsCard.NoShows,
      title: words.home.noShows,
      value: formatCount(report.reportNoShowCount, lang),
      delta: null,
      trend: null,
      detail: words.home.noShowsDetail(
        formatCount(report.reportNoShowBase, lang),
      ),
      spark: null,
      bar: null,
      ring: {
        value: report.reportNoShowCount,
        max: Math.max(report.reportNoShowBase, 1),
        label: words.home.noShows,
        valueText: formatCount(report.reportNoShowCount, lang),
      },
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
