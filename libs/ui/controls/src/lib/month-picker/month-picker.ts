import {
  ChangeDetectionStrategy,
  Component,
  ViewEncapsulation,
  computed,
  input,
  linkedSignal,
  output,
} from '@angular/core';
import { LocalDate } from '@core/primitives';
import { CalendarGridSystem } from '@core/systems';
import { UiSpacer, UiStack } from '@creativo/ui/layout';
import { formatWallClock, formatWeekdayLabels } from '@creativo/ui/wall-clock';
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
import { UiIcon } from '@creativo/ui/icons';

/**
 * A shop day — the `LocalDate` brand itself (`YYYY-MM-DD`), the one shape
 * every date on this surface travels as. The picker hands back only days it
 * built (a cell's own `LocalDate`, or a relative day walked from `uiToday`),
 * so a consumer never re-parses what it is handed.
 */
export type UiDayKey = LocalDate;

/** One relative shortcut offered above the grid. */
export interface UiMonthPickerRelative {
  /** `0` is today, `1` tomorrow. Resolved against `uiToday`. */
  readonly offset: number;
  readonly label: string;
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
  /**
   * The chosen day. Opening lands on its month. `null` while there is no
   * day to choose from yet — the grid then draws no month (the head reads
   * empty and the steps page nothing) until one arrives.
   */
  readonly uiSelected = input.required<UiDayKey | null>();
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
   * The month on screen, as its 1st — `null` while there is no selection.
   *
   * ⚠ `linkedSignal`, and it carries `previous` forward. Re-deriving on every
   * recompute rather than on a genuine change of source is how a paged month
   * snaps back to the selection under the reader — the same trap the visit
   * editor's draft fell into.
   */
  protected readonly shownMonth = linkedSignal<
    LocalDate | null,
    LocalDate | null
  >({
    source: () => {
      const selected = this.uiSelected();
      return selected === null ? null : LocalDate.startOfMonth(selected);
    },
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
    const first = this.shownMonth();
    if (first === null) return '';
    const locale = this.uiLocale();
    // The shared wall-clock face of `@creativo/ui/wall-clock` (cached per
    // locale, read on the civil axis) — never a formatter of this picker's.
    const label = formatWallClock(first, null, locale, {
      month: 'long',
      year: 'numeric',
    });
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
  protected readonly weekdays = computed(() =>
    // The shared Monday-first `short` row of `@creativo/ui/wall-clock`,
    // cached per locale — never a formatter of this picker's own.
    formatWeekdayLabels(this.uiLocale()),
  );

  /** The month as weeks of cells, `null` padding either end. */
  protected readonly weeks = computed(() => {
    // Monday-first, padded to whole weeks (`CalendarGridSystem.monthGrid`);
    // a weekday is civil arithmetic on the `LocalDate`, so no zone is read.
    const first = this.shownMonth();
    if (first === null) return [];
    return CalendarGridSystem.monthGrid(first, []).map((week) =>
      week.map((cell): { day: number; dayKey: UiDayKey } | null =>
        cell.inMonth ? { day: cell.dayOfMonth, dayKey: cell.localDate } : null,
      ),
    );
  });

  /** A set, read once per month drawn rather than scanned per cell. */
  protected readonly marked = computed(() => new Set(this.uiMarked()));

  /** Before the floor — on the calendar's own day order. */
  protected isBeforeMin(dayKey: UiDayKey): boolean {
    const min = this.uiMin();
    return min !== null && LocalDate.compare(dayKey, min) < 0;
  }

  /**
   * Resolved against `uiToday`, so a relative shortcut cannot drift from
   * the shop's own today. Without a `uiToday` there is nothing to
   * resolve against and the shortcut is inert (`null`) — this lib never
   * reads a device clock (Law 7; ui-residue-cleanup DEP-3).
   */
  protected relativeDay(offset: number): UiDayKey | null {
    const today = this.uiToday();
    return today === null ? null : LocalDate.addDays(today, offset);
  }

  /** A 1st plus whole months is a 1st (`addMonths` clamps the day to 1). */
  protected page(delta: number): void {
    const first = this.shownMonth();
    if (first === null) return;
    this.shownMonth.set(LocalDate.addMonths(first, delta));
  }

  /** An inert shortcut (`null`) picks nothing. */
  protected pick(dayKey: UiDayKey | null): void {
    if (dayKey === null) return;
    this.uiPicked.emit(dayKey);
  }
}
