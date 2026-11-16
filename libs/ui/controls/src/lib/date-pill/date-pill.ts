import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  ViewEncapsulation,
  afterNextRender,
  computed,
  inject,
  input,
  model,
  output,
  viewChild,
} from '@angular/core';
import type { LocalDate } from '@core/primitives';
import { UiIcon } from '@creativo/ui/icons';
import { UiMenu, UiMenuTrigger } from '@creativo/ui/patterns';
import { formatDayPill } from '@creativo/ui/wall-clock';
import { UiButton } from '../button/button';
import {
  UiMonthPicker,
  type UiMonthPickerRelative,
} from '../month-picker/month-picker';

/**
 * THE DATE PILL — a tinted capsule that names a day and pops the month
 * over the page: Apple's compact `DatePicker`. The capsule says the value
 * can be changed; the month is `ui-month-picker`, the DS's.
 *
 * One control for every day a person picks (owner, 2026-09-09, then
 * 2026-11-16): the schedule's toolbar, the visit sheet's frame, a block's
 * day and its series' end, the hours' first day, and every date row of a
 * form (`ui-date-row` puts one at a row's trailing edge). Same label, same
 * chevron, same popover, same month. It began as the schedule's own pill
 * and was lifted here when the team's forms asked for the same thing.
 *
 * `uiPresented` is a model: the owner may close it when another popover
 * opens (the page's one-at-a-time rule) and hears when the pill opens
 * itself. Picking a day closes it and gives the keyboard back to the
 * capsule — the day that held it is gone with the month, and left alone
 * focus would fall to the page and a sheet around the pill would stop
 * hearing Escape.
 *
 * The popover is a DIALOG, not a menu (2026-10-06): a month has no
 * menuitems, and announced as `role="menu"` it was an empty menu to a
 * reader. `uiRole="dialog"` names the surface, moves focus onto it as a
 * container, leaves the arrow keys to the month, and still closes on
 * Escape with focus handed back to the capsule.
 */
@Component({
  selector: 'ui-date-pill',
  imports: [UiButton, UiIcon, UiMenu, UiMenuTrigger, UiMonthPicker],
  template: `
    <ui-menu
      uiRole="dialog"
      [uiAlignment]="uiAlignment()"
      [uiPresented]="uiPresented()"
      [uiLabel]="uiAccessibleLabel() ?? label()"
      (uiDismissed)="uiPresented.set(false)"
    >
      <button
        #trigger
        type="button"
        uiButton
        uiButtonStyle="bordered"
        uiTint="neutral"
        [uiControlSize]="uiControlSize()"
        uiMenuTrigger
        class="ui-date-pill__trigger"
        [disabled]="uiDisabled()"
        [attr.aria-label]="accessibleName()"
        [attr.data-testid]="uiTestId()"
        [attr.data-empty]="uiSelected() === null ? '' : null"
        (click)="uiPresented.set(true)"
      >
        <span
          class="ui-date-pill__label"
          [attr.data-testid]="uiTestId() + '-value'"
          >{{ label() }}</span
        >
        <ui-icon uiName="field.expand" aria-hidden="true" />
      </button>
      @if (uiPresented()) {
        <ui-month-picker
          class="ui-date-pill__calendar"
          [attr.data-testid]="uiCalendarTestId() ?? uiTestId() + '-calendar'"
          [uiSelected]="uiSelected()"
          [uiOpensOn]="uiOpensOn()"
          [uiToday]="uiToday()"
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
  styleUrl: './date-pill.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Unscoped like every control: `.ui-date-pill__*` is the styling contract.
  encapsulation: ViewEncapsulation.None,
  host: {
    class: 'ui-date-pill',
    '[attr.data-size]': 'uiControlSize()',
  },
})
export class UiDatePill {
  /** The day the pill names; `null` prints the placeholder. */
  readonly uiSelected = input.required<LocalDate | null>();
  /** What the pill says while it holds no day («Няма», «Избери»). */
  readonly uiPlaceholder = input('');
  readonly uiToday = input<LocalDate | null>(null);
  /** The month drawn while no day is chosen. */
  readonly uiOpensOn = input<LocalDate | null>(null);
  readonly uiLocale = input('en');
  /** Shortcuts above the month («Днес», «Утре»). */
  readonly uiRelatives = input<readonly UiMonthPickerRelative[]>([]);
  /** Days with something on them — the month's event dots. */
  readonly uiMarked = input<readonly LocalDate[]>([]);
  /** The earliest day the month offers. */
  readonly uiMin = input<LocalDate | null>(null);
  /**
   * `regular` in a frame's head, beside the 44px step arrows; `small` as a
   * FORM ROW's value, the 36px tier every other pill in a row wears.
   */
  readonly uiControlSize = input<'small' | 'regular'>('regular');
  /** Which edge of the capsule the month opens from. */
  readonly uiAlignment = input<'leading' | 'trailing'>('leading');
  /** A label that is not the day's own — the toolbar's week range. */
  readonly uiLabel = input<string | null>(null);
  /**
   * What the value IS, when a row says it beside the pill («Последен
   * работен ден»): the capsule reads «label: day», and the month is named
   * after it.
   */
  readonly uiAccessibleLabel = input<string | null>(null);
  readonly uiDisabled = input(false);
  readonly uiPreviousLabel = input('Previous month');
  readonly uiNextLabel = input('Next month');
  /** The capsule's test id; its words take `-value`, its month `-calendar`. */
  readonly uiTestId = input('ui-date-pill');
  /** The month's own test id, where a host named it otherwise. */
  readonly uiCalendarTestId = input<string | null>(null);
  readonly uiPresented = model(false);
  /** The day picked in the month — always a real calendar day. */
  readonly uiPicked = output<LocalDate>();

  private readonly injector = inject(Injector);
  private readonly trigger = viewChild.required<
    string,
    ElementRef<HTMLButtonElement>
  >('trigger', { read: ElementRef });

  protected readonly label = computed(() => {
    const day = this.uiSelected();
    return (
      this.uiLabel() ??
      (day === null
        ? this.uiPlaceholder()
        : formatDayPill(day, this.uiLocale()))
    );
  });

  protected readonly accessibleName = computed(() => {
    const name = this.uiAccessibleLabel();
    return name === null ? null : `${name}: ${this.label()}`;
  });

  /** Puts the keyboard on the capsule. */
  focus(): void {
    this.trigger().nativeElement.focus({ preventScroll: true });
  }

  /**
   * A day picked in the month: it goes up as it is, the month closes, and
   * the keyboard returns to the capsule once the month is gone.
   */
  protected pick(day: LocalDate): void {
    this.uiPresented.set(false);
    this.uiPicked.emit(day);
    afterNextRender(() => this.focus(), { injector: this.injector });
  }
}
