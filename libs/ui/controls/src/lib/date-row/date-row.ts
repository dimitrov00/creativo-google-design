import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  ViewEncapsulation,
  afterNextRender,
  inject,
  input,
  model,
  output,
  viewChild,
} from '@angular/core';
import type { LocalDate } from '@core/primitives';
import { UiIcon } from '@creativo/ui/icons';
import {
  UiFontDirective,
  UiForegroundStyleDirective,
  UiInteractiveDirective,
  UiTextDirective,
} from '@creativo/ui/modifiers';
import { UiListRow } from '@creativo/ui/patterns';
import { UiMonthPicker } from '../month-picker/month-picker';

let nextCalendarId = 0;

/**
 * A DATE AS A ROW OF A FORM — the row says what the date is and which day
 * it holds, and the month unfolds UNDER it, in the flow of the sheet
 * (`DatePicker` in a `Form`: the value row, then the graphical picker).
 *
 * ### Why this exists
 * A period — a first and a last day — was asked for in two ways: the
 * analytics period sheet unfolded the month under the row, and the team's
 * working period hid it behind a pull-down. The same question, two
 * answers: a person who learned one met the other and had to read it
 * again. This is the one answer, for every date a form asks for.
 *
 * ### What it owns
 * The row (label, the day in words or the placeholder, the chevron that
 * turns), the month under it (`ui-month-picker` — the chosen day's disc,
 * today, the floor, the event dots) and the wiring between them
 * (`aria-expanded`, `aria-controls`). It owns NO words: the consumer
 * formats the day, so the row says it the way the screen around it does.
 *
 * ### What it leaves to the consumer
 * Whether a pick folds the month. A range folds the first row and unfolds
 * the second; a single date may stay open so the day is seen against the
 * days around it. `uiExpanded` is a model for exactly that. When a pick
 * does fold it, the day that held the keyboard is gone with the month, so
 * the row takes the keyboard back: the sheet around it keeps hearing
 * Escape.
 *
 * The host is the list group's ONE transparent wrapper (`ui-list-group`
 * lays the row out as a segment and the month under it), so it goes
 * straight into a group — with `role="listitem"` inside a `ul`.
 *
 * ```html
 * <ui-date-row
 *   uiLabel="Последен работен ден"
 *   [uiSelected]="last()"
 *   [uiValue]="lastWords()"
 *   uiPlaceholder="Няма"
 *   [uiMarked]="bookedDays()"
 *   [(uiExpanded)]="lastOpen"
 *   (uiPicked)="last.set($event)"
 * />
 * ```
 */
@Component({
  selector: 'ui-date-row',
  imports: [
    UiFontDirective,
    UiForegroundStyleDirective,
    UiIcon,
    UiInteractiveDirective,
    UiListRow,
    UiMonthPicker,
    UiTextDirective,
  ],
  template: `
    <button
      #row
      type="button"
      uiListRow
      uiSize="regular"
      [uiInteractive]="true"
      [disabled]="uiDisabled()"
      [attr.aria-expanded]="uiExpanded()"
      [attr.aria-controls]="calendarId"
      [attr.data-testid]="uiTestId()"
      (click)="uiExpanded.set(!uiExpanded())"
    >
      {{ uiLabel() }}
      <span uiTrailing class="ui-date-row__value">
        <span
          uiText
          uiFont="body"
          [uiForegroundStyle]="uiValue() === null ? 'secondary' : 'primary'"
          [attr.data-testid]="uiTestId() + '-value'"
          >{{ uiValue() ?? uiPlaceholder() }}</span
        >
        <ui-icon
          class="ui-date-row__chevron"
          [attr.data-open]="uiExpanded() ? '' : null"
          uiName="field.expand"
          aria-hidden="true"
        />
      </span>
    </button>
    @if (uiExpanded()) {
      <div
        class="ui-date-row__calendar"
        [id]="calendarId"
        [attr.data-testid]="uiTestId() + '-calendar'"
      >
        <ui-month-picker
          [uiSelected]="uiSelected()"
          [uiOpensOn]="uiOpensOn() ?? uiMin() ?? uiToday()"
          [uiToday]="uiToday()"
          [uiMin]="uiMin()"
          [uiMarked]="uiMarked()"
          [uiLocale]="uiLocale()"
          [uiPreviousLabel]="uiPreviousLabel()"
          [uiNextLabel]="uiNextLabel()"
          (uiPicked)="pick($event)"
        />
      </div>
    }
  `,
  styleUrl: './date-row.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Unscoped like every control: `.ui-date-row__*` is the styling contract.
  encapsulation: ViewEncapsulation.None,
  host: { class: 'ui-date-row' },
})
export class UiDateRow {
  /** What the date is: the row's label, and the month's name. */
  readonly uiLabel = input.required<string>();
  /** The day the row holds; `null` for a date not chosen yet. */
  readonly uiSelected = input.required<LocalDate | null>();
  /** That day in the consumer's words; `null` prints the placeholder. */
  readonly uiValue = input.required<string | null>();
  /** What the row says while it holds no day («Избери», «Няма»). */
  readonly uiPlaceholder = input('');
  /** The month is unfolded under the row. */
  readonly uiExpanded = model(false);
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
  /** The row's test id; its value and its month take `-value` / `-calendar`. */
  readonly uiTestId = input('ui-date-row');
  /** The day picked in the month. */
  readonly uiPicked = output<LocalDate>();

  /** What `aria-controls` names: the month under this row. */
  protected readonly calendarId = `ui-date-row-calendar-${nextCalendarId++}`;

  /** The row's own element: `uiListRow` is a component, so the element is asked for by name. */
  private readonly row = viewChild.required<
    string,
    ElementRef<HTMLButtonElement>
  >('row', { read: ElementRef });

  private readonly injector = inject(Injector);

  /**
   * The day picked goes up; if the consumer folded the month for it, the
   * keyboard returns to the row once the month is gone.
   */
  protected pick(day: LocalDate): void {
    this.uiPicked.emit(day);
    afterNextRender(
      () => {
        if (!this.uiExpanded()) this.focus();
      },
      { injector: this.injector },
    );
  }

  /**
   * Puts the keyboard on the row. A consumer calls it when the control
   * that held focus leaves the page (a «no date» row that removes itself),
   * so the sheet around the row keeps hearing Escape.
   */
  focus(): void {
    this.row().nativeElement.focus({ preventScroll: true });
  }
}
