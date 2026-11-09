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
  type UiChartBar,
  type UiChartHeatCell,
  type UiChartLinePoint,
  type UiChartRadarAxis,
} from '@creativo/ui/charts';
import { UiButton, UiCard } from '@creativo/ui/controls';
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
  'Запълване',
  'Презаписване',
  'Бакшиши',
  'Надеждност',
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
    this.takings().map((point) => euro.format(point.value)),
  );
  protected readonly takingsAverage = computed(() => {
    const points = this.takings();
    const sum = points.reduce((total, point) => total + point.value, 0);
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

  protected readonly picked = signal<string | null>(null);

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
