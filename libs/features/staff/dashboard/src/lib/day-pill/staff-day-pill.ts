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
  const [year = 1970, month = 1, day = 1] = dayKey.split('-').map(Number);
  return new Intl.DateTimeFormat(locale, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(year, month - 1, day)));
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
        uiControlSize="regular"
        uiMenuTrigger
        class="staff-day-pill__trigger"
        [attr.data-testid]="uiTestId()"
        (click)="uiPresented.set(true)"
      >
        {{ label() }}
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
  host: { class: 'staff-day-pill' },
})
export class StaffDayPill {
  readonly uiDayKey = input.required<string>();
  readonly uiTodayKey = input<string | null>(null);
  readonly uiLocale = input('bg');
  /** The visit's own days, marked on the month. */
  readonly uiRelatives = input<readonly UiMonthPickerRelative[]>([]);
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
