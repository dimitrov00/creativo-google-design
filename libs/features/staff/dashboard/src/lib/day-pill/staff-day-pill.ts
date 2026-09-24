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

/**
 * `ср, 9.09` — the one grammar for a day named in a pill, COMPACT, exactly
 * as `Intl` renders the locale's short date (owner, 2026-09-09: "keep it how
 * Intl produces it", then "the compact version"). The weekday leads because
 * in a barbershop a Saturday is not a Tuesday. `month: 'short'` is numeric
 * in Bulgarian by CLDR (`9.09`) and a word in English (`Sep 9`); neither is
 * touched afterwards — no capitaliser, no padding.
 */
export function formatDayPill(dayKey: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(noonOf(dayKey));
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
  firstKey: string,
  lastKey: string,
  locale: string,
): string {
  const first = noonOf(firstKey);
  const last = noonOf(lastKey);
  const sameYear = firstKey.slice(0, 4) === lastKey.slice(0, 4);
  const sameMonth = sameYear && firstKey.slice(5, 7) === lastKey.slice(5, 7);
  const dayMonth = new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
  if (!sameMonth) {
    const across = sameYear
      ? dayMonth
      : new Intl.DateTimeFormat(locale, {
          day: 'numeric',
          month: 'short',
          year: 'numeric',
          timeZone: 'UTC',
        });
    return across.formatRange(first, last);
  }
  const parts = dayMonth.formatToParts(last);
  const dayLeads =
    parts.findIndex((part) => part.type === 'day') <
    parts.findIndex((part) => part.type === 'month');
  const dayOnly = new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    timeZone: 'UTC',
  });
  return dayLeads
    ? `${dayOnly.format(first)} – ${dayMonth.format(last)}`
    : `${dayMonth.format(first)} – ${dayOnly.format(last)}`;
}

/** Noon UTC on a `YYYY-MM-DD` key — a civil day, immune to any zone's midnight. */
function noonOf(dayKey: string): Date {
  const [year = 1970, month = 1, day = 1] = dayKey.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day, 12));
}

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
 */
@Component({
  selector: 'lib-staff-day-pill',
  imports: [UiButton, UiIcon, UiMenu, UiMenuTrigger, UiMonthPicker],
  template: `
    <ui-menu
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
  readonly uiDayKey = input.required<string>();
  readonly uiTodayKey = input<string | null>(null);
  readonly uiLocale = input('bg');
  /** The visit's own days, marked on the month. */
  readonly uiRelatives = input<readonly UiMonthPickerRelative[]>([]);
  /** Days with something on them — a series' own, on its end's calendar. */
  readonly uiMarked = input<readonly string[]>([]);
  /** The earliest day the month offers. */
  readonly uiMin = input<string | null>(null);
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
  readonly uiPicked = output<string>();

  protected readonly label = computed(
    () => this.uiLabel() ?? formatDayPill(this.uiDayKey(), this.uiLocale()),
  );

  protected pick(dayKey: string): void {
    this.uiPresented.set(false);
    this.uiPicked.emit(dayKey);
  }
}
