import {
  ChangeDetectionStrategy,
  Component,
  ViewEncapsulation,
  computed,
  input,
  output,
} from '@angular/core';
import { UiInteractiveDirective } from '@creativo/ui/modifiers';

/** An ISO weekday: 1 = Monday … 7 = Sunday. */
export type UiIsoWeekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;

const ISO_WEEK: readonly UiIsoWeekday[] = [1, 2, 3, 4, 5, 6, 7];

interface WeekdayCell {
  readonly iso: UiIsoWeekday;
  /** What the circle says — `Intl`'s own `short` («пн», «Mon»). */
  readonly short: string;
  /** What a screen reader says — the whole name («понеделник»). */
  readonly name: string;
  readonly on: boolean;
  /** On, and the last one allowed to be: turning it off would go below the minimum. */
  readonly locked: boolean;
}

/**
 * THE WEEKDAY PICKER — which days of the week, as a row of seven toggles.
 *
 * Google Calendar's and Outlook's custom-recurrence row («Repeat on»), and
 * the shape a weekly roster asks the same question in. Apple's own answer
 * is a seven-row checklist; on a phone-width sheet that is seven rows of
 * chrome for one fact, where a row of circles is one glance.
 *
 * Monday first, like `ui-month-picker` — Bulgaria's week, a product
 * decision stated once rather than a locale guess. The labels are `Intl`'s
 * `short` for the locale; each toggle's accessible name is the whole
 * weekday, its state `aria-pressed`.
 *
 * A MINIMUM (`uiMinimum`, default one): the last day on cannot be switched
 * off beneath it — a weekly rule with no days never occurs, and a control
 * that lets you build one only to be told so is two acts where none was
 * needed. That toggle stays pressed and says it is not available.
 *
 * The consumer owns the set: `uiSelected` in, `uiSelectedChange` out, in
 * ISO order.
 */
@Component({
  selector: 'ui-weekday-picker',
  imports: [UiInteractiveDirective],
  template: `
    <div
      role="group"
      class="ui-weekday-picker__days"
      [attr.aria-label]="uiLabel() || null"
    >
      @for (day of days(); track day.iso) {
        <button
          type="button"
          class="ui-weekday-picker__day"
          uiInteractive
          [attr.aria-label]="day.name"
          [attr.aria-pressed]="day.on"
          [attr.aria-disabled]="day.locked ? 'true' : null"
          [attr.data-selected]="day.on ? '' : null"
          [attr.data-testid]="uiTestId() ? uiTestId() + '-' + day.iso : null"
          (click)="toggle(day)"
        >
          <span aria-hidden="true">{{ day.short }}</span>
        </button>
      }
    </div>
  `,
  styleUrl: './weekday-picker.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Unscoped, like every DS composition: `.ui-*` is the styling contract.
  encapsulation: ViewEncapsulation.None,
  host: { class: 'ui-weekday-picker' },
})
export class UiWeekdayPicker {
  /** The days that are on, as ISO weekdays. */
  readonly uiSelected = input.required<readonly number[]>();
  readonly uiLocale = input('en');
  /** The group's accessible name — what the days are OF. */
  readonly uiLabel = input('');
  /** How many days must stay on. */
  readonly uiMinimum = input(1);
  /** Each toggle's `data-testid` is this, a dash, and its ISO weekday. */
  readonly uiTestId = input<string | null>(null);
  readonly uiSelectedChange = output<readonly UiIsoWeekday[]>();

  protected readonly days = computed<readonly WeekdayCell[]>(() => {
    const locale = this.uiLocale();
    const selected = new Set(this.uiSelected());
    const short = new Intl.DateTimeFormat(locale, {
      weekday: 'short',
      timeZone: 'UTC',
    });
    const long = new Intl.DateTimeFormat(locale, {
      weekday: 'long',
      timeZone: 'UTC',
    });
    const atFloor = selected.size <= this.uiMinimum();
    // 2026-08-03 is a Monday; walking seven from it names the week in order.
    return ISO_WEEK.map((iso) => {
      const at = new Date(Date.UTC(2026, 7, 2 + iso));
      const on = selected.has(iso);
      return {
        iso,
        short: short.format(at),
        name: long.format(at),
        on,
        locked: on && atFloor,
      };
    });
  });

  protected toggle(day: WeekdayCell): void {
    if (day.locked) return;
    const next = new Set(this.uiSelected());
    if (day.on) next.delete(day.iso);
    else next.add(day.iso);
    this.uiSelectedChange.emit(ISO_WEEK.filter((iso) => next.has(iso)));
  }
}
