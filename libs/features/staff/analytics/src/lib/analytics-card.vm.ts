import type { BarberId, LocalDate, LocationId } from '@core/primitives';
import type { UiChartPart, UiChartTick } from '@creativo/ui/charts';
import type { UiSegment } from '@creativo/ui/controls';
import type {
  AnalyticsCard,
  AnalyticsLocationRowVm,
  AnalyticsTeamRowVm,
} from './analytics-home.vm';
import type {
  AnalyticsBlockedVm,
  AnalyticsBusyVm,
  AnalyticsChartBarVm,
  AnalyticsClientsVm,
  AnalyticsDrill,
  AnalyticsLinePointVm,
  AnalyticsOriginsVm,
  AnalyticsRadarsVm,
  AnalyticsServicesVm,
  AnalyticsStatusVm,
  AnalyticsTimeVm,
} from './analytics.vm';

/*
 * A CARD'S OWN SCREEN (staff-analytics-v3, «A card's screen»; Law 10.3) —
 * the figure, one chart in the view the switch picked, the range row, and
 * the v2 sections that break the figure down. Types and tag tables only;
 * `analytics-card.presenter.ts` builds them.
 */

/** How the screen's one chart is drawn — the field `chartView`, the switch's segment ids. */
export const AnalyticsChartView = {
  /** A smooth line with a gradient area (`ui-line-chart`, `uiCurve="smooth"`). */
  Line: 'LINE',
  /** Bars (`ui-bar-chart`). */
  Bars: 'BARS',
  /** The figure's breakdown as a ring (`ui-ring-chart`), the figure in its centre. */
  Ring: 'RING',
} as const;
export type AnalyticsChartView =
  (typeof AnalyticsChartView)[keyof typeof AnalyticsChartView];

/** One segment of the ring: its share, its paint and its words. */
export type AnalyticsRingSegmentVm = {
  readonly value: number;
  readonly part: UiChartPart | null;
  readonly tone: number | null;
  readonly label: string;
  readonly valueText: string;
};

/** One compared member's line (`ui-line-chart`'s `uiSeries`): its values and its identity tone. */
export type AnalyticsLineSeriesVm = {
  readonly values: readonly (number | null)[];
  readonly tone: number;
};

/** A toggle picking whether a location's line is drawn — a chip with its tone's dot. */
export type AnalyticsLocationPickVm = {
  readonly locationId: LocationId;
  readonly label: string;
  readonly tone: number;
  readonly selected: boolean;
  readonly testId: string;
};

/** The screen's chart, in the view picked. */
export type AnalyticsCardChartVm =
  | {
      readonly chartView: typeof AnalyticsChartView.Line;
      readonly points: readonly AnalyticsLinePointVm[];
      readonly average: number | null;
      readonly valueText: readonly string[];
      readonly averageText: string | null;
      /** «предходен период» — `null` when no point has a comparison. */
      readonly comparisonLegend: string | null;
      readonly label: string;
      /**
       * The line under the figure while a finger rests on each point — its
       * day, and the previous period's figure beside it: «5 ноември ·
       * предходен 60,00 €». The figure itself is the point's `valueText`.
       */
      readonly readouts: readonly string[];
      /** The compared members' lines — the locations'; empty for one line. */
      readonly series: readonly AnalyticsLineSeriesVm[];
      /** The value grid: round amounts and their words; empty off money. */
      readonly ticks: readonly UiChartTick[];
    }
  | {
      readonly chartView: typeof AnalyticsChartView.Bars;
      readonly bars: readonly AnalyticsChartBarVm[];
      readonly valueText: readonly string[];
      readonly orientation: 'vertical' | 'horizontal';
      readonly label: string;
      /**
       * The line under the figure while a finger rests on each bar — its
       * day («понеделник, 14 септември»), or its barber's or salon's name;
       * the figure itself is the bar's `valueText`.
       */
      readonly readouts: readonly string[];
    }
  | {
      readonly chartView: typeof AnalyticsChartView.Ring;
      readonly segments: readonly AnalyticsRingSegmentVm[];
      /** The centre: the topic's word, the figure, the period. */
      readonly centreCaption: string;
      readonly centreValue: string;
      readonly centreDetail: string;
      readonly label: string;
    };

/** The range row: the chips and the «…» of the custom period. */
export type AnalyticsRangeRowVm = {
  readonly label: string;
  readonly segments: readonly UiSegment[];
  /** The chip the period is, `null` for a day, a past week, the sheet's range. */
  readonly selected: string | null;
  readonly customLabel: string;
  /** The period is the sheet's: the «…» reads pressed. */
  readonly customOn: boolean;
};

/** What the screen's back link returns to: the home on the period it came from. */
export type AnalyticsHomeQuery = {
  readonly span: string;
  readonly from: LocalDate;
  readonly barber: BarberId | null;
};

/** A card's screen. */
export type AnalyticsCardScreenVm = {
  readonly card: AnalyticsCard;
  readonly backLabel: string;
  readonly freshness: AnalyticsStatusVm | null;
  readonly retryLabel: string;
  readonly blocked: AnalyticsBlockedVm | null;
  readonly title: string;
  /** The figure; `null` while the first report is out. */
  readonly value: string | null;
  readonly delta: string | null;
  readonly trend: 'up' | 'down' | null;
  /** What a tap on the figure opens — its rows, which add up to it; `null` for the team. */
  readonly drill: AnalyticsDrill | null;
  /** «средно 14,00 € на ден · Този месец» — or the period alone. */
  readonly subline: string;
  /** The ⓘ's accessible name. */
  readonly infoLabel: string;
  /** The switch's segments — empty when the card has one view only. */
  readonly views: readonly UiSegment[];
  readonly viewsLabel: string;
  readonly view: AnalyticsChartView;
  readonly chart: AnalyticsCardChartVm | null;
  readonly ranges: AnalyticsRangeRowVm;
  /** The sections under the range row — each `null` where the card has none. */
  readonly services: AnalyticsServicesVm | null;
  readonly origins: AnalyticsOriginsVm | null;
  readonly time: AnalyticsTimeVm | null;
  readonly busy: AnalyticsBusyVm | null;
  readonly clients: AnalyticsClientsVm | null;
  readonly radars: AnalyticsRadarsVm | null;
  readonly team: readonly AnalyticsTeamRowVm[] | null;
  readonly teamTitle: string;
  /** The locations' toggles over the line — `null` off the locations' line. */
  readonly locationPicks: readonly AnalyticsLocationPickVm[] | null;
  readonly locationPicksLabel: string;
  /** A row per location, opening its own figures — `null` off the locations' screen. */
  readonly locations: readonly AnalyticsLocationRowVm[] | null;
  readonly locationsTitle: string;
};
