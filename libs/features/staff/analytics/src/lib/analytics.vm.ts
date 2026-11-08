import { AnalyticsBarPart, AnalyticsFigure } from '@core/components';
import type { BarberId, LocalDate, ServiceId } from '@core/primitives';
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
  /** The callable refused the account (`ANALYTICS_FORBIDDEN`, `…_BARBER_NOT_LINKED`). */
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
  Fill: 'FILL',
  Origins: 'ORIGINS',
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
 * Each time-bar part's CSS hook (`data-part`) — the shape it is drawn as
 * (the accent law: colour is a shape; worked is the one orange, the rest
 * graded ink). Values: external contract, the stylesheet's selectors.
 */
export const BAR_PART_HOOKS = {
  [AnalyticsBarPart.Worked]: 'worked',
  [AnalyticsBarPart.NoShow]: 'no-show',
  [AnalyticsBarPart.Unmarked]: 'unmarked',
  [AnalyticsBarPart.Blocked]: 'blocked',
  [AnalyticsBarPart.Unsold]: 'unsold',
  [AnalyticsBarPart.Other]: 'other',
} as const satisfies Record<AnalyticsBarPart, string>;

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

/** The period switcher: Week | Month, and ‹ the period › . */
export type AnalyticsPeriodVm = {
  readonly spanLabel: string;
  readonly spans: readonly UiSegment[];
  readonly selectedSpan: string;
  /** «Септември 2026» · «28.09 – 4.10». */
  readonly label: string;
  readonly previousLabel: string;
  readonly previousEnabled: boolean;
  readonly nextLabel: string;
  readonly nextEnabled: boolean;
};

/** One tile of the admin's scope picker. */
export type AnalyticsScopeTileVm = {
  /** The barber record, or `null` for the shop. */
  readonly scopeBarberId: BarberId | null;
  readonly name: string;
  readonly avatarSrc: string | null;
  readonly selected: boolean;
  readonly testId: string;
};

/** The admin's scope picker; `null` for a barber, who sees only themselves. */
export type AnalyticsScopeVm = {
  readonly label: string;
  readonly tiles: readonly AnalyticsScopeTileVm[];
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
  /** The CSS hook (`BAR_PART_HOOKS`). */
  readonly part: string;
  /** Its share of the bar, `0…1` — the segment's width. */
  readonly share: number;
  readonly label: string;
  /** «4 ч 30 мин». */
  readonly value: string;
  readonly testId: string;
};

export type AnalyticsTimeVm = {
  readonly title: string;
  readonly barName: string;
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
  readonly accessibleName: string;
};

/** A row with a share bar: a service, a weekday's fill, a booking origin. */
export type AnalyticsShareRowVm = {
  readonly id: string;
  readonly title: string;
  readonly detail: string;
  readonly value: string;
  /** `0…1` — the bar under the row. */
  readonly share: number;
  /** The service the row drills into; `null` for a row that opens nothing. */
  readonly drill: AnalyticsDrill | null;
  readonly testId: string;
};

export type AnalyticsShareGroupVm = {
  readonly title: string;
  readonly rows: readonly AnalyticsShareRowVm[];
  /** «Още няма отработени услуги.» — `null` while there are rows. */
  readonly empty: string | null;
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
  readonly time: AnalyticsTimeVm;
  readonly open: AnalyticsOpenVm;
  readonly services: AnalyticsShareGroupVm;
  readonly clients: AnalyticsClientsVm;
  /** The shop's alone: fill by weekday, booking origins. */
  readonly fill: AnalyticsShareGroupVm | null;
  readonly origins: AnalyticsShareGroupVm | null;
};

/** Why there are no figures: a refusal, or a request that failed with nothing cached. */
export type AnalyticsBlockedVm = {
  readonly text: string;
  readonly retry: boolean;
  readonly testId: string;
};

/** The whole screen. */
export type AnalyticsVm = {
  readonly title: string;
  readonly backLabel: string;
  readonly freshness: AnalyticsStatusVm | null;
  readonly retryLabel: string;
  readonly period: AnalyticsPeriodVm;
  readonly scope: AnalyticsScopeVm | null;
  /** The placeholder layout: the first request is out, nothing cached. */
  readonly placeholder: boolean;
  readonly blocked: AnalyticsBlockedVm | null;
  /** «Този бръснар вече не съществува…» — the scope fell back to the shop. */
  readonly notice: string | null;
  readonly body: AnalyticsBodyVm | null;
  /** The ⓘ buttons' accessible names, by topic. */
  readonly infoLabels: Readonly<Record<AnalyticsTopic, string>>;
};

/** The ⓘ alert: a figure's definition in words. */
export type AnalyticsInfoVm = {
  readonly title: string;
  readonly message: string;
  readonly closeLabel: string;
};

/** One day of the time drill-down. */
export type AnalyticsDayRowVm = {
  readonly id: string;
  readonly title: string;
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
