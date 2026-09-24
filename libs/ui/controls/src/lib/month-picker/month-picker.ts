import {
  ChangeDetectionStrategy,
  Component,
  ViewEncapsulation,
  computed,
  input,
  linkedSignal,
  output,
} from '@angular/core';
import { UiSpacer, UiStack } from '@creativo/ui/layout';
import {
  UiFontDirective,
  UiForegroundStyleDirective,
  UiInteractiveDirective,
  UiRadiusDirective,
  UiTextDirective,
  UiWeightDirective,
} from '@creativo/ui/modifiers';
import {
  UiCalendarGrid,
  type UiCalendarGridSize,
  UiDateBadge,
} from '@creativo/ui/patterns';
import { UiButton } from '../button/button';
import { UiChip } from '../chip/chip';
import { UiIcon } from '../icon/icon';

/** `YYYY-MM-DD`. The one shape every date on this surface travels as. */
export type UiDayKey = string;

/** One relative shortcut offered above the grid. */
export interface UiMonthPickerRelative {
  /** `0` is today, `1` tomorrow. Resolved against `uiToday`. */
  readonly offset: number;
  readonly label: string;
}

const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;

/** Monday-first: the week Bulgaria and most of Europe reads. */
function leadingBlanks(firstWeekdayIndex: number): number {
  return (firstWeekdayIndex + 6) % 7;
}

function addDays(dayKey: UiDayKey, delta: number): UiDayKey {
  const [year, month, day] = dayKey.split('-').map(Number);
  const at = new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1));
  at.setUTCDate(at.getUTCDate() + delta);
  return at.toISOString().slice(0, 10);
}

/**
 * A month of days, paged, with the selected day and today marked — the whole
 * calendar half of a date picker, minus the trigger that opens it.
 *
 * ### Why this exists
 * This app had TWO month pickers, hand-assembled: the staff day's date
 * pull-down and the visit sheet's frame. They had drifted in every dimension
 * a thing can drift in — `plain` step buttons against `bordered`, a weekday
 * row built from `weekday: 'long'` through a bespoke abbreviator against one
 * taking `Intl`'s own `short`, one grid sized and one not, relative chips on
 * one and not the other. **The same bug had already been fixed twice**: both
 * rendered bare numerals instead of `ui-date-badge`, so neither highlighted
 * the selected day OR today, and somebody found that, fixed it, and found it
 * again in the other file. That is the duplication charging rent, and it is
 * what this component exists to stop.
 *
 * ### What it owns, and what it does not
 * It owns the month header and its paging, ONE weekday algorithm, the grid,
 * and which cell reads as selected and which as today. It owns NO trigger:
 * a page title and a field value are legitimately different controls, and
 * folding them together is how a component ends up with a `variant` input
 * that means "which of my two consumers am I".
 *
 * ### Browsing is not choosing
 * Paging moves the month on screen and never the selection — the same
 * separation both hand-rolled versions had, and the reason the browsed month
 * is a `linkedSignal` on the selection rather than derived from it: opening
 * the picker again lands on the selected day's month, but paging away from
 * it survives until then.
 *
 * ```html
 * <ui-month-picker
 *   [uiSelected]="dayKey()"
 *   [uiToday]="todayKey()"
 *   [uiLocale]="locale()"
 *   (uiPicked)="goToDay($event)"
 * />
 * ```
 */
@Component({
  selector: 'ui-month-picker',
  imports: [
    UiButton,
    UiCalendarGrid,
    UiChip,
    UiDateBadge,
    UiFontDirective,
    UiForegroundStyleDirective,
    UiIcon,
    UiInteractiveDirective,
    UiRadiusDirective,
    UiSpacer,
    UiStack,
    UiTextDirective,
    UiWeightDirective,
  ],
  templateUrl: './month-picker.html',
  styleUrl: './month-picker.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Unscoped: bare `.ui-*` selectors never match a component's own host under
  // emulated encapsulation, and the global `.ui-*` cascade is the contract.
  encapsulation: ViewEncapsulation.None,
  host: { class: 'ui-month-picker' },
})
export class UiMonthPicker {
  /** The chosen day, `YYYY-MM-DD`. Opening lands on its month. */
  readonly uiSelected = input.required<UiDayKey>();
  /** Today, so a selected today still says it is today. */
  readonly uiToday = input<UiDayKey | null>(null);
  /**
   * The locale the month name and weekday row are written in.
   *
   * Passed rather than injected: this lib has no opinion about where a
   * locale comes from, and a component that reaches for one cannot be
   * rendered from a spec with a literal.
   */
  readonly uiLocale = input<string>('en');
  readonly uiSize = input<UiCalendarGridSize>('regular');
  /**
   * Shortcuts above the grid — Reminders' `Today` / `Tomorrow`.
   *
   * Empty by default: most date changes on a browsing surface are a month
   * away, and a picker that offers "today" beside a `Днес` button in the bar
   * above it is saying the same thing twice.
   */
  readonly uiRelatives = input<readonly UiMonthPickerRelative[]>([]);
  /**
   * Days that have something ON them — the badge's event dot. A series'
   * own days, drawn on the calendar that picks where the series ends
   * (2026-09-24), so the end is chosen against the days it will cut.
   */
  readonly uiMarked = input<readonly UiDayKey[]>([]);
  /**
   * The earliest day that may be picked; the ones before it read as
   * unavailable and do not answer. An end cannot come before its start.
   */
  readonly uiMin = input<UiDayKey | null>(null);

  readonly uiPreviousLabel = input<string>('Previous month');
  readonly uiNextLabel = input<string>('Next month');

  readonly uiPicked = output<UiDayKey>();

  /**
   * The month on screen, `YYYY-MM`.
   *
   * ⚠ `linkedSignal`, and it carries `previous` forward. Re-deriving on every
   * recompute rather than on a genuine change of source is how a paged month
   * snaps back to the selection under the reader — the same trap the visit
   * editor's draft fell into.
   */
  protected readonly shownMonth = linkedSignal<string, string>({
    source: () => this.uiSelected().slice(0, 7),
    computation: (month, previous) =>
      previous !== undefined && previous.source === month
        ? previous.value
        : month,
  });

  /**
   * «Октомври 2026 г.» — a TITLE, so it starts with a capital. `Intl`
   * writes the month as it sits mid-sentence («октомври»), which is right
   * inside a sentence and wrong as a heading; CLDR's own context rule for
   * a stand-alone month is title case, and Apple's picker follows it.
   */
  protected readonly monthLabel = computed(() => {
    const [year, month] = this.shownMonth().split('-').map(Number);
    const locale = this.uiLocale();
    const label = new Intl.DateTimeFormat(locale, {
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    }).format(new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, 1)));
    return label.charAt(0).toLocaleUpperCase(locale) + label.slice(1);
  });

  /**
   * The seven column heads, Monday first.
   *
   * ONE algorithm — `Intl`'s own `short`, unmassaged. The two versions this
   * replaces disagreed here: one asked for `long` and cut it down with a
   * bespoke abbreviator, which is a second answer to a question the platform
   * has already answered per locale.
   */
  protected readonly weekdays = computed(() => {
    const locale = this.uiLocale();
    // 2026-08-03 is a Monday; walking seven from it labels the key in order.
    return Array.from({ length: 7 }, (_, index) =>
      new Intl.DateTimeFormat(locale, {
        weekday: 'short',
        timeZone: 'UTC',
      }).format(new Date(Date.UTC(2026, 7, 3 + index))),
    );
  });

  /** The month as weeks of cells, `null` padding either end. */
  protected readonly weeks = computed(() => {
    const shown = this.shownMonth();
    const [year, month] = shown.split('-').map(Number);
    const first = new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, 1));
    const days = new Date(Date.UTC(year ?? 1970, month ?? 1, 0)).getUTCDate();

    const cells: ({ day: number; dayKey: UiDayKey } | null)[] = [
      ...Array.from({ length: leadingBlanks(first.getUTCDay()) }, () => null),
      ...Array.from({ length: days }, (_, index) => ({
        day: index + 1,
        dayKey: `${shown}-${String(index + 1).padStart(2, '0')}`,
      })),
    ];
    while (cells.length % 7 !== 0) cells.push(null);

    const weeks: (typeof cells)[] = [];
    for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
    return weeks;
  });

  /** A set, read once per month drawn rather than scanned per cell. */
  protected readonly marked = computed(() => new Set(this.uiMarked()));

  /** Before the floor — keys sort as dates, so a string compare is the compare. */
  protected isBeforeMin(dayKey: UiDayKey): boolean {
    const min = this.uiMin();
    return min !== null && dayKey < min;
  }

  /** Resolved against today, so a relative shortcut cannot drift from it. */
  protected relativeDay(offset: number): UiDayKey {
    const today = this.uiToday();
    const from =
      today !== null && DAY_KEY.test(today)
        ? today
        : new Date().toISOString().slice(0, 10);
    return addDays(from, offset);
  }

  protected page(delta: number): void {
    const [year, month] = this.shownMonth().split('-').map(Number);
    const at = new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1 + delta, 1));
    this.shownMonth.set(at.toISOString().slice(0, 7));
  }

  protected pick(dayKey: UiDayKey): void {
    this.uiPicked.emit(dayKey);
  }
}
