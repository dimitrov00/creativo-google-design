import type { BarberId, LocalDate, LocationId } from '@core/primitives';
import type { UiChoiceOption } from '@creativo/ui/controls';
import type { UiIconName } from '@creativo/ui/icons';
import type {
  AnalyticsBlockedVm,
  AnalyticsGoalVm,
  AnalyticsScheduleLink,
  AnalyticsStatusVm,
} from './analytics.vm';

/*
 * THE REVOLUT-LAYOUT HOME'S DISPLAY MODEL (staff-analytics-v3, Law 10.3) —
 * the title, the two menus, the carousel's pages of bento cards and what
 * sits under them. Types and tag tables only; `analytics-home.presenter.ts`
 * builds them.
 */

/**
 * The bento cards, each its own screen — the value is the route segment
 * (`/staff/analytics/<card>`) and the test id's tail. External contract.
 */
export const AnalyticsCard = {
  Takings: 'takings',
  Time: 'time',
  Tips: 'tips',
  Rebooked: 'rebooked',
  NoShows: 'no-shows',
  Team: 'team',
  Locations: 'locations',
} as const;
export type AnalyticsCard = (typeof AnalyticsCard)[keyof typeof AnalyticsCard];

/**
 * The home's tiles (owner review 2026-11-09, round 4), each opening a
 * card's screen: the takings, the working time, the FREE time (the time
 * screen), the tips and the CLIENTS (the clients' screen). The value is
 * the tile's test id's tail.
 */
export const AnalyticsTile = {
  Takings: 'takings',
  Time: 'time',
  Free: 'free',
  Tips: 'tips',
  Clients: 'clients',
} as const;
export type AnalyticsTile = (typeof AnalyticsTile)[keyof typeof AnalyticsTile];

/** A card's tiny bar graph (`ui-spark-bars`). */
export type AnalyticsSparkVm = {
  readonly values: readonly number[];
  /** The bar in the paint — the bucket holding today, or the period's last. */
  readonly highlight: number | null;
  /** The dashed average, in the values' unit; `null` draws none. */
  readonly average: number | null;
  /** «28,00 €» per bar — the hidden table's. */
  readonly valueText: readonly string[];
  /** «1», «2» … per bar — the hidden table's row names. */
  readonly labels: readonly string[];
  readonly label: string;
};

/**
 * The takings card's PACE (`ui-spark-line`): this period's running total
 * against the previous period's, and the legend that words both — what a
 * barber reads as "where am I against last month by this day".
 */
export type AnalyticsPaceVm = {
  /** The running total per bucket, in cents, up to today's. */
  readonly values: readonly number[];
  /** The previous period's, over every bucket; `null` draws none. */
  readonly comparison: readonly number[] | null;
  readonly slots: number;
  /** The period's first and last day under the line's ends — «1.10» · «31.10». */
  readonly startLabel: string;
  readonly endLabel: string;
  /** The legend: «Този месец» · «136,50 €», then «Миналия месец» · «92,30 €» by the same day. */
  readonly currentLabel: string;
  readonly currentValue: string;
  readonly previousLabel: string | null;
  readonly previousValue: string | null;
};

/** A card's meter (`ui-gauge`): a part of a whole, worded. */
export type AnalyticsMeterVm = {
  readonly value: number;
  readonly max: number;
  readonly label: string;
  readonly valueText: string;
};

/** One bento card: a word, a figure, a line under it and one tiny graph. */
export type AnalyticsBentoCardVm = {
  readonly card: AnalyticsTile;
  /** The card screen a tap opens — its route segment. */
  readonly screen: AnalyticsCard;
  readonly title: string;
  readonly value: string;
  /** The change against the previous period — «+30 %»; `null` without one. */
  readonly delta: string | null;
  readonly trend: 'up' | 'down' | null;
  readonly detail: string | null;
  readonly spark: AnalyticsSparkVm | null;
  /** The takings' pace — the takings card's line. */
  readonly pace: AnalyticsPaceVm | null;
  /** A capacity bar (worked of rostered). */
  readonly bar: AnalyticsMeterVm | null;
  /** A ring (rebooked of base, no-shows of base). */
  readonly ring: AnalyticsMeterVm | null;
  /** Spans both columns. */
  readonly wide: boolean;
  readonly accessibleName: string;
  readonly testId: string;
};

/** One barber's row of the team card: the name, the takings and the bar's length. */
export type AnalyticsTeamRowVm = {
  readonly barberId: BarberId;
  readonly name: string;
  readonly value: string;
  /** The bar's length, `0 … 1` of the best barber's takings. */
  readonly share: number;
  /** `0…4` — `--sys-identity-N` in the catalogue's order. */
  readonly tone: number;
};

/** The shop's team card: each barber's takings as a bar. */
export type AnalyticsTeamCardVm = {
  readonly title: string;
  readonly rows: readonly AnalyticsTeamRowVm[];
  readonly accessibleName: string;
  readonly testId: string;
};

/**
 * One location's row — the home card's and the locations screen's: its
 * name, its takings, the bar's length against the best one, its identity
 * tone (the shop's location order, never the rank) and, on the screen,
 * the line of figures under it.
 */
export type AnalyticsLocationRowVm = {
  readonly locationId: LocationId;
  readonly name: string;
  readonly value: string;
  /** The bar's length, `0 … 1` of the best location's takings. */
  readonly share: number;
  /** `0…4` — `--sys-identity-N`, in the shop's location order. */
  readonly tone: number;
  /** «72% заетост · 14 клиента · 3 нови». */
  readonly detail: string;
  readonly testId: string;
};

/** The shop's locations compared: each one's takings as a bar. */
export type AnalyticsLocationsCardVm = {
  readonly title: string;
  readonly rows: readonly AnalyticsLocationRowVm[];
  readonly accessibleName: string;
  readonly testId: string;
};

/** One page of the carousel: a period's bento, or `null` while its report is not here. */
export type AnalyticsPageVm = {
  /** The period's first day and span — the track key. */
  readonly key: string;
  readonly label: string;
  readonly cards: readonly AnalyticsBentoCardVm[] | null;
  readonly team: AnalyticsTeamCardVm | null;
  /** The shop's locations compared — on the shop over two or more locations. */
  readonly locations: AnalyticsLocationsCardVm | null;
  /** The card screens' query: this page's period and the scope. */
  readonly query: AnalyticsCardQuery;
};

/** What a card hands its screen in the URL. */
export type AnalyticsCardQuery = {
  readonly span: string;
  readonly from: LocalDate;
  readonly to: LocalDate | null;
  readonly barber: BarberId | null;
  readonly location: LocationId | null;
};

/**
 * The scope menu's option ids beside the barber ids: the whole shop, and
 * the prefix of a location's (`location:loc-centre`, ADR 2026-11-09).
 */
export const AnalyticsScopeOption = {
  Shop: 'shop',
  LocationPrefix: 'location:',
} as const;

/** A dropdown of the top row: its trigger's word and its options. */
export type AnalyticsMenuVm = {
  readonly label: string;
  /** The menu's accessible name — «Чии данни», «Период». */
  readonly menuLabel: string;
  readonly options: readonly UiChoiceOption[];
  readonly selected: string | null;
  /** The disc leading the trigger — the scope's alone; `null` for none. */
  readonly leading: AnalyticsMenuLeadingVm | null;
  readonly testId: string;
};

/**
 * The scope trigger's disc, as Revolut's «Personal ⌄» carries the face: the
 * chosen barber's portrait (their monogram without one), or the shop's
 * glyph.
 */
export type AnalyticsMenuLeadingVm = {
  readonly avatarSrc: string | null;
  readonly name: string;
  /** The glyph in place of a monogram — the shop's; `null` for a person. */
  readonly icon: UiIconName | null;
};

/** «Предстои»: the next 7 days' open hours, opening the schedule. */
export type AnalyticsAheadCardVm = {
  readonly title: string;
  readonly value: string;
  readonly detail: string;
  readonly spark: AnalyticsSparkVm;
  readonly link: AnalyticsScheduleLink | null;
  readonly accessibleName: string;
};

/** What a row of «Инструменти» does — the field `tool`. */
export const AnalyticsTool = {
  /** «Задай цел» / «Промени целта» — the goal sheet. */
  Goal: 'GOAL',
  /** «Експорт» — the CSV. */
  Export: 'EXPORT',
} as const;
export type AnalyticsTool = (typeof AnalyticsTool)[keyof typeof AnalyticsTool];

/** A row of «Инструменти». */
export type AnalyticsToolRowVm = {
  readonly tool: AnalyticsTool;
  readonly title: string;
  readonly detail: string;
  readonly testId: string;
};

/** The home screen. */
export type AnalyticsHomeVm = {
  readonly title: string;
  readonly backLabel: string;
  readonly freshness: AnalyticsStatusVm | null;
  readonly retryLabel: string;
  /** The scope menu — the admin's alone. */
  readonly scope: AnalyticsMenuVm | null;
  /** The period menu: its word is the page on screen, its options the grain. */
  readonly period: AnalyticsMenuVm;
  readonly pages: readonly AnalyticsPageVm[];
  /** The page on screen. */
  readonly pageIndex: number;
  readonly blocked: AnalyticsBlockedVm | null;
  readonly notice: string | null;
  /** Under the carousel. */
  readonly goal: AnalyticsGoalVm | null;
  readonly ahead: AnalyticsAheadCardVm | null;
  readonly toolsTitle: string;
  readonly tools: readonly AnalyticsToolRowVm[];
};
