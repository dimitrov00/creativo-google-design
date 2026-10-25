import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { LocalDate } from '@core/primitives';
import type { UiMonthPickerRelative } from '@creativo/ui/controls';
import { UiMonthPicker } from '@creativo/ui/controls';
import { UiFlow, UiStack } from '@creativo/ui/layout';
import { UiTextDirective } from '@creativo/ui/modifiers';
import type { UiDateBadgeState } from '@creativo/ui/patterns';
import { UiCalendarGrid, UiCard, UiDateBadge } from '@creativo/ui/patterns';
import { ScDemo } from '@showcase/shared/demo';
import { ScPage } from '@showcase/shared/page';

interface BadgeSample {
  readonly label: string;
  readonly day: number;
  readonly state: UiDateBadgeState;
  readonly today: boolean;
  readonly marker: boolean;
}

/**
 * A day of October 2026 — a real day by construction (civil arithmetic,
 * nothing to refuse), as the menu page builds its own.
 */
const october = (day: number): LocalDate =>
  LocalDate.fromEpochDay(LocalDate.epochDayOf(2026, 10, day));

/** A fixed today, so the page draws the same month on every visit. */
const TODAY = october(6);

@Component({
  selector: 'cr-month-picker-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ScDemo,
    ScPage,
    UiCalendarGrid,
    UiCard,
    UiDateBadge,
    UiFlow,
    UiMonthPicker,
    UiStack,
    UiTextDirective,
  ],
  templateUrl: './month-picker.page.html',
  styleUrl: './month-picker.page.css',
})
export class MonthPickerPage {
  protected readonly today = TODAY;
  protected readonly selected = signal(october(14));
  protected readonly min = october(1);
  protected readonly largeSelected = signal(TODAY);

  protected readonly relatives: readonly UiMonthPickerRelative[] = [
    { offset: 0, label: 'Днес' },
    { offset: 1, label: 'Утре' },
  ];

  /** A series' days: the dots the picker draws under them. */
  protected readonly marked: readonly LocalDate[] = [
    october(7),
    october(14),
    october(21),
    october(28),
  ];

  /** The badge's states, one each, with the day they stand for. */
  protected readonly badges: readonly BadgeSample[] = [
    { label: 'plain', day: 5, state: 'plain', today: false, marker: false },
    { label: 'today', day: 6, state: 'plain', today: true, marker: false },
    {
      label: 'selected',
      day: 14,
      state: 'selected',
      today: false,
      marker: false,
    },
    {
      label: 'selected + today',
      day: 6,
      state: 'selected',
      today: true,
      marker: false,
    },
    { label: 'marker', day: 21, state: 'plain', today: false, marker: true },
    {
      label: 'selected + marker',
      day: 21,
      state: 'selected',
      today: false,
      marker: true,
    },
    {
      label: 'outside',
      day: 31,
      state: 'outside',
      today: false,
      marker: false,
    },
    {
      label: 'unavailable',
      day: 2,
      state: 'unavailable',
      today: false,
      marker: false,
    },
  ];

  /** Monday-first, as every month in the app is laid out. */
  protected readonly weekdays: readonly string[] = [
    'пн',
    'вт',
    'ср',
    'чт',
    'пт',
    'сб',
    'нд',
  ];

  /** October 2026 as the review step draws it: a stated month, one day marked. */
  protected readonly reviewWeeks: readonly (number | null)[][] = [
    [null, null, null, 1, 2, 3, 4],
    [5, 6, 7, 8, 9, 10, 11],
    [12, 13, 14, 15, 16, 17, 18],
    [19, 20, 21, 22, 23, 24, 25],
    [26, 27, 28, 29, 30, 31, null],
  ];
  protected readonly reviewDay = 14;
}
