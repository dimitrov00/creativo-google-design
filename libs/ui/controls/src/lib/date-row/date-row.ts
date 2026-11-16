import {
  ChangeDetectionStrategy,
  Component,
  ViewEncapsulation,
  input,
  model,
  output,
  viewChild,
} from '@angular/core';
import type { LocalDate } from '@core/primitives';
import { UiListRow } from '@creativo/ui/patterns';
import { UiDatePill } from '../date-pill/date-pill';

/**
 * A DATE AS A ROW OF A FORM — Apple's compact `DatePicker` in a `Form`:
 * the row says what the date is, and its value is a capsule at the
 * trailing edge (`ui-date-pill`) that pops the month over the page. The
 * capsule says the value can be changed; the month leaves the form where
 * it is.
 *
 * One answer for every date a form asks for (owner, 2026-11-16: "like
 * Apple does … just input toggle that pops up the calendar as we already
 * have in the appointment details, inside a chip so it's known that it
 * could be changed"): the working period's two days, a new barber's
 * start, a return's start, the analytics' custom period. The visit sheet,
 * a block and the hours wear the same capsule in their own rows.
 *
 * The capsule names the day the one way the app does (`formatDayPill`,
 * «пн, 16.11»), or the placeholder while there is none. The row owns no
 * other words.
 *
 * The host is the list group's ONE transparent wrapper (`ui-list-group`
 * lays the row out as a segment), so it goes straight into a group — with
 * `role="listitem"` inside a `ul`.
 *
 * ```html
 * <ui-date-row
 *   uiLabel="Последен работен ден"
 *   uiPlaceholder="Няма"
 *   [uiSelected]="last()"
 *   [uiMarked]="bookedDays()"
 *   (uiPicked)="last.set($event)"
 * />
 * ```
 */
@Component({
  selector: 'ui-date-row',
  imports: [UiDatePill, UiListRow],
  template: `
    <ui-list-row uiSize="regular">
      <span>{{ uiLabel() }}</span>
      <ui-date-pill
        uiTrailing
        uiAlignment="trailing"
        uiControlSize="small"
        [uiSelected]="uiSelected()"
        [uiPlaceholder]="uiPlaceholder()"
        [uiOpensOn]="uiOpensOn() ?? uiMin() ?? uiToday()"
        [uiToday]="uiToday()"
        [uiMin]="uiMin()"
        [uiMarked]="uiMarked()"
        [uiLocale]="uiLocale()"
        [uiPreviousLabel]="uiPreviousLabel()"
        [uiNextLabel]="uiNextLabel()"
        [uiDisabled]="uiDisabled()"
        [uiAccessibleLabel]="uiLabel()"
        [uiTestId]="uiTestId()"
        [(uiPresented)]="uiPresented"
        (uiPicked)="uiPicked.emit($event)"
      />
    </ui-list-row>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Unscoped like every control.
  encapsulation: ViewEncapsulation.None,
  host: { class: 'ui-date-row' },
})
export class UiDateRow {
  /** What the date is: the row's label, and the month's name. */
  readonly uiLabel = input.required<string>();
  /** The day the row holds; `null` for a date not chosen yet. */
  readonly uiSelected = input.required<LocalDate | null>();
  /** What the capsule says while the row holds no day («Избери», «Няма»). */
  readonly uiPlaceholder = input('');
  /** The month is open over the page. */
  readonly uiPresented = model(false);
  readonly uiToday = input<LocalDate | null>(null);
  /** The earliest day that answers: an end never comes before its start. */
  readonly uiMin = input<LocalDate | null>(null);
  /**
   * The month drawn while no day is chosen. Left out, an empty row opens
   * on its floor's month, else on today's.
   */
  readonly uiOpensOn = input<LocalDate | null>(null);
  /** Days that hold something — the event dot, as every month draws it. */
  readonly uiMarked = input<readonly LocalDate[]>([]);
  readonly uiLocale = input('en');
  readonly uiPreviousLabel = input('Previous month');
  readonly uiNextLabel = input('Next month');
  readonly uiDisabled = input(false);
  /** The capsule's test id; its words take `-value`, its month `-calendar`. */
  readonly uiTestId = input('ui-date-row');
  /** The day picked in the month. */
  readonly uiPicked = output<LocalDate>();

  private readonly pill = viewChild.required(UiDatePill);

  /**
   * Puts the keyboard on the row's capsule. A consumer calls it when the
   * control that held focus leaves the page (a «no date» row that removes
   * itself), so the sheet around the row keeps hearing Escape.
   */
  focus(): void {
    this.pill().focus();
  }
}
