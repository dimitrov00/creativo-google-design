import type { BarberId, LocalDate } from '@core/primitives';
import type { UiChartPart } from '@creativo/ui/charts';
import type { UiSegment } from '@creativo/ui/controls';
import type { AnalyticsCard, AnalyticsTeamRowVm } from './analytics-home.vm';
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
    }
  | {
      readonly chartView: typeof AnalyticsChartView.Bars;
      readonly bars: readonly AnalyticsChartBarVm[];
      readonly valueText: readonly string[];
      readonly orientation: 'vertical' | 'horizontal';
      readonly label: string;
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
};
