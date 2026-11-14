import {
  AnalyticsBarPart,
  AnalyticsFigure,
  type AnalyticsReport,
  BookingOrigin,
} from '@core/components';
import type {
  BarberId,
  LocalDate,
  PriceCents,
  ServiceId,
} from '@core/primitives';
import type { UiChartPart } from '@creativo/ui/charts';
import type { UiSegment } from '@creativo/ui/controls';
import type { VisitSectionVm } from '@creativo/features/shared/visits';

/*
 * THE «АНАЛИЗИ» SCREEN'S DISPLAY MODEL (Law 10.3) — the display structs the
 * page prints and the tag-to-word tables they are worded from. No function
 * values: the words that take a value are `analytics.words.ts`'s, the
 * building is `analytics.presenter.ts`'s.
 */

/**
 * Where the screen's request stands — the field `analyticsLoad`, the store's
 * state machine (`staff-analytics.store.ts`), worded by the presenter.
 */
export const AnalyticsLoad = {
  /** The first request is out and there is nothing to show yet. */
  Loading: 'LOADING',
  /** A report is shown (cached) while the request is out. */
  Refreshing: 'REFRESHING',
  /** The shown report is the request's answer. */
  Ready: 'READY',
  /** The request failed; a cached report may still be shown. */
  Failed: 'FAILED',
  /** The callable refused the account (a staff-access refusal — `ACCESS_*` — or `ANALYTICS_BARBER_NOT_LINKED`). */
  Refused: 'REFUSED',
} as const;
export type AnalyticsLoad = (typeof AnalyticsLoad)[keyof typeof AnalyticsLoad];

/**
 * What an ⓘ explains, and what a drill-down is titled — the screen's
 * figures and cards. Values: external contract — the i18n key segments
 * `staffAnalytics.figure.<value>` and `staffAnalytics.info.<value>`, and the
 * ⓘ buttons' test ids (`analytics-info-<value>`).
 */
export const AnalyticsTopic = {
  Takings: 'TAKINGS',
  Tips: 'TIPS',
  Time: 'TIME',
  Open: 'OPEN',
  Services: 'SERVICES',
  Rebooked: 'REBOOKED',
  NoShows: 'NO_SHOWS',
  LateCancellations: 'LATE_CANCELLATIONS',
  /** When the chair is busy — the weekday × hour heatmap. */
  Busy: 'BUSY',
  Origins: 'ORIGINS',
  /** How each barber does — the admin's radars. */
  Radars: 'RADARS',
  /** The month's goal and its pace — the ring. */
  Goal: 'GOAL',
} as const;
export type AnalyticsTopic =
  (typeof AnalyticsTopic)[keyof typeof AnalyticsTopic];

/** Each drillable figure's topic — its drill-down's title and lede. */
export const FIGURE_TOPICS = {
  [AnalyticsFigure.Takings]: AnalyticsTopic.Takings,
  [AnalyticsFigure.Tips]: AnalyticsTopic.Tips,
  [AnalyticsFigure.NoShows]: AnalyticsTopic.NoShows,
  [AnalyticsFigure.LateCancellations]: AnalyticsTopic.LateCancellations,
  [AnalyticsFigure.Rebooked]: AnalyticsTopic.Rebooked,
  [AnalyticsFigure.Time]: AnalyticsTopic.Time,
} as const satisfies Record<AnalyticsFigure, AnalyticsTopic>;

/**
 * Each time-bar part's chart part (`UiChartPart` of `@creativo/ui/charts`,
 * the `data-part` hook `charts.css` colours) — the shape it is drawn as
 * (the accent law: colour is a shape; worked is the one orange, the rest
 * graded ink). Values: external contract, the kit's vocabulary.
 */
/** Each bar part's field of a time point — the stacked bar's six segments, in the legend's order. */
export const TIME_POINT_FIELDS = {
  [AnalyticsBarPart.Worked]: 'workedMinutes',
  [AnalyticsBarPart.NoShow]: 'noShowMinutes',
  [AnalyticsBarPart.Unmarked]: 'unmarkedMinutes',
  [AnalyticsBarPart.Blocked]: 'blockedMinutes',
  [AnalyticsBarPart.Unsold]: 'unsoldMinutes',
  [AnalyticsBarPart.Other]: 'otherMinutes',
} as const satisfies Record<AnalyticsBarPart, keyof AnalyticsReport.TimePoint>;

export const BAR_PART_HOOKS = {
  [AnalyticsBarPart.Worked]: 'worked',
  [AnalyticsBarPart.NoShow]: 'no-show',
  [AnalyticsBarPart.Unmarked]: 'unmarked',
  [AnalyticsBarPart.Blocked]: 'blocked',
  [AnalyticsBarPart.Unsold]: 'unsold',
  [AnalyticsBarPart.Other]: 'other',
} as const satisfies Record<AnalyticsBarPart, UiChartPart>;

/** Each booking origin's chart part — the origins bar's three segments. */
export const ORIGIN_PART_HOOKS = {
  [BookingOrigin.Online]: 'online',
  [BookingOrigin.Staff]: 'staff',
  [BookingOrigin.Unknown]: 'unknown',
} as const satisfies Record<BookingOrigin, UiChartPart>;

/** One bar of the kit's `ui-bar-chart`: its label and its parts, each a chart part and a value. */
export type AnalyticsChartBarVm = {
  readonly label: string;
  readonly parts: readonly {
    readonly part: UiChartPart;
    readonly value: number;
    /** The part's own identity tone — a service's colour in a stacked column. */
    readonly tone?: number | null;
  }[];
  /** A member's identity tone (`0…4`, the colour of its line and row), or none. */
  readonly tone: number | null;
};

/** One point of the takings line: the bucket's figure and the comparison aligned by position. */
export type AnalyticsLinePointVm = {
  readonly label: string;
  /** `null` past today on a running total — the line stops there. */
  readonly value: number | null;
  readonly comparison: number | null;
};

/** The takings line (`ui-line-chart`): one point per day of the period, the comparison in grey, a dashed average. */
export type AnalyticsSeriesVm = {
  readonly points: readonly AnalyticsLinePointVm[];
  readonly average: number | null;
  /** «28,00 €» per point. */
  readonly valueText: readonly string[];
  /** «средно 14,00 €» — `null` without points. */
  readonly averageText: string | null;
  /** «предходен период» — the grey line's legend; `null` without a previous period. */
  readonly comparisonLegend: string | null;
  readonly label: string;
};

/** The stacked time bars (`ui-bar-chart`): a bar per day of the six parts; the legend beneath is the breakdown table. */
export type AnalyticsTimeSeriesVm = {
  readonly bars: readonly AnalyticsChartBarVm[];
  /** «6 ч 30 мин» per bar — its parts together. */
  readonly valueText: readonly string[];
  readonly label: string;
};

/** When the chair is busy (`ui-heatmap`): weekday × hour, worked over rostered. */
export type AnalyticsBusyVm = {
  readonly title: string;
  readonly rows: readonly string[];
  readonly columns: readonly string[];
  readonly cells: readonly {
    readonly row: number;
    readonly column: number;
    readonly value: number;
    readonly max: number;
  }[];
  /** «Най-натоварено: вт в 10:00 · най-спокойно: пн в 17:00», or why there is no verdict yet. */
  readonly sentence: string;
  readonly label: string;
};

/** The open-hours card's seven bars, the emptiest day in the accent. */
export type AnalyticsAheadVm = {
  readonly bars: readonly AnalyticsChartBarVm[];
  readonly highlightIndex: number | null;
  readonly valueText: readonly string[];
  readonly label: string;
};

/**
 * The services ranked (`ui-bar-chart`, horizontal): one bar per service,
 * largest first — its word the name and the takings per hour, its figure
 * the takings and the count — each opening its seats.
 */
export type AnalyticsServicesVm = {
  readonly title: string;
  readonly bars: readonly AnalyticsChartBarVm[];
  /** «28,00 € · 1 път» per bar. */
  readonly valueText: readonly string[];
  /** The seats a bar opens; `null` for a bar that opens nothing. */
  readonly drills: readonly (AnalyticsDrill | null)[];
  readonly label: string;
  /** «Още няма отработени услуги.» — `null` while there are bars. */
  readonly empty: string | null;
};

/** One origin's row under the origins bar: its swatch, name, visits and share. */
export type AnalyticsOriginRowVm = {
  readonly part: UiChartPart;
  readonly title: string;
  readonly detail: string;
  /** «50%». */
  readonly value: string;
  readonly testId: string;
};

/** One axis of a barber's radar: its word, this period's value and the comparison's, both 0–100 or `null`. */
export type AnalyticsRadarAxisVm = {
  readonly label: string;
  readonly value: number | null;
  readonly comparison: number | null;
};

/** One barber's radar (`ui-radar`): five axes on the shop's base, in the barber's identity tone; a tap opens their scope. */
export type AnalyticsRadarVm = {
  readonly barberId: BarberId;
  readonly name: string;
  readonly avatarSrc: string | null;
  /** `0…4` — `--sys-identity-N` in the catalogue's barber order. */
  readonly tone: number;
  readonly axes: readonly AnalyticsRadarAxisVm[];
  /** «87» per axis; the kit prints the missing word for a `null`. */
  readonly valueText: readonly string[];
  readonly label: string;
  readonly accessibleName: string;
  readonly testId: string;
};

/** «Как се справя всеки» — the admin's radars, one per barber, and the base in words. */
export type AnalyticsRadarsVm = {
  readonly title: string;
  /** «спрямо най-добрия в салона» · «твърде малко бръснари за сравнение». */
  readonly subtitle: string;
  readonly missingText: string;
  /** «предходен период» — `null` when no radar carries a comparison. */
  readonly comparisonLegend: string | null;
  readonly radars: readonly AnalyticsRadarVm[];
};

/** Where bookings come from: one horizontal stacked bar, and its three rows with swatches. */
export type AnalyticsOriginsVm = {
  readonly title: string;
  /** The one bar, as the chart takes it. */
  readonly bars: readonly AnalyticsChartBarVm[];
  readonly label: string;
  readonly rows: readonly AnalyticsOriginRowVm[];
};

/** A drill-down asked for: the figure, and the service that narrows it (`null` narrows nothing). */
export type AnalyticsDrill = {
  readonly analyticsFigure: AnalyticsFigure;
  readonly serviceId: ServiceId | null;
};

/** The line under the title: when the figures are from, or why they are not new. */
export type AnalyticsStatusVm = {
  readonly text: string;
  /** The request failed with figures still shown: the line carries «Опитай пак». */
  readonly retry: boolean;
  /** The ⓘ beside the line: how the figures come about, in words. */
  readonly info: string;
  readonly testId: string;
};

/** The comparison chip under the period: what the figures are compared with, or that nothing can be. */
export type AnalyticsComparisonVm = {
  /** «спрямо предходния период» · «няма данни за сравнение». */
  readonly text: string;
  /** The comparison period lies within the reach and is read. */
  readonly comparable: boolean;
  readonly testId: string;
};

/**
 * Why the custom-range sheet refuses its two fields — the field
 * `rangeRefusal` of {@link AnalyticsRangeCheck}; `null` is a range the
 * switcher may ask for.
 */
export const AnalyticsRangeRefusal = {
  /** A field is empty or half-typed. */
  Incomplete: 'INCOMPLETE',
  /** The range starts before the reach (12 months back). */
  BeforeReach: 'BEFORE_REACH',
  /** The range ends after today. */
  AfterToday: 'AFTER_TODAY',
  /** Longer than `CUSTOM_MAX_DAYS`. */
  TooLong: 'TOO_LONG',
} as const;
export type AnalyticsRangeRefusal =
  (typeof AnalyticsRangeRefusal)[keyof typeof AnalyticsRangeRefusal];

/** The store's verdict on the sheet's two fields, read by the presenter and the sheet. */
export type AnalyticsRangeCheck =
  | {
      readonly rangeRefusal: null;
      readonly fromLocalDate: LocalDate;
      readonly toLocalDate: LocalDate;
    }
  | {
      readonly rangeRefusal: Exclude<AnalyticsRangeRefusal, null>;
      readonly fromLocalDate: LocalDate | null;
      readonly toLocalDate: LocalDate | null;
    };

/**
 * Why the goal sheet refuses its two sums — the field `goalRefusal` of
 * {@link AnalyticsGoalCheck}; `null` is a range the callable may be asked
 * to store.
 */
export const AnalyticsGoalRefusal = {
  /** A sum is empty. */
  Incomplete: 'INCOMPLETE',
  /** `AnalyticsGoal.rangeOf` refused: a sum not above zero, or the low end over the high. */
  InvalidRange: 'INVALID_RANGE',
} as const;
export type AnalyticsGoalRefusal =
  (typeof AnalyticsGoalRefusal)[keyof typeof AnalyticsGoalRefusal];

/** The store's verdict on the goal sheet's two sums, read by the presenter and the sheet. */
export type AnalyticsGoalCheck =
  | {
      readonly goalRefusal: null;
      readonly goalLowCents: PriceCents;
      readonly goalHighCents: PriceCents;
    }
  | {
      readonly goalRefusal: Exclude<AnalyticsGoalRefusal, null>;
      readonly goalLowCents: null;
      readonly goalHighCents: null;
    };

/** Where the goal's write stands — the field `goalSave`. */
export const AnalyticsGoalSave = {
  Idle: 'IDLE',
  /** `setAnalyticsGoal` is out; «Запази» waits. */
  Saving: 'SAVING',
  /** The callable refused or failed; the sheet says so and stays. */
  Failed: 'FAILED',
} as const;
export type AnalyticsGoalSave =
  (typeof AnalyticsGoalSave)[keyof typeof AnalyticsGoalSave];

/** The goal sheet, worded: two sums and «Запази». */
export type AnalyticsGoalSheetVm = {
  readonly title: string;
  readonly lowLabel: string;
  readonly highLabel: string;
  readonly decreaseLabel: string;
  readonly increaseLabel: string;
  /** «€» — the fields' unit. */
  readonly unit: string;
  readonly saveLabel: string;
  /** «Премахни целта» while a goal is set; `null` without one. */
  readonly removeLabel: string | null;
  readonly closeLabel: string;
  /** Why «Запази» is off, or that the last save failed — `null` when the range may be saved. */
  readonly refusal: string | null;
  readonly saveEnabled: boolean;
  readonly saving: boolean;
};

/** The month's goal ring: the takings against the range, and the pace in words. */
export type AnalyticsGoalRingVm = {
  /** The takings so far, in cents — the ring's value. */
  readonly value: number;
  readonly min: number;
  /** The range's high end, in cents — the ring full. */
  readonly max: number;
  /** «68 %» — the centre: the takings' share of the high end. */
  readonly figure: string;
  /** «1 800,00 € – 2 200,00 €». */
  readonly rangeText: string;
  /** «12 от 22 работни дни · на път» · «Още няма работен ден този месец». */
  readonly pace: string;
  /** The pace tag — the ring's `data-pace` hook. */
  readonly paceTag: string;
  readonly label: string;
  readonly accessibleName: string;
};

/**
 * «Цел за месеца» — on MONTH alone: the ring when a goal is stored, and
 * «Задай цел» on a month the callable accepts one for (this month or the
 * next; `setLabel` is `null` on an earlier month, where a stored goal is
 * read-only). `null` when there is neither a goal to show nor a month to
 * set one on.
 */
export type AnalyticsGoalVm = {
  readonly title: string;
  readonly ring: AnalyticsGoalRingVm | null;
  /** «Задай цел» · «Промени целта» — `null` when the month takes no goal. */
  readonly setLabel: string | null;
  /** «Задай оборот за месеца и следи темпото.» — `null` once a goal is shown. */
  readonly prompt: string | null;
  readonly sheet: AnalyticsGoalSheetVm;
};

/** The custom-range sheet, worded. */
export type AnalyticsRangeVm = {
  readonly pillLabel: string;
  readonly title: string;
  readonly fromLabel: string;
  readonly toLabel: string;
  readonly dayLabel: string;
  readonly monthLabel: string;
  readonly yearLabel: string;
  readonly dayPlaceholder: string;
  readonly monthPlaceholder: string;
  readonly yearPlaceholder: string;
  readonly applyLabel: string;
  readonly closeLabel: string;
  /** Why «Приложи» is disabled — `null` when the range may be asked for. */
  readonly refusal: string | null;
  readonly applyEnabled: boolean;
  /** «Избери» — a row with no date yet. */
  readonly chooseLabel: string;
  readonly previousMonthLabel: string;
  readonly nextMonthLabel: string;
  /** The calendars' language, today and the reach's first day. */
  readonly locale: string;
  readonly today: LocalDate;
  readonly earliest: LocalDate;
};

/** The period switcher: Day | Week | Month | Year, the «…» pill, ‹ the period ›, and the comparison chip. */
export type AnalyticsPeriodVm = {
  readonly spanLabel: string;
  readonly spans: readonly UiSegment[];
  /** The segment on, or `CUSTOM` — which no segment names. */
  readonly selectedSpan: string;
  /** A custom range is on: the «…» pill reads pressed, no segment does. */
  readonly customOn: boolean;
  /** «Септември 2026» · «28.09 – 4.10» · «вторник, 29.09» · «2026 г.». */
  readonly label: string;
  readonly previousLabel: string;
  readonly previousEnabled: boolean;
  readonly nextLabel: string;
  readonly nextEnabled: boolean;
  readonly comparison: AnalyticsComparisonVm;
  readonly range: AnalyticsRangeVm;
};

/** The hero: the takings, their change, the tips on their own line. */
export type AnalyticsHeroVm = {
  readonly caption: string;
  readonly value: string;
  /** «+30 %» — `null` when there is no rate to print. */
  readonly delta: string | null;
  readonly trend: 'up' | 'down' | null;
  /** «спрямо предходния период» · «Още няма предходен период за сравнение». */
  readonly comparison: string;
  readonly tipsLabel: string;
  readonly tipsValue: string;
  /** «2 посещения без изчислима сметка не са включени» — `null` with none. */
  readonly excluded: string | null;
  readonly accessibleName: string;
};

/** One segment of the time bar and its legend row. */
export type AnalyticsBarSegmentVm = {
  /** The part, a tag — what a tap on its row focuses in the chart. */
  readonly analyticsBarPart: AnalyticsBarPart;
  /** The CSS hook (`BAR_PART_HOOKS`). */
  readonly part: string;
  /** Its share of the bar, `0…1` — the segment's width. */
  readonly share: number;
  /** «1%» — its share of the working time, as the column draws it. */
  readonly shareText: string;
  readonly label: string;
  /** «4 ч 30 мин». */
  readonly value: string;
  /** The part the chart above draws alone (the card screen's focus). */
  readonly selected: boolean;
  readonly testId: string;
};

export type AnalyticsTimeVm = {
  readonly title: string;
  readonly barName: string;
  /** The stacked bars, a bar per day. */
  readonly bars: AnalyticsTimeSeriesVm;
  /** The legend beneath the bars — each part with its minutes. */
  readonly segments: readonly AnalyticsBarSegmentVm[];
  /** «Предстои: 1 ч 30 мин записани · 50 мин свободни». */
  readonly ahead: string;
  /** «По дни» — the row that opens the days. */
  readonly byDay: string;
};

/** Where the open-hours card leads: the schedule's agenda on the emptiest day, free time drawn. */
export type AnalyticsScheduleLink = {
  readonly day: LocalDate;
  readonly view: 'agenda';
  readonly barber: BarberId | null;
  readonly free: '1';
};

export type AnalyticsOpenVm = {
  readonly title: string;
  readonly value: string;
  readonly caption: string;
  /** «Най-много: вторник, 29.09» · «Няма свободни часове…». */
  readonly detail: string;
  readonly link: AnalyticsScheduleLink | null;
  /** The seven days' open minutes as bars, the emptiest in the accent. */
  readonly bars: AnalyticsAheadVm;
  readonly accessibleName: string;
};

/** One of the clients' figures: a rate from its base of 20, else «3 от 9». */
export type AnalyticsClientRowVm = {
  readonly topic: AnalyticsTopic;
  readonly label: string;
  readonly value: string;
  readonly drill: AnalyticsDrill;
  readonly testId: string;
};

export type AnalyticsClientsVm = {
  readonly title: string;
  readonly rows: readonly AnalyticsClientRowVm[];
  /** «Процентите се показват от 20 нагоре.» under a small sample. */
  readonly note: string | null;
};

/** The period had nothing in it. */
export type AnalyticsEmptyVm = {
  readonly title: string;
  readonly detail: string;
};

/** The figures of one report, worded. */
export type AnalyticsBodyVm = {
  readonly empty: AnalyticsEmptyVm | null;
  readonly hero: AnalyticsHeroVm;
  /** The takings line under the hero — `null` on DAY, where the hero and its delta stand alone. */
  readonly series: AnalyticsSeriesVm | null;
  readonly time: AnalyticsTimeVm;
  /** When the chair is busy — `null` on DAY, and while the period has no rostered hour. */
  readonly busy: AnalyticsBusyVm | null;
  readonly open: AnalyticsOpenVm;
  readonly services: AnalyticsServicesVm;
  readonly clients: AnalyticsClientsVm;
  /** The shop's alone: where bookings come from. */
  readonly origins: AnalyticsOriginsVm | null;
  /** The admin's radars — the shop scope on MONTH, YEAR and CUSTOM; `null` elsewhere. */
  readonly radars: AnalyticsRadarsVm | null;
  /** The month's goal — MONTH alone; `null` elsewhere, and on a past month without one. */
  readonly goal: AnalyticsGoalVm | null;
};

/** Why there are no figures: a refusal, or a request that failed with nothing cached. */
export type AnalyticsBlockedVm = {
  readonly text: string;
  readonly retry: boolean;
  readonly testId: string;
};

/**
 * The report as a CSV file (staff-analytics-v2 «Export (PR 7)»): its name
 * and its text — the byte-order mark, block 1 (a row per day row), a blank
 * line, block 2 (a row per service row), CRLF line ends.
 */
export type AnalyticsExportFile = {
  /** `creativo-analytics-<from>-<to>.csv`. */
  readonly fileName: string;
  readonly text: string;
};

/** The whole screen. */
export type AnalyticsVm = {
  readonly title: string;
  readonly backLabel: string;
  readonly freshness: AnalyticsStatusVm | null;
  readonly retryLabel: string;
  readonly period: AnalyticsPeriodVm;
  /** The placeholder layout: the first request is out, nothing cached. */
  readonly placeholder: boolean;
  readonly blocked: AnalyticsBlockedVm | null;
  /** «Този бръснар вече не съществува…» — the scope fell back to the shop. */
  readonly notice: string | null;
  readonly body: AnalyticsBodyVm | null;
  /** The dock's «Експорт» — `null` while there are no figures to export. */
  readonly exportLabel: string | null;
  /** The ⓘ buttons' accessible names, by topic. */
  readonly infoLabels: Readonly<Record<AnalyticsTopic, string>>;
};

/** The ⓘ alert: a figure's definition in words. */
export type AnalyticsInfoVm = {
  readonly title: string;
  readonly message: string;
  readonly closeLabel: string;
};

/** One day of the time drill-down — or, on a year, one month, which opens the MONTH span. */
export type AnalyticsDayRowVm = {
  readonly id: string;
  readonly title: string;
  /** The month this row opens; `null` for a day. */
  readonly month: LocalDate | null;
  readonly detail: string;
  readonly value: string;
  readonly testId: string;
};

/** One barber of a shop drill-down; tapping it opens that barber's report. */
export type AnalyticsBarberRowVm = {
  readonly barberId: BarberId;
  readonly name: string;
  readonly avatarSrc: string | null;
  readonly detail: string | null;
  readonly value: string;
  readonly accessibleName: string;
  readonly testId: string;
};

/** What a drill-down lists — the field `drillRows`. */
export const DrillRows = {
  Seats: 'SEATS',
  Days: 'DAYS',
  Barbers: 'BARBERS',
} as const;
export type DrillRows = (typeof DrillRows)[keyof typeof DrillRows];

/** The drill-down page: the figure's rows and a footer equal to the figure. */
export type AnalyticsDrillVm = {
  readonly title: string;
  /** The figure's definition, under the title. */
  readonly lede: string;
  readonly drillRows: DrillRows;
  readonly sections: readonly VisitSectionVm[];
  readonly days: readonly AnalyticsDayRowVm[];
  readonly barbers: readonly AnalyticsBarberRowVm[];
  /** «Посещенията ще се покажат, щом данните се обновят.» — seat rows a cached report does not keep. */
  readonly waiting: string | null;
  readonly empty: string | null;
  readonly footerLabel: string;
  readonly footerValue: string;
  readonly closeLabel: string;
};
