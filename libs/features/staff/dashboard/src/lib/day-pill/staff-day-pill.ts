import {
  ChangeDetectionStrategy,
  Component,
  ViewEncapsulation,
  computed,
  input,
  model,
  output,
} from '@angular/core';
import {
  UiButton,
  UiIcon,
  UiMonthPicker,
  UiMonthPickerRelative,
} from '@creativo/ui/controls';
import { UiMenu, UiMenuTrigger } from '@creativo/ui/patterns';
import {
  formatWallClock,
  formatWallClockRange,
  wallClockParts,
} from '@creativo/ui/wall-clock';
import { LocalDate } from '@core/primitives';

/**
 * `ср, 9.09` — the one grammar for a day named in a pill, COMPACT, exactly
 * as `Intl` renders the locale's short date (owner, 2026-09-09: "keep it how
 * Intl produces it", then "the compact version"). The weekday leads because
 * in a barbershop a Saturday is not a Tuesday. `month: 'short'` is numeric
 * in Bulgarian by CLDR (`9.09`) and a word in English (`Sep 9`); neither is
 * touched afterwards — no capitaliser, no padding.
 */
export function formatDayPill(day: LocalDate, locale: string): string {
  return formatWallClock(day, null, locale, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}

/**
 * «21 – 27.09» — a PERIOD in the pill's own numeric grammar (2026-09-23,
 * the grid views' design record §9).
 *
 * The 3-day and week labels were written in the long month («23 – 25
 * Септември») for a headline segment that no longer exists; in the pill
 * that string pushed the search and the chair picker off a 390px bar. The
 * single-day form is numeric by the 2026-09-04 ruling (the two pickers may
 * differ in density, never in facts), so the range takes the same pieces.
 *
 * Inside one month the shared month is said ONCE, on whichever side the
 * locale puts it: Bulgarian writes the day first («21 – 27.09»), English
 * the month («Sep 21 – 27») — read off `formatToParts` rather than
 * assumed. Across a month or a year `Intl`'s own `formatRange` writes the
 * pair («30.09 – 2.10», «28.12.2026 г. – 3.01.2027 г.»); nothing here
 * invents a separator the locale would not.
 */
export function formatDayPillRange(
  first: LocalDate,
  last: LocalDate,
  locale: string,
): string {
  const from = LocalDate.parts(first);
  const to = LocalDate.parts(last);
  const sameYear = from.year === to.year;
  const sameMonth = sameYear && from.month === to.month;
  const dayMonth: Intl.DateTimeFormatOptions = {
    day: 'numeric',
    month: 'short',
  };
  if (!sameMonth) {
    return formatWallClockRange(
      first,
      last,
      locale,
      sameYear ? dayMonth : { ...dayMonth, year: 'numeric' },
    );
  }
  const parts = wallClockParts(last, null, locale, dayMonth);
  const dayLeads =
    parts.findIndex((part) => part.type === 'day') <
    parts.findIndex((part) => part.type === 'month');
  const dayOnly: Intl.DateTimeFormatOptions = { day: 'numeric' };
  return dayLeads
    ? `${formatWallClock(first, null, locale, dayOnly)} – ${formatWallClock(last, null, locale, dayMonth)}`
    : `${formatWallClock(first, null, locale, dayMonth)} – ${formatWallClock(last, null, locale, dayOnly)}`;
}

/**
 * The face a pill with NO day has always printed: before the shop's zone
 * is known the store's day key was `''`, which the old key reader rolled
 * to `0000-01-01`. Kept so a day-less pill prints what it printed; never
 * seen in practice — the page draws its pill only once the zone (and so a
 * day) is known (`StaffDayStore.ready`), and every sheet has its own day.
 */
const NO_DAY = LocalDate.fromEpochDay(LocalDate.epochDayOf(0, 1, 1));

/**
 * THE DAY PILL — a tinted capsule that names a day and opens the month.
 *
 * One component for the page toolbar and the visit sheet's frame (owner,
 * 2026-09-09): the two had drifted into different triggers (`ср, 9
 * Септември` in a headline segment against `ср, 9.09` in a pill), and two
 * calendars of different sizes. Same label, same chevron, same popover,
 * same month — and the month is `ui-month-picker`, which is the DS's.
 *
 * `uiPresented` is a model: the owner may close it when another popover
 * opens (the page's one-at-a-time rule) and hears when the pill opens
 * itself. Picking a day closes it.
 *
 * The popover is a DIALOG, not a menu (2026-10-06): a month has no
 * menuitems, and announced as `role="menu"` it was an empty menu to a
 * reader (axe `aria-required-children`, critical, on every run). The DS's
 * `uiRole="dialog"` names the surface after the pill's own label, moves
 * focus onto it as a container, leaves the arrow keys to the month, and
 * still closes on Escape with focus handed back to the pill.
 */
@Component({
  selector: 'lib-staff-day-pill',
  imports: [UiButton, UiIcon, UiMenu, UiMenuTrigger, UiMonthPicker],
  template: `
    <ui-menu
      uiRole="dialog"
      [uiAlignment]="uiAlignment()"
      [uiPresented]="uiPresented()"
      [uiLabel]="label()"
      (uiDismissed)="uiPresented.set(false)"
    >
      <button
        type="button"
        uiButton
        uiButtonStyle="bordered"
        uiTint="neutral"
        [uiControlSize]="uiControlSize()"
        uiMenuTrigger
        class="staff-day-pill__trigger"
        [attr.data-testid]="uiTestId()"
        (click)="uiPresented.set(true)"
      >
        <span class="staff-day-pill__label">{{ label() }}</span>
        <ui-icon uiName="field.expand" aria-hidden="true" />
      </button>
      @if (uiPresented()) {
        <ui-month-picker
          class="staff-day-pill__calendar"
          [attr.data-testid]="uiCalendarTestId() ?? uiTestId() + '-calendar'"
          [uiSelected]="uiDayKey()"
          [uiToday]="uiTodayKey()"
          [uiLocale]="uiLocale()"
          [uiRelatives]="uiRelatives()"
          [uiMarked]="uiMarked()"
          [uiMin]="uiMin()"
          [uiPreviousLabel]="uiPreviousLabel()"
          [uiNextLabel]="uiNextLabel()"
          (uiPicked)="pick($event)"
        />
      }
    </ui-menu>
  `,
  styleUrl: './staff-day-pill.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Unscoped, like the editor it was extracted from: the pill recipe is a
  // bare `.staff-sheet__pill` class shared across stylesheets.
  encapsulation: ViewEncapsulation.None,
  host: {
    class: 'staff-day-pill',
    '[attr.data-size]': 'uiControlSize()',
  },
})
export class StaffDayPill {
  /** The day the pill names — `null` only while the owner has no day yet. */
  readonly uiDayKey = input.required<LocalDate | null>();
  readonly uiTodayKey = input<LocalDate | null>(null);
  readonly uiLocale = input('bg');
  /** The visit's own days, marked on the month. */
  readonly uiRelatives = input<readonly UiMonthPickerRelative[]>([]);
  /** Days with something on them — a series' own, on its end's calendar. */
  readonly uiMarked = input<readonly LocalDate[]>([]);
  /** The earliest day the month offers. */
  readonly uiMin = input<LocalDate | null>(null);
  /**
   * `regular` in a frame's head, beside the 44px step arrows; `small` as a
   * FORM ROW's value, the 36px tier every other pill in a row wears.
   */
  readonly uiControlSize = input<'small' | 'regular'>('regular');
  readonly uiAlignment = input<'leading' | 'trailing'>('leading');
  /** A label that is not the day's own — the toolbar's week range. */
  readonly uiLabel = input<string | null>(null);
  readonly uiPreviousLabel = input('');
  readonly uiNextLabel = input('');
  readonly uiTestId = input('staff-day-pill');
  readonly uiCalendarTestId = input<string | null>(null);
  readonly uiPresented = model(false);
  /** The day picked in the month — always a real calendar day. */
  readonly uiPicked = output<LocalDate>();

  protected readonly label = computed(
    () =>
      this.uiLabel() ??
      formatDayPill(this.uiDayKey() ?? NO_DAY, this.uiLocale()),
  );

  /**
   * A day picked in the month. The month emits a cell's own `LocalDate` (or
   * a relative day walked from one), so the pill hands it on as it is.
   */
  protected pick(day: LocalDate): void {
    this.uiPresented.set(false);
    this.uiPicked.emit(day);
  }
}
