import {
  ChangeDetectionStrategy,
  Component,
  computed,
  signal,
} from '@angular/core';
import {
  UiBarChart,
  UiChartPart,
  UiHeatmap,
  UiLineChart,
  UiRadar,
  UiRingChart,
  UiSparkBars,
  type UiChartBar,
  type UiChartHeatCell,
  type UiChartLinePoint,
  type UiChartRadarAxis,
  type UiChartRingSegment,
} from '@creativo/ui/charts';
import {
  UiButton,
  UiCard,
  UiSegmentedControl,
  type UiSegment,
} from '@creativo/ui/controls';
import { UiFlow, UiStack } from '@creativo/ui/layout';
import { UiTextDirective } from '@creativo/ui/modifiers';
import { ScDemo } from '@showcase/shared/demo';
import { ScPage } from '@showcase/shared/page';

/** Minutes as «4 ч 30 мин» — the owner formats, never the kit. */
function minutesText(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest} мин`;
  return rest === 0 ? `${hours} ч` : `${hours} ч ${rest} мин`;
}

const euro = new Intl.NumberFormat('bg-BG', {
  style: 'currency',
  currency: 'EUR',
  maximumFractionDigits: 0,
});

const DAYS = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'нд'] as const;

/** A week of the chair's time, in minutes: worked, no-show, unmarked, blocked, unsold, other. */
const WEEK_A: readonly (readonly number[])[] = [
  [300, 30, 0, 60, 90, 0],
  [420, 0, 30, 0, 30, 0],
  [360, 60, 0, 0, 60, 0],
  [240, 0, 0, 120, 120, 0],
  [450, 30, 0, 0, 0, 0],
  [180, 0, 60, 0, 180, 60],
  [0, 0, 0, 0, 0, 0],
];
const WEEK_B: readonly (readonly number[])[] = [
  [360, 0, 0, 60, 60, 0],
  [300, 60, 30, 0, 90, 0],
  [420, 0, 0, 0, 60, 0],
  [300, 30, 0, 60, 90, 0],
  [390, 0, 30, 0, 60, 0],
  [240, 0, 0, 0, 180, 60],
  [0, 0, 0, 0, 0, 0],
];
const TIME_PARTS = [
  UiChartPart.Worked,
  UiChartPart.NoShow,
  UiChartPart.Unmarked,
  UiChartPart.Blocked,
  UiChartPart.Unsold,
  UiChartPart.Other,
] as const;
const TIME_WORDS: ReadonlyMap<UiChartPart, string> = new Map([
  [UiChartPart.Worked, 'Работа'],
  [UiChartPart.NoShow, 'Неявяване'],
  [UiChartPart.Unmarked, 'Неотбелязано'],
  [UiChartPart.Blocked, 'Блокирано'],
  [UiChartPart.Unsold, 'Непродадено'],
  [UiChartPart.Other, 'Друго'],
]);

type LegendRow = {
  readonly part: UiChartPart;
  readonly word: string;
  readonly value: string;
};

const TAKINGS_A = [120, 240, 180, 60, 300, 210, 0];
const TAKINGS_B = [150, 180, 210, 120, 270, 240, 0];
const TAKINGS_LAST = [100, 200, 160, 90, 250, 180, 0];

/** The radar's five axes, in the design's order. */
const RADAR_AXES = [
  '€ / час',
  'Заетост',
  'Връщат се',
  'Бакшиши',
  'Среден чек',
] as const;

/** One barber's radar as the presenter would hand it over: the figures 0 … 100 and their words. */
type RadarDemo = {
  readonly name: string;
  readonly tone: number;
  readonly values: readonly (number | null)[];
  readonly comparison: readonly (number | null)[];
  readonly valueText: readonly string[];
  readonly label: string;
};

const RADARS_A: readonly RadarDemo[] = [
  {
    name: 'Иван',
    tone: 0,
    values: [100, 82, 64, 70, 90],
    comparison: [88, 76, 70, 62, 95],
    valueText: ['38 €', '82 %', '64 %', '7,1 %', '1 закъснение'],
    label:
      'Иван: най-висок оборот на час, 82 % запълване, 64 % презаписване, 7,1 % бакшиши, 1 закъснение',
  },
  {
    name: 'Мария',
    tone: 1,
    values: [76, 100, 100, null, 100],
    comparison: [80, 92, 96, null, 100],
    valueText: ['29 €', '96 %', '81 %', '', 'без закъснения'],
    label:
      'Мария: 29 € на час, най-пълен график и най-много презаписвания, малко данни за бакшишите, без закъснения',
  },
  {
    name: 'Георги',
    tone: 2,
    values: [58, 61, 40, 100, 60],
    comparison: [],
    valueText: ['22 €', '50 %', '32 %', '11,4 %', '4 закъснения'],
    label:
      'Георги: 22 € на час, 50 % запълване, 32 % презаписване, най-много бакшиши, 4 закъснения',
  },
];

const RADARS_B: readonly RadarDemo[] = [
  {
    ...(RADARS_A[0] as RadarDemo),
    values: [92, 70, 80, 55, 80],
    valueText: ['35 €', '70 %', '80 %', '5,6 %', '2 закъснения'],
  },
  {
    ...(RADARS_A[1] as RadarDemo),
    values: [100, 88, 90, 48, 100],
    valueText: ['38 €', '88 %', '90 %', '4,9 %', 'без закъснения'],
  },
  {
    ...(RADARS_A[2] as RadarDemo),
    values: [63, 74, null, 100, 70],
    valueText: ['24 €', '74 %', '', '10,2 %', '3 закъснения'],
  },
];

/** A bento tile as the presenter would hand it over: the words, the bars and the decisions. */
type SparkTile = {
  readonly id: string;
  readonly caption: string;
  readonly figure: string;
  readonly sub: string;
  readonly values: readonly number[];
  readonly highlight: number | null;
  readonly average: number | null;
  readonly valueText: readonly string[];
  readonly label: string;
  /** A part hook on the host repaints the series (`no-show` → the destructive red). */
  readonly part: UiChartPart | null;
};

const TAKINGS_WEEK = [180, 240, 0, 320, 410, 520, 90];
const BOOKINGS_MONTH = [
  6, 8, 7, 0, 9, 12, 11, 7, 9, 8, 0, 10, 13, 12, 8, 7, 9, 10, 0, 11, 14, 13, 9,
  8, 10, 9, 0, 12, 15, 14,
];
const NO_SHOWS_WEEKS = [2, 1, 3, 0, 1, 2, 4, 1];

const SPARK_TILES: readonly SparkTile[] = [
  {
    id: 'takings',
    caption: 'Оборот',
    figure: euro.format(1760),
    sub: 'тази седмица',
    values: TAKINGS_WEEK,
    // The presenter's decision, hard-coded here: today is Saturday.
    highlight: 5,
    average: null,
    valueText: TAKINGS_WEEK.map((value) => euro.format(value)),
    label: 'Оборот тази седмица: 1 760 €, най-много в събота, 520 €',
    part: null,
  },
  {
    id: 'bookings',
    caption: 'Записвания',
    figure: '264',
    sub: 'ноември · ср. 9 на ден',
    values: BOOKINGS_MONTH,
    highlight: null,
    average: 9,
    valueText: BOOKINGS_MONTH.map((value) => `${value}`),
    label: 'Записвания по дни през ноември: 264, средно 9 на ден',
    part: null,
  },
  {
    id: 'no-shows',
    caption: 'Неявявания',
    figure: '14',
    sub: 'последните 8 седмици',
    values: NO_SHOWS_WEEKS,
    highlight: null,
    average: null,
    valueText: NO_SHOWS_WEEKS.map((value) => `${value}`),
    label: 'Неявявания по седмици: 14 за 8 седмици, най-много миналата',
    part: UiChartPart.NoShow,
  },
];

const MONTHS = ['яну', 'фев', 'мар', 'апр', 'май', 'юни'] as const;
const TAKINGS_HALF = [1840, 2210, 1960, 2480, 2730, 2390];

/** The detail screen's three views of one figure. */
type DetailView = 'line' | 'bars' | 'ring';

/** Takings by service over the same half year: one share each, the largest in the accent. */
const SERVICE_SHARES: readonly UiChartRingSegment[] = [
  {
    label: 'Подстригване',
    value: 6200,
    part: UiChartPart.Worked,
    tone: null,
    valueText: euro.format(6200),
  },
  {
    label: 'Подстригване и брада',
    value: 3900,
    part: UiChartPart.Blocked,
    tone: null,
    valueText: euro.format(3900),
  },
  {
    label: 'Брада',
    value: 2100,
    part: UiChartPart.Unsold,
    tone: null,
    valueText: euro.format(2100),
  },
  {
    label: 'Детско и бръснене',
    value: 1410,
    part: UiChartPart.Other,
    tone: null,
    valueText: euro.format(1410),
  },
];

/** Takings by barber: a person is a tone, never a part. */
const BARBER_SHARES_A: readonly UiChartRingSegment[] = [
  {
    label: 'Иван',
    value: 5400,
    part: null,
    tone: 0,
    valueText: euro.format(5400),
  },
  {
    label: 'Мария',
    value: 4700,
    part: null,
    tone: 1,
    valueText: euro.format(4700),
  },
  {
    label: 'Георги',
    value: 3100,
    part: null,
    tone: 2,
    valueText: euro.format(3100),
  },
  {
    label: 'Ана',
    value: 410,
    part: null,
    tone: 3,
    valueText: euro.format(410),
  },
];
const BARBER_SHARES_B: readonly UiChartRingSegment[] = [
  {
    label: 'Иван',
    value: 4200,
    part: null,
    tone: 0,
    valueText: euro.format(4200),
  },
  {
    label: 'Мария',
    value: 5100,
    part: null,
    tone: 1,
    valueText: euro.format(5100),
  },
  {
    label: 'Георги',
    value: 3600,
    part: null,
    tone: 2,
    valueText: euro.format(3600),
  },
  {
    label: 'Ана',
    value: 1300,
    part: null,
    tone: 3,
    valueText: euro.format(1300),
  },
];

@Component({
  selector: 'cr-charts-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ScDemo,
    ScPage,
    UiBarChart,
    UiButton,
    UiCard,
    UiFlow,
    UiHeatmap,
    UiLineChart,
    UiRadar,
    UiRingChart,
    UiSegmentedControl,
    UiSparkBars,
    UiStack,
    UiTextDirective,
  ],
  templateUrl: './charts.page.html',
  styleUrl: './charts.page.css',
})
export class ChartsPage {
  /** The live demo: a second week swapped in, so the bars glide and the line cross-fades. */
  protected readonly alternate = signal(false);

  private readonly week = computed(() => (this.alternate() ? WEEK_B : WEEK_A));

  protected readonly weekBars = computed<readonly UiChartBar[]>(() =>
    this.week().map((minutes, day) => ({
      label: DAYS.at(day) ?? '',
      parts: TIME_PARTS.map((part, i) => ({ part, value: minutes.at(i) ?? 0 })),
    })),
  );

  protected readonly weekValueText = computed(() =>
    this.week().map((minutes) =>
      minutesText(minutes.reduce((sum, value) => sum + value, 0)),
    ),
  );

  protected readonly weekLegend = computed<readonly LegendRow[]>(() =>
    TIME_PARTS.map((part, i) => ({
      part,
      word: TIME_WORDS.get(part) ?? part,
      value: minutesText(
        this.week().reduce((sum, minutes) => sum + (minutes.at(i) ?? 0), 0),
      ),
    })),
  );

  /** DAY: one stacked bar. */
  protected readonly dayBars: readonly UiChartBar[] = [
    {
      label: '',
      parts: TIME_PARTS.map((part, i) => ({
        part,
        value: WEEK_A.at(1)?.at(i) ?? 0,
      })),
    },
  ];
  protected readonly dayValueText = [minutesText(480)];

  /** Which services sell: ranked, € on the row. */
  protected readonly serviceBars: readonly UiChartBar[] = [
    {
      label: 'Подстригване',
      parts: [{ part: UiChartPart.Worked, value: 840 }],
    },
    { label: 'Брада', parts: [{ part: UiChartPart.Worked, value: 360 }] },
    {
      label: 'Подстригване и брада',
      parts: [{ part: UiChartPart.Worked, value: 1260 }],
    },
    { label: 'Детско', parts: [{ part: UiChartPart.Worked, value: 180 }] },
    { label: 'Бръснене', parts: [{ part: UiChartPart.Worked, value: 150 }] },
  ];
  protected readonly serviceValueText = this.serviceBars.map(
    (bar) =>
      `${euro.format(bar.parts[0]?.value ?? 0)} · ${Math.round((bar.parts[0]?.value ?? 0) / 30)} бр.`,
  );

  /** Free time ahead: seven bars of open minutes, the emptiest in the accent. */
  protected readonly openBars: readonly UiChartBar[] = [
    120, 60, 240, 30, 180, 300, 0,
  ].map((value, day) => ({
    label: DAYS.at(day) ?? '',
    parts: [{ part: UiChartPart.Worked, value }],
  }));
  protected readonly openValueText = [120, 60, 240, 30, 180, 300, 0].map(
    minutesText,
  );
  /** The presenter's decision, hard-coded here: Saturday has the most open time. */
  protected readonly emptiestDay = 5;

  /** Where bookings come from: one horizontal stacked bar. */
  protected readonly sourceBars: readonly UiChartBar[] = [
    {
      label: '',
      parts: [
        { part: UiChartPart.Online, value: 34 },
        { part: UiChartPart.Staff, value: 21 },
        { part: UiChartPart.Unknown, value: 5 },
      ],
    },
  ];
  protected readonly sourceLegend: readonly LegendRow[] = [
    { part: UiChartPart.Online, word: 'Онлайн', value: '34' },
    { part: UiChartPart.Staff, word: 'От салона', value: '21' },
    { part: UiChartPart.Unknown, word: 'Неизвестно', value: '5' },
  ];

  /** Takings by day against the week before, with the average. */
  protected readonly takings = computed<readonly UiChartLinePoint[]>(() => {
    const values = this.alternate() ? TAKINGS_B : TAKINGS_A;
    return values.map((value, day) => ({
      label: DAYS.at(day) ?? '',
      value,
      comparison: day === 6 ? null : (TAKINGS_LAST.at(day) ?? null),
    }));
  });
  protected readonly takingsValueText = computed(() =>
    this.takings().map((point) =>
      point.value === null ? '' : euro.format(point.value),
    ),
  );
  protected readonly takingsAverage = computed(() => {
    const points = this.takings();
    const sum = points.reduce((total, point) => total + (point.value ?? 0), 0);
    return Math.round(sum / points.length);
  });
  protected readonly takingsAverageText = computed(
    () => `ср. ${euro.format(this.takingsAverage())}`,
  );

  /** When the chair is busy: weekday × hour, worked over rostered minutes. */
  protected readonly hours = [
    '9',
    '10',
    '11',
    '12',
    '13',
    '14',
    '15',
    '16',
    '17',
    '18',
  ];
  protected readonly heatRows = DAYS.slice(0, 6);
  protected readonly heatCells: readonly UiChartHeatCell[] =
    this.heatRows.flatMap((_, row) =>
      this.hours.flatMap((_, column) => {
        if (row === 5 && column > 5) return [];
        const value = Math.round(
          30 +
            30 * Math.sin((column + 1) / 3 + row / 2) * (row === 5 ? 0.5 : 1),
        );
        return [{ row, column, value: Math.max(0, value), max: 60 }];
      }),
    );

  /** How each barber does: one radar per person in their identity tone, the month before as the grey outline. */
  protected readonly radarAlternate = signal(false);

  protected readonly radars = computed(() =>
    (this.radarAlternate() ? RADARS_B : RADARS_A).map((radar) => ({
      name: radar.name,
      tone: radar.tone,
      label: radar.label,
      valueText: radar.valueText,
      axes: RADAR_AXES.map((label, i): UiChartRadarAxis => ({
        label,
        value: radar.values.at(i) ?? null,
        comparison: radar.comparison.at(i) ?? null,
      })),
    })),
  );

  /** The bento tiles: a figure over a bar sparkline each. */
  protected readonly sparkTiles = SPARK_TILES;

  /** The detail screen: one figure, its drawing switched between line, bars and ring. */
  protected readonly detailView = signal<DetailView>('line');
  protected readonly detailViews: readonly UiSegment[] = [
    { id: 'line', label: 'Линия', icon: 'chart.line', iconOnly: true },
    { id: 'bars', label: 'Стълбове', icon: 'chart.bars', iconOnly: true },
    { id: 'ring', label: 'Кръг', icon: 'chart.ring', iconOnly: true },
  ];
  protected readonly halfYear: readonly UiChartLinePoint[] = TAKINGS_HALF.map(
    (value, month) => ({
      label: MONTHS.at(month) ?? '',
      value,
      comparison: null,
    }),
  );
  protected readonly halfYearText = TAKINGS_HALF.map((value) =>
    euro.format(value),
  );
  protected readonly halfYearBars: readonly UiChartBar[] = TAKINGS_HALF.map(
    (value, month) => ({
      label: MONTHS.at(month) ?? '',
      parts: [{ part: UiChartPart.Worked, value }],
    }),
  );
  protected readonly halfYearTotal = euro.format(
    TAKINGS_HALF.reduce((sum, value) => sum + value, 0),
  );
  /** The presenter's decision, hard-coded here: May took the most. */
  protected readonly halfYearBest = 4;
  protected readonly serviceShares = SERVICE_SHARES;

  /** Takings by barber as a ring, a second half swapped in so it cross-fades. */
  protected readonly barberAlternate = signal(false);
  protected readonly barberShares = computed(() =>
    this.barberAlternate() ? BARBER_SHARES_B : BARBER_SHARES_A,
  );
  protected readonly barberTotal = computed(() =>
    euro.format(
      this.barberShares().reduce((sum, segment) => sum + segment.value, 0),
    ),
  );

  protected readonly picked = signal<string | null>(null);

  protected pickView(id: string): void {
    if (id === 'line' || id === 'bars' || id === 'ring')
      this.detailView.set(id);
  }

  protected toggleBarbers(): void {
    this.barberAlternate.update((value) => !value);
  }

  protected onPicked(bars: readonly UiChartBar[], index: number): void {
    this.picked.set(bars.at(index)?.label || `#${index + 1}`);
  }

  protected toggle(): void {
    this.alternate.update((value) => !value);
  }

  protected toggleRadars(): void {
    this.radarAlternate.update((value) => !value);
  }
}
