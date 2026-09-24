import {
  ChangeDetectionStrategy,
  Component,
  ViewEncapsulation,
  computed,
  input,
  output,
  signal,
} from '@angular/core';
import { UiButton } from '../button/button';
import { UiIcon } from '../icon/icon';

let nextAmountId = 0;

/** How many places the figure is written to: money's two, or none for a whole count. */
export type UiAmountFractionDigits = 0 | 2;

/**
 * Units → the figure a hand writes: minor units `550` → «5,50» with two
 * places; a whole count `10` → «10» with none.
 */
export function formatAmountFigure(
  units: number,
  separator = ',',
  fractionDigits: UiAmountFractionDigits = 2,
): string {
  const sign = units < 0 ? '−' : '';
  if (fractionDigits === 0) return `${sign}${Math.abs(units)}`;
  const whole = Math.floor(Math.abs(units) / 100);
  const cents = Math.abs(units) % 100;
  return `${sign}${whole}${separator}${String(cents).padStart(2, '0')}`;
}

/**
 * A typed figure → minor units (or a whole count), or `null` for anything
 * that is not one. Takes what a phone's keypad actually produces: `5`,
 * `5.5`, `5,50` — and for a whole count, digits alone.
 */
export function parseAmountFigure(
  raw: string,
  fractionDigits: UiAmountFractionDigits = 2,
): number | null {
  if (fractionDigits === 0) {
    const whole = /^(\d+)$/.exec(raw.trim());
    return whole ? Number(whole[1]) : null;
  }
  const match = /^(\d+)(?:[.,](\d{1,2}))?$/.exec(raw.trim());
  if (!match) return null;
  const whole = Number(match[1]);
  const cents = Number((match[2] ?? '').padEnd(2, '0'));
  return whole * 100 + cents;
}

/**
 * THE AMOUNT FIELD — one sum, written large.
 *
 * The figure sits in the centre at the large-title tier with its unit a
 * role quieter beside it; empty, it shows a muted «0,00» rather than a
 * blank, so the shape of the answer is on screen before the answer is
 * (Apple Cash, Bolt's «Set tip amount», Venmo). Two round buttons flank
 * it to step the sum by a fixed amount — the −/+ pair Apple's own
 * steppers and the goal-entry screens in the Mobbin sweep use — so a
 * barber can correct by a coin without the keyboard. Tapping the figure
 * still opens the decimal keypad. The three are ONE centred cluster — the
 * pair hugs the figure at the regular gap, where a thumb already is — and
 * the figure's cell is exactly as wide as its digits: a hidden sizer states
 * the width (what is being typed, else what was kept, else the zero) and
 * the native input adds none of its own, so the figure centres true. An
 * owner that names a `uiReserve` figure («00,00») keeps the cell at least
 * that wide, the live figure centred in it, so the pair STAYS PUT as
 * digits come and go — a thumb tapping + never chases the button — and
 * the figures are tabular, digit for digit. The control owns no space
 * around itself; the page composes it.
 *
 * The contract is MONEY IN MINOR UNITS — or, with `uiFractionDigits` at
 * none, a WHOLE COUNT such as a percent: `uiValue` is the owner's number
 * (`null` for none), `uiValueChange` answers with a number or `null`
 * (an emptied field clears; nothing is written for a figure that is not
 * one — the field springs back to what it was given, `ui-unit-field`'s
 * rule). Steps AND typed figures are clamped to `[uiMin, uiMax]`: a hand
 * that writes past the ceiling sees the figure snap to it (owner,
 * 2026-09-16: "if typed more than the actual price it should auto-cap it
 * to the total") — the snap is the message. The component formats
 * and parses its own figure (`,` by default, `.` accepted when typed), so
 * no consumer hand-rolls the maths, and the two helpers are exported for
 * the owner's own formatting.
 *
 * Accessible as a group named for what it asks; the input carries the
 * same name and is described by the unit; each stepper button names its
 * act in the consumer's words.
 */
@Component({
  selector: 'ui-amount-field',
  imports: [UiButton, UiIcon],
  template: `
    @if (uiStepper()) {
      <button
        type="button"
        uiButton
        uiButtonStyle="bordered"
        uiTint="neutral"
        uiControlSize="regular"
        [uiIconOnly]="true"
        class="ui-amount-field__step"
        [disabled]="!canDecrease()"
        [attr.aria-label]="uiDecreaseLabel()"
        [attr.data-testid]="uiTestId() ? uiTestId() + '-decrease' : null"
        (click)="step(-1)"
      >
        <ui-icon uiName="action.remove" />
      </button>
    }
    <span class="ui-amount-field__figure">
      @if (uiReserve(); as reserve) {
        <span class="ui-amount-field__reserve" aria-hidden="true">
          <span class="ui-amount-field__reserve-figure">{{ reserve }}</span>
          @if (uiUnit()) {
            <span class="ui-amount-field__unit">{{ uiUnit() }}</span>
          }
        </span>
      }
      <span class="ui-amount-field__line">
        <span class="ui-amount-field__sizer" aria-hidden="true">{{
          sizerText()
        }}</span>
        <input
          #native
          class="ui-amount-field__native"
          type="text"
          size="1"
          [attr.inputmode]="uiFractionDigits() === 0 ? 'numeric' : 'decimal'"
          autocomplete="off"
          [value]="figure()"
          [attr.placeholder]="placeholder()"
          [attr.id]="uiId()"
          [attr.aria-label]="uiLabel()"
          [attr.aria-describedby]="uiUnit() ? unitId : null"
          [attr.data-testid]="uiTestId()"
          (input)="typed(native)"
          (change)="commit(native)"
          (keydown.enter)="uiSubmit.emit()"
        />
        @if (uiUnit()) {
          <span
            class="ui-amount-field__unit"
            [id]="unitId"
            aria-hidden="true"
            >{{ uiUnit() }}</span
          >
        }
      </span>
    </span>
    @if (uiStepper()) {
      <button
        type="button"
        uiButton
        uiButtonStyle="bordered"
        uiTint="neutral"
        uiControlSize="regular"
        [uiIconOnly]="true"
        class="ui-amount-field__step"
        [disabled]="!canIncrease()"
        [attr.aria-label]="uiIncreaseLabel()"
        [attr.data-testid]="uiTestId() ? uiTestId() + '-increase' : null"
        (click)="step(1)"
      >
        <ui-icon uiName="action.add" />
      </button>
    }
  `,
  styleUrl: './amount-field.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Unscoped, like every DS control: `.ui-*` is the styling contract.
  encapsulation: ViewEncapsulation.None,
  host: {
    class: 'ui-amount-field',
    role: 'group',
    '[attr.aria-label]': 'uiLabel()',
  },
})
export class UiAmountField {
  protected readonly unitId = `ui-amount-field-unit-${nextAmountId++}`;

  /** The sum, in minor units; `null` for none. */
  readonly uiValue = input<number | null>(null);
  /** The unit beside the figure — «€». */
  readonly uiUnit = input('');
  /** The decimal mark the figure is written with. */
  readonly uiDecimalSeparator = input(',');
  /** Money's two places, or none for a whole count («10 %»). */
  readonly uiFractionDigits = input<UiAmountFractionDigits>(2);
  /** Shown while empty; the zero figure («0,00») unless the owner says otherwise. */
  readonly uiPlaceholder = input<string | null>(null);
  /**
   * A figure whose width the cell always keeps («00,00» holds the pair
   * still under a hundred), so the −/+ never move as digits come and go.
   */
  readonly uiReserve = input<string | null>(null);
  /** What one press of the stepper adds or takes, in minor units. */
  readonly uiStep = input(100);
  readonly uiMin = input(0);
  readonly uiMax = input<number | null>(null);
  /** The −/+ pair; off for a field that only takes typing. */
  readonly uiStepper = input(true);
  /** What the field asks — the group's and the input's accessible name. */
  readonly uiLabel = input<string | null>(null);
  readonly uiDecreaseLabel = input<string | null>(null);
  readonly uiIncreaseLabel = input<string | null>(null);
  readonly uiId = input<string | null>(null);
  readonly uiTestId = input<string | null>(null);

  /** Every keystroke, raw — for an owner that wants to react while typing. */
  readonly uiInput = output<string>();
  /** A committed sum in minor units, or `null` for an emptied field. */
  readonly uiValueChange = output<number | null>();
  /**
   * Return — the owner's CTA, from the keyboard. The engine fires the
   * field's `change` a beat AFTER it; an owner that acts on Return must not
   * read that commit as new typing.
   */
  readonly uiSubmit = output<void>();

  protected readonly figure = computed(() => {
    const minor = this.uiValue();
    return minor === null
      ? ''
      : formatAmountFigure(
          minor,
          this.uiDecimalSeparator(),
          this.uiFractionDigits(),
        );
  });

  protected readonly placeholder = computed(
    () =>
      this.uiPlaceholder() ??
      formatAmountFigure(0, this.uiDecimalSeparator(), this.uiFractionDigits()),
  );

  /** What is being typed, while it is being typed; the sizer follows it. */
  private readonly draft = signal<string | null>(null);

  /**
   * The width the figure's cell states: the text under the caret while
   * typing, else the figure kept, else the zero — never wider than the
   * digits, never narrower than what is being written, in every engine.
   */
  protected readonly sizerText = computed(() => {
    const shown = this.draft() ?? this.figure();
    return shown.length > 0 ? shown : this.placeholder();
  });

  protected readonly canDecrease = computed(
    () => (this.uiValue() ?? 0) > this.uiMin(),
  );

  protected readonly canIncrease = computed(() => {
    const max = this.uiMax();
    return max === null || (this.uiValue() ?? 0) < max;
  });

  /** A keystroke: the raw text goes out, and the cell follows the caret. */
  protected typed(native: HTMLInputElement): void {
    this.draft.set(native.value);
    this.uiInput.emit(native.value);
  }

  /** Return, the keyboard's Done, or leaving the field commits what was typed. */
  protected commit(native: HTMLInputElement): void {
    const raw = native.value.trim();
    this.draft.set(null);
    if (raw.length === 0) {
      this.uiValueChange.emit(null);
    } else {
      const units = parseAmountFigure(raw, this.uiFractionDigits());
      if (units !== null) this.uiValueChange.emit(this.clamp(units));
    }
    // Springs back to the owner's figure; the owner's answer re-renders it.
    native.value = this.figure();
  }

  /** One press: the sum moves by a step, never past the floor or the ceiling. */
  protected step(direction: 1 | -1): void {
    const current = this.uiValue() ?? 0;
    const next = this.clamp(current + direction * this.uiStep());
    if (next !== current) this.uiValueChange.emit(next);
  }

  private clamp(minor: number): number {
    const max = this.uiMax();
    const floored = Math.max(this.uiMin(), minor);
    return max === null ? floored : Math.min(max, floored);
  }
}
