import {
  AnalyticsBarPart,
  AnalyticsFigure,
  AnalyticsRangePreset,
  type AnalyticsReport,
  AnalyticsSpan,
} from '@core/components';
import type { LocationId } from '@core/primitives';
import { AnalyticsCarouselSystem, StaffAnalyticsSystem } from '@core/systems';
import {
  formatCentsWhole,
  formatCount,
  formatDayLong,
  formatMonthLong,
  formatPercent,
} from '@creativo/ui/wall-clock';
import { spanWords } from '@creativo/features/shared/visits';
import type { UiChartPart } from '@creativo/ui/charts';
import type { UiIconName, UiSegment } from '@creativo/ui/controls';
import {
  type AnalyticsScreenInput,
  blockedOf,
  bodyOf,
  money,
  REPORT_CURRENCY,
  serviceToneOf,
  statusOf,
} from './analytics.presenter';
import { locationsOf, pageLabelOf, teamOf } from './analytics-home.presenter';
import { AnalyticsCard } from './analytics-home.vm';
import {
  type AnalyticsCardChartVm,
  type AnalyticsCardScreenVm,
  AnalyticsChartView,
  type AnalyticsRangeRowVm,
  type AnalyticsRingSegmentVm,
} from './analytics-card.vm';
import {
  AnalyticsTopic,
  BAR_PART_HOOKS,
  TIME_POINT_FIELDS,
  type AnalyticsBodyVm,
  type AnalyticsChartBarVm,
} from './analytics.vm';

/*
 * A CARD'S OWN SCREEN (`docs/designs/staff-analytics-v3-revolut.md`, Law 10)
 * — the store's report, the card and the view the switch picked in, the
 * screen out. It decides nothing: which chip the period is, the series'
 * bucket, the tips per bucket and the bucket to stress are
 * `AnalyticsCarouselSystem`'s; the figures, the services, the time parts,
 * the heatmap, the clients and the radars are the v2 presenter's body, so a
 * card's screen prints what its card printed.
 */

/** The screen as the v2 presenter takes it, plus the card and the view picked. */
export interface AnalyticsCardInput extends AnalyticsScreenInput {
  readonly card: AnalyticsCard;
  /** The switch's pick; `null` is the card's first view. */
  readonly view: AnalyticsChartView | null;
  /** The locations whose line the screen's toggles turned off. */
  readonly hiddenLocationIds: readonly LocationId[];
  /**
   * The time part a tap on its «Време» row focused: the chart above draws
   * it alone, at its own scale; `null` draws every part stacked (owner,
   * 2026-11-09: the list "has to be somehow related to the upper one").
   */
  readonly focusedPart: AnalyticsBarPart | null;
}

/** Each view's glyph on the switch. */
const VIEW_ICONS = {
  [AnalyticsChartView.Line]: 'chart.line',
  [AnalyticsChartView.Bars]: 'chart.bars',
  [AnalyticsChartView.Ring]: 'chart.ring',
} as const satisfies Record<AnalyticsChartView, UiIconName>;

/** Each card's figure — what a tap on it opens (`analyticsDrillVm`); the team has none. */
const CARD_FIGURES = {
  [AnalyticsCard.Takings]: AnalyticsFigure.Takings,
  [AnalyticsCard.Time]: AnalyticsFigure.Time,
  [AnalyticsCard.Tips]: AnalyticsFigure.Tips,
  [AnalyticsCard.Rebooked]: AnalyticsFigure.Rebooked,
  [AnalyticsCard.NoShows]: AnalyticsFigure.NoShows,
  [AnalyticsCard.Team]: null,
  [AnalyticsCard.Locations]: null,
} as const satisfies Record<AnalyticsCard, AnalyticsFigure | null>;

/** Each card's ⓘ topic — its definition. */
const CARD_TOPICS = {
  [AnalyticsCard.Takings]: AnalyticsTopic.Takings,
  [AnalyticsCard.Time]: AnalyticsTopic.Time,
  [AnalyticsCard.Tips]: AnalyticsTopic.Tips,
  [AnalyticsCard.Rebooked]: AnalyticsTopic.Rebooked,
  [AnalyticsCard.NoShows]: AnalyticsTopic.NoShows,
  [AnalyticsCard.Team]: AnalyticsTopic.Radars,
  // The locations compare their takings: the takings' definition.
  [AnalyticsCard.Locations]: AnalyticsTopic.Takings,
} as const satisfies Record<AnalyticsCard, AnalyticsTopic>;

/** The identity tones the team paints with, in the catalogue's order. */
const IDENTITY_TONES = 5;

/** The time parts in the legend's order. */
const TIME_PARTS: readonly AnalyticsBarPart[] = Object.values(AnalyticsBarPart);

/** Each card's ⓘ topic, for the page's alert. */
export function cardTopicOf(card: AnalyticsCard): AnalyticsTopic {
  return CARD_TOPICS[card];
}

/** A card's screen. */
export function analyticsCardVm(
  input: AnalyticsCardInput,
): AnalyticsCardScreenVm {
  const { words, report, card } = input;
  const body = report === null ? null : bodyOf(input, report);
  const preset = AnalyticsCarouselSystem.presetOf(input.period, input.today);
  const rangeText =
    preset === null
      ? pageLabelOf(input.period, input)
      : words.card.rangeName[preset];
  const views =
    report === null || body === null ? [] : viewsOf(card, input, report, body);
  const view =
    input.view !== null && views.includes(input.view)
      ? input.view
      : (views[0] ?? AnalyticsChartView.Ring);
  const figure =
    report === null || body === null
      ? null
      : figureOf(card, input, report, body, rangeText);
  return {
    card,
    backLabel: words.card.back,
    freshness: statusOf(input),
    retryLabel: words.freshness.retry,
    blocked: blockedOf(input),
    title: titleOf(card, input),
    value: figure?.value ?? null,
    delta: figure?.delta ?? null,
    trend: figure?.trend ?? null,
    drill:
      CARD_FIGURES[card] === null || figure === null
        ? null
        : { analyticsFigure: CARD_FIGURES[card], serviceId: null },
    subline: figure?.subline ?? rangeText,
    infoLabel: words.info.label(words.figure[CARD_TOPICS[card]]),
    views:
      views.length < 2
        ? []
        : views.map((id): UiSegment => ({
            id,
            label: words.card.view[id],
            icon: VIEW_ICONS[id],
            iconOnly: true,
            testId: `analytics-view-${id}`,
          })),
    viewsLabel: words.card.views,
    view,
    chart:
      report === null || body === null || figure === null
        ? null
        : chartOf(card, view, input, report, body, figure),
    ranges: rangesOf(input, preset),
    services: card === AnalyticsCard.Takings ? (body?.services ?? null) : null,
    origins: card === AnalyticsCard.Takings ? (body?.origins ?? null) : null,
    time:
      card === AnalyticsCard.Time && body !== null
        ? {
            ...body.time,
            segments: body.time.segments.map((segment) => ({
              ...segment,
              selected: segment.analyticsBarPart === input.focusedPart,
            })),
          }
        : null,
    busy: card === AnalyticsCard.Time ? (body?.busy ?? null) : null,
    clients:
      card === AnalyticsCard.Rebooked || card === AnalyticsCard.NoShows
        ? (body?.clients ?? null)
        : null,
    radars: card === AnalyticsCard.Team ? (body?.radars ?? null) : null,
    team:
      card === AnalyticsCard.Team && report !== null
        ? teamOf(input, report).rows
        : null,
    teamTitle: words.card.byBarber,
    locationPicks:
      card === AnalyticsCard.Locations &&
      view === AnalyticsChartView.Line &&
      report !== null
        ? report.reportLocations.map((row, index) => ({
            locationId: row.locationId,
            label: input.names.locationName(row.locationId) ?? words.scope.shop,
            tone: index % IDENTITY_TONES,
            selected: !input.hiddenLocationIds.includes(row.locationId),
            testId: `analytics-location-pick-${row.locationId}`,
          }))
        : null,
    locationPicksLabel: words.card.locationPicks,
    locations:
      card === AnalyticsCard.Locations && report !== null
        ? locationsOf(input, report).rows
        : null,
    locationsTitle: words.card.byLocation,
  };
}

function titleOf(card: AnalyticsCard, input: AnalyticsScreenInput): string {
  const { home } = input.words;
  switch (card) {
    case AnalyticsCard.Takings:
      return home.takings;
    case AnalyticsCard.Time:
      return home.time;
    case AnalyticsCard.Tips:
      return home.tips;
    case AnalyticsCard.Rebooked:
      return home.rebooked;
    case AnalyticsCard.NoShows:
      return home.noShows;
    case AnalyticsCard.Team:
      return home.team;
    case AnalyticsCard.Locations:
      return home.locations;
  }
}

/** The figure at the top, its change, and the line under it. */
type CardFigure = {
  readonly value: string;
  readonly delta: string | null;
  readonly trend: 'up' | 'down' | null;
  readonly subline: string;
  /** The ring's centre line under the figure. */
  readonly ringDetail: string;
};

function figureOf(
  card: AnalyticsCard,
  input: AnalyticsScreenInput,
  report: AnalyticsReport,
  body: AnalyticsBodyVm,
  rangeText: string,
): CardFigure {
  const { words } = input;
  const lang = words.lang;
  const plain = (value: string, detail: string | null = null): CardFigure => ({
    value,
    delta: null,
    trend: null,
    subline:
      detail === null ? rangeText : words.card.subline(detail, rangeText),
    ringDetail: rangeText,
  });
  switch (card) {
    case AnalyticsCard.Takings: {
      const average = StaffAnalyticsSystem.seriesAverageCentsOf(report);
      const bucket = AnalyticsCarouselSystem.seriesBucketOf(report);
      return {
        value: body.hero.value,
        delta: body.hero.delta,
        trend: body.hero.trend,
        subline:
          body.series === null || average === null
            ? rangeText
            : words.card.subline(
                words.home.average[bucket](money(average, lang)),
                rangeText,
              ),
        ringDetail: rangeText,
      };
    }
    case AnalyticsCard.Time:
      return plain(
        spanWords(report.reportWorkedMinutes, words.spanWords),
        words.home.timeDetail(
          spanWords(
            AnalyticsCarouselSystem.rosteredSoFarOf(report),
            words.spanWords,
          ),
        ),
      );
    case AnalyticsCard.Tips: {
      const share = AnalyticsCarouselSystem.tipsShareOf(report);
      return plain(
        body.hero.tipsValue,
        share === null
          ? null
          : words.home.tipsDetail(formatPercent(share, lang)),
      );
    }
    case AnalyticsCard.Rebooked:
      return plain(
        body.clients.rows.find((row) => row.topic === AnalyticsTopic.Rebooked)
          ?.value ?? formatCount(report.reportRebookedCount, lang),
        words.home.rebookedDetail,
      );
    case AnalyticsCard.NoShows:
      return plain(
        formatCount(report.reportNoShowCount, lang),
        words.home.noShowsDetail(formatCount(report.reportNoShowBase, lang)),
      );
    case AnalyticsCard.Team:
      return plain(body.hero.value);
    case AnalyticsCard.Locations:
      return {
        value: body.hero.value,
        delta: body.hero.delta,
        trend: body.hero.trend,
        subline: rangeText,
        ringDetail: rangeText,
      };
  }
}

/** The views a card offers on this report, the default first. */
function viewsOf(
  card: AnalyticsCard,
  input: AnalyticsScreenInput,
  report: AnalyticsReport,
  body: AnalyticsBodyVm,
): readonly AnalyticsChartView[] {
  const { Line, Bars, Ring } = AnalyticsChartView;
  const series = body.series !== null && body.series.points.length > 1;
  const shop = StaffAnalyticsSystem.screenOf(report).shopScope;
  switch (card) {
    case AnalyticsCard.Takings:
      return series ? [Line, Bars, Ring] : [Ring];
    case AnalyticsCard.Time:
      return report.reportTimeSeries.length > 1 ? [Bars, Line, Ring] : [Ring];
    case AnalyticsCard.Tips:
      // Each bucket carries its tips beside its takings: the tips line
      // exists wherever the takings line does, at any range.
      return series ? [Line, Bars, Ring] : [Ring];
    case AnalyticsCard.Rebooked:
    case AnalyticsCard.NoShows:
      return shop && report.reportBarbers.length > 0 ? [Ring, Bars] : [Ring];
    case AnalyticsCard.Team:
      return input.scopeBarberId === null ? [Bars, Ring] : [Ring];
    case AnalyticsCard.Locations:
      return series ? [Line, Bars] : [Bars];
  }
}

function chartOf(
  card: AnalyticsCard,
  view: AnalyticsChartView,
  input: AnalyticsCardInput,
  report: AnalyticsReport,
  body: AnalyticsBodyVm,
  figure: CardFigure,
): AnalyticsCardChartVm {
  const { words } = input;
  const lang = words.lang;
  const labels = body.series?.points.map((point) => point.label) ?? [];
  // A point's day in words, for the scrub readout — a year's points are
  // its months.
  const days = report.reportSeries.map((point) =>
    report.reportAnalyticsSpan === AnalyticsSpan.Year
      ? formatMonthLong(point.localDate, lang)
      : formatDayLong(point.localDate, input.today, lang),
  );
  const title = titleOf(card, input);
  const ring = (
    segments: readonly AnalyticsRingSegmentVm[],
  ): AnalyticsCardChartVm => ({
    chartView: AnalyticsChartView.Ring,
    segments,
    centreCaption: title,
    centreValue: figure.value,
    centreDetail: figure.ringDetail,
    label: `${title}: ${segments.map((s) => `${s.label} ${s.valueText}`).join(', ')}`,
  });
  const line = <V extends number>(
    values: readonly (V | null)[],
    valueText: readonly string[],
    label: string,
    comparison: readonly (V | null)[] | null = null,
    average: number | null = null,
    averageText: string | null = null,
    /** Words a comparison point for the readout; `null` reads the figure alone. */
    comparisonText: ((value: V) => string) | null = null,
    /** A money line rules round amounts (`moneyTicksOf`); minutes rule none. */
    ruled = false,
  ): AnalyticsCardChartVm => ({
    chartView: AnalyticsChartView.Line,
    points: values.map((value, i) => ({
      label: labels.at(i) ?? '',
      value,
      comparison: comparison?.at(i) ?? null,
    })),
    average,
    valueText,
    averageText,
    comparisonLegend:
      comparison !== null && comparison.some((c) => c !== null)
        ? words.charts.comparison
        : null,
    label,
    series: [],
    ticks: ruled ? ticksOf([...values, ...(comparison ?? [])]) : [],
    // What a tap or drag on the point reads under the figure: its day, and
    // the previous period's figure beside it when there is one.
    readouts: values.map((_, i) => {
      const day = days.at(i) ?? labels.at(i) ?? '';
      const previous = comparison?.at(i) ?? null;
      return previous === null || comparisonText === null
        ? day
        : words.card.readoutVersus(day, comparisonText(previous));
    }),
  });
  /** A money chart's grid: the system's round amounts, in words. */
  const ticksOf = (values: readonly (number | null)[]) =>
    AnalyticsCarouselSystem.moneyTicksOf(values).map((cents) => ({
      value: cents,
      text: formatCentsWhole(cents, REPORT_CURRENCY, lang),
    }));
  /** A time chart's grid: the system's round durations, in words. */
  const minuteTicksOf = (values: readonly number[]) =>
    AnalyticsCarouselSystem.minuteTicksOf(values).map((minutes) => ({
      value: minutes,
      text: spanWords(minutes, words.spanWords),
    }));
  /** A column's height: its parts summed, as the chart stacks them. */
  const stackOf = (bar: AnalyticsChartBarVm): number =>
    bar.parts.reduce((sum, part) => sum + part.value, 0);
  const bars = (
    values: readonly number[],
    valueText: readonly string[],
    label: string,
    barLabels: readonly string[] = labels,
    part: UiChartPart = 'worked',
    orientation: 'vertical' | 'horizontal' = 'vertical',
    tones: readonly number[] = [],
  ): AnalyticsCardChartVm => ({
    chartView: AnalyticsChartView.Bars,
    bars: values.map((value, i): AnalyticsChartBarVm => ({
      label: barLabels.at(i) ?? '',
      parts: [{ part, value }],
      tone: tones.at(i) ?? null,
    })),
    valueText,
    orientation,
    label,
    // Columns of money stand on round amounts (Apple Health's grid); rows
    // carry their figures in words and rule nothing.
    ticks: orientation === 'vertical' ? ticksOf(values) : [],
    // A bar of the period reads its day; a barber's or a salon's, its name.
    readouts:
      barLabels === labels
        ? values.map((_, i) => days.at(i) ?? labels.at(i) ?? '')
        : barLabels,
  });
  const byBarber = (
    value: (row: AnalyticsReport.BarberFigures) => number,
    text: (row: AnalyticsReport.BarberFigures) => string,
    label: string,
  ): AnalyticsCardChartVm =>
    bars(
      report.reportBarbers.map(value),
      report.reportBarbers.map(text),
      label,
      report.reportBarbers.map(
        (row) => input.names.barberName(row.barberId) ?? words.scope.barber,
      ),
      'worked',
      'horizontal',
      // Each barber in their own colour — the team card's and the radars'.
      report.reportBarbers.map((_, i) => i % IDENTITY_TONES),
    );

  switch (card) {
    case AnalyticsCard.Takings: {
      const series = body.series;
      // The line is the PACE, as on the home card: the running total to
      // today against the previous period's over its whole length.
      const pace = AnalyticsCarouselSystem.paceOf(report, input.today);
      if (view === AnalyticsChartView.Line && pace.slots > 1) {
        const at = <T>(list: readonly T[] | null, i: number): T | null =>
          list?.at(i) ?? null;
        const values = series?.points.map((_, i) => at(pace.current, i)) ?? [];
        return line(
          values,
          values.map((value) =>
            value === null ? '' : money(value, words.lang),
          ),
          words.card.paceLabel,
          series?.points.map((_, i) => at(pace.previous, i)) ?? null,
          null,
          null,
          (cents) => money(cents, lang),
          true,
        );
      }
      if (view === AnalyticsChartView.Line && series !== null) {
        return line(
          series.points.map((p) => p.value),
          series.valueText,
          series.label,
          series.points.map((p) => p.comparison),
          series.average,
          series.averageText,
          null,
          true,
        );
      }
      if (view === AnalyticsChartView.Bars && series !== null) {
        // A bucket's takings, stacked BY SERVICE — each in its colour, the
        // ring's and the «Услуги» bars' (owner, 2026-11-09) — from the
        // first colour slot up, so a service sits at the same height of
        // every column; one without a slot of its own on top, in grey.
        const slot = (tone: number | null): number => tone ?? Number.MAX_VALUE;
        const chart = bars(
          series.points.map((p) => p.value ?? 0),
          series.valueText,
          series.label,
        );
        if (chart.chartView !== AnalyticsChartView.Bars) return chart;
        return {
          ...chart,
          bars: chart.bars.map((bar, i) => {
            const rows = report.reportSeries.at(i)?.serviceTakings ?? [];
            if (rows.length === 0) return bar;
            return {
              ...bar,
              parts: rows
                .map((row) => ({
                  part: 'other' as const,
                  value: row.takingsCents,
                  tone: serviceToneOf(input.names, row.serviceId),
                }))
                .sort((a, b) => slot(a.tone) - slot(b.tone)),
            };
          }),
        };
      }
      const shares = report.reportServices;
      return ring(
        shares.map((row) => ({
          value: row.takingsCents,
          // Each service in its own colour, the bars' too; one without a
          // tone of its own in the chart's grey.
          part: 'other',
          tone: serviceToneOf(input.names, row.serviceId),
          label: input.names.serviceName(row.serviceId) ?? words.unknownService,
          valueText: money(row.takingsCents, lang),
        })),
      );
    }
    case AnalyticsCard.Time: {
      const focused = input.focusedPart;
      if (view === AnalyticsChartView.Bars) {
        const time = body.time.bars;
        if (focused === null) {
          return {
            chartView: AnalyticsChartView.Bars,
            bars: time.bars,
            valueText: time.valueText,
            orientation: 'vertical',
            label: time.label,
            readouts: time.bars.map((bar, i) => days.at(i) ?? bar.label),
            ticks: minuteTicksOf(time.bars.map(stackOf)),
          };
        }
        // One part alone, each bar at its own height — the worked hours a
        // stack of free time dwarfed become real columns.
        // eslint-disable-next-line security/detect-object-injection -- `focused` is a closed `AnalyticsBarPart` literal.
        const hook = BAR_PART_HOOKS[focused];
        const bars = time.bars.map((bar) => ({
          ...bar,
          parts: bar.parts.filter((part) => part.part === hook),
        }));
        return {
          chartView: AnalyticsChartView.Bars,
          bars,
          valueText: bars.map((bar) =>
            spanWords(
              bar.parts.reduce((sum, part) => sum + part.value, 0),
              words.spanWords,
            ),
          ),
          orientation: 'vertical',
          // eslint-disable-next-line security/detect-object-injection -- `focused` is a closed `AnalyticsBarPart` literal.
          label: words.time.part[focused],
          readouts: bars.map((bar, i) => days.at(i) ?? bar.label),
          ticks: minuteTicksOf(bars.map(stackOf)),
        };
      }
      if (view === AnalyticsChartView.Line) {
        // The focused part's line; the worked hours by default.
        const field = TIME_POINT_FIELDS[focused ?? AnalyticsBarPart.Worked];
        const points = report.reportTimeSeries;
        return line(
          // eslint-disable-next-line security/detect-object-injection -- `field` is one of the table's six literal keys.
          points.map((p) => p[field]),
          // eslint-disable-next-line security/detect-object-injection -- as above.
          points.map((p) => spanWords(p[field], words.spanWords)),
          // eslint-disable-next-line security/detect-object-injection -- `focused` is a closed `AnalyticsBarPart` literal.
          focused === null ? words.card.workedLine : words.time.part[focused],
        );
      }
      const minutes = {
        [AnalyticsBarPart.Worked]: report.reportBarWorkedMinutes,
        [AnalyticsBarPart.NoShow]: report.reportBarNoShowMinutes,
        [AnalyticsBarPart.Unmarked]: report.reportBarUnmarkedMinutes,
        [AnalyticsBarPart.Blocked]: report.reportBarBlockedMinutes,
        [AnalyticsBarPart.Unsold]: report.reportBarUnsoldMinutes,
        [AnalyticsBarPart.Other]: report.reportBarOtherMinutes,
      } as const satisfies Record<AnalyticsBarPart, number>;
      return ring(
        TIME_PARTS.map((part) => ({
          value: minutes[part],
          part: BAR_PART_HOOKS[part],
          tone: null,
          label: words.time.part[part],
          valueText: spanWords(minutes[part], words.spanWords),
        })),
      );
    }
    case AnalyticsCard.Tips: {
      if (view !== AnalyticsChartView.Ring) {
        const tips = report.reportSeries.map((point) => point.tipsCents);
        const text = tips.map((cents) => money(cents, lang));
        return view === AnalyticsChartView.Line
          ? line(tips, text, words.card.tipsLine, null, null, null, null, true)
          : bars(tips, text, words.card.tipsLine);
      }
      return ring([
        {
          value: report.reportTipsCents,
          part: 'worked',
          tone: null,
          label: words.home.tips,
          valueText: body.hero.tipsValue,
        },
        {
          value: report.reportTakingsCents,
          part: 'unsold',
          tone: null,
          label: words.home.takings,
          valueText: body.hero.value,
        },
      ]);
    }
    case AnalyticsCard.Rebooked: {
      if (view === AnalyticsChartView.Bars) {
        return byBarber(
          (row) => row.rebookedCount,
          (row) =>
            words.clients.ofBase(
              formatCount(row.rebookedCount, lang),
              formatCount(row.rebookedBase, lang),
            ),
          words.card.byBarber,
        );
      }
      const rest = Math.max(
        0,
        report.reportRebookedBase - report.reportRebookedCount,
      );
      return ring([
        {
          value: report.reportRebookedCount,
          part: 'worked',
          tone: null,
          label: words.home.rebooked,
          valueText: formatCount(report.reportRebookedCount, lang),
        },
        {
          value: rest,
          part: 'unsold',
          tone: null,
          label: words.card.notRebooked,
          valueText: formatCount(rest, lang),
        },
      ]);
    }
    case AnalyticsCard.NoShows: {
      if (view === AnalyticsChartView.Bars) {
        return byBarber(
          (row) => row.noShowCount,
          (row) => formatCount(row.noShowCount, lang),
          words.card.byBarber,
        );
      }
      const attended = Math.max(
        0,
        report.reportNoShowBase - report.reportNoShowCount,
      );
      return ring([
        {
          value: report.reportNoShowCount,
          part: 'no-show',
          tone: null,
          label: words.home.noShows,
          valueText: formatCount(report.reportNoShowCount, lang),
        },
        {
          value: attended,
          part: 'unsold',
          tone: null,
          label: words.card.attended,
          valueText: formatCount(attended, lang),
        },
      ]);
    }
    case AnalyticsCard.Team: {
      if (view === AnalyticsChartView.Bars) {
        return byBarber(
          (row) => row.takingsCents,
          (row) => money(row.takingsCents, lang),
          words.card.teamBars,
        );
      }
      return ring(
        report.reportBarbers.map((row, i) => ({
          value: row.takingsCents,
          part: null,
          tone: i % IDENTITY_TONES,
          label: input.names.barberName(row.barberId) ?? words.scope.barber,
          valueText: money(row.takingsCents, lang),
        })),
      );
    }
    case AnalyticsCard.Locations: {
      const rows = report.reportLocations;
      const names = rows.map(
        (row) => input.names.locationName(row.locationId) ?? words.scope.shop,
      );
      if (view === AnalyticsChartView.Line) {
        // One running total per location the toggles keep, in its tone —
        // the colour follows the location, never its rank. The figure
        // stays the shop's while a finger reads the day.
        const paces = AnalyticsCarouselSystem.locationPacesOf(
          report,
          input.today,
        );
        const shown = rows.flatMap((row, index) =>
          input.hiddenLocationIds.includes(row.locationId)
            ? []
            : [{ index, pace: paces[index] ?? [] }],
        );
        const points = labels.map((label) => ({
          label,
          value: null,
          comparison: null,
        }));
        return {
          chartView: AnalyticsChartView.Line,
          points,
          average: null,
          valueText: points.map(() => ''),
          averageText: null,
          comparisonLegend: null,
          label: words.card.locationsLine,
          series: shown.map(({ index, pace }) => ({
            values: points.map((_, i) => pace[i] ?? null),
            tone: index % IDENTITY_TONES,
          })),
          ticks: ticksOf(shown.flatMap(({ pace }) => pace)),
          readouts: points.map((_, i) => {
            const day = days.at(i) ?? labels.at(i) ?? '';
            const list = shown.flatMap(({ index, pace }) => {
              const cents = pace[i];
              return cents === undefined
                ? []
                : [`${names[index] ?? ''} ${money(cents, lang)}`];
            });
            return list.length === 0
              ? day
              : words.card.readoutList(day, list.join(' · '));
          }),
        };
      }
      return bars(
        rows.map((row) => row.takingsCents),
        rows.map((row) => money(row.takingsCents, lang)),
        words.card.locationsBars,
        names,
        'worked',
        'horizontal',
        // Each salon in its own colour — its line's, its chip's, its row's.
        rows.map((_, i) => i % IDENTITY_TONES),
      );
    }
  }
}

function rangesOf(
  input: AnalyticsScreenInput,
  preset: AnalyticsRangePreset | null,
): AnalyticsRangeRowVm {
  const { words } = input;
  return {
    label: words.card.ranges,
    segments: Object.values(AnalyticsRangePreset).map((id) => ({
      id,
      label: words.card.range[id],
      testId: `analytics-range-${id}`,
    })),
    selected: preset,
    customLabel: words.card.custom,
    customOn:
      preset === null && input.period.analyticsSpan === AnalyticsSpan.Custom,
  };
}
