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
  type UiChartBar,
  type UiChartHeatCell,
  type UiChartLinePoint,
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

  protected readonly picked = signal<string | null>(null);

  protected onPicked(bars: readonly UiChartBar[], index: number): void {
    this.picked.set(bars.at(index)?.label || `#${index + 1}`);
  }

  protected toggle(): void {
    this.alternate.update((value) => !value);
  }
}
