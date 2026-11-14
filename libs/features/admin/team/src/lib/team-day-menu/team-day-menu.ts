import {
  ChangeDetectionStrategy,
  Component,
  type ElementRef,
  ViewEncapsulation,
  input,
  model,
  output,
  viewChild,
} from '@angular/core';
import type { LocalDate } from '@core/primitives';
import { UiMonthPicker } from '@creativo/ui/controls';
import { UiIcon } from '@creativo/ui/icons';
import {
  UiInteractiveDirective,
  UiRadiusDirective,
} from '@creativo/ui/modifiers';
import { UiMenu, UiMenuTrigger } from '@creativo/ui/patterns';

/**
 * A DAY AS A ROW'S VALUE: the quiet run a value row of these pages ends on
 * («1 дек. ⌃⌄»), which opens the DS's month. Nothing here is drawn by
 * hand: the trigger wears the pages' value grammar (`team-page__choice`),
 * the surface is `ui-menu` as a dialog — a month has no menu items, so it
 * is named after the row and leaves the arrow keys to the grid — and the
 * month is `ui-month-picker`. Picking a day closes it and returns the
 * keyboard to the row.
 */
@Component({
  selector: 'lib-team-day-menu',
  imports: [
    UiIcon,
    UiInteractiveDirective,
    UiMenu,
    UiMenuTrigger,
    UiMonthPicker,
    UiRadiusDirective,
  ],
  template: `
    <ui-menu
      uiRole="dialog"
      uiAlignment="trailing"
      [uiPresented]="uiPresented()"
      [uiLabel]="uiLabel()"
      (uiDismissed)="uiPresented.set(false)"
    >
      <button
        #trigger
        type="button"
        uiInteractive
        uiRadius="capsule"
        uiMenuTrigger
        class="team-page__choice"
        [disabled]="uiDisabled()"
        [attr.aria-label]="uiLabel() + ': ' + uiValue()"
        [attr.data-testid]="uiTestId()"
        (click)="uiPresented.set(true)"
      >
        <span>{{ uiValue() }}</span>
        <ui-icon uiName="field.popUp" aria-hidden="true" />
      </button>
      @if (uiPresented()) {
        <ui-month-picker
          class="team-page__calendar"
          [attr.data-testid]="uiTestId() + '-calendar'"
          [uiSelected]="uiDay()"
          [uiOpensOn]="uiMin() ?? uiToday()"
          [uiToday]="uiToday()"
          [uiLocale]="uiLocale()"
          [uiMin]="uiMin()"
          [uiPreviousLabel]="uiPreviousLabel()"
          [uiNextLabel]="uiNextLabel()"
          (uiPicked)="pick($event)"
        />
      }
    </ui-menu>
  `,
  styleUrl: '../team-pages.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Every selector in the stylesheet is `team-page`-prefixed.
  encapsulation: ViewEncapsulation.None,
  host: { class: 'team-page__day' },
})
export class TeamDayMenu {
  /** The day the row holds; `null` for a row with none yet. */
  readonly uiDay = input.required<LocalDate | null>();
  /** The day in words, or the word for none — what the trigger prints. */
  readonly uiValue = input.required<string>();
  /** The row's label: the trigger and the month are named after it. */
  readonly uiLabel = input.required<string>();
  readonly uiToday = input<LocalDate | null>(null);
  /**
   * The earliest day the month offers. A row with no day yet opens on its
   * month — a last day is picked from the start day on — else on today's.
   */
  readonly uiMin = input<LocalDate | null>(null);
  readonly uiLocale = input('bg');
  readonly uiPreviousLabel = input('');
  readonly uiNextLabel = input('');
  readonly uiDisabled = input(false);
  readonly uiTestId = input('team-day');
  readonly uiPresented = model(false);
  /** The day picked in the month. */
  readonly uiPicked = output<LocalDate>();

  private readonly trigger =
    viewChild.required<ElementRef<HTMLButtonElement>>('trigger');

  /**
   * Puts the keyboard on the row's value. The menu hands focus back when
   * IT is dismissed; a month closed by a pick is closed from here, and the
   * day that held focus is gone with it — left alone, focus would fall to
   * the page and the sheet around the row would stop hearing Escape.
   */
  focus(): void {
    this.trigger().nativeElement.focus({ preventScroll: true });
  }

  protected pick(day: LocalDate): void {
    this.uiPresented.set(false);
    this.uiPicked.emit(day);
    this.focus();
  }
}
