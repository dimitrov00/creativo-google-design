import {
  ChangeDetectionStrategy,
  Component,
  ViewEncapsulation,
  input,
  output,
} from '@angular/core';

let nextUnitId = 0;

/**
 * THE UNIT FIELD — a figure with its unit beside it: `30 мин`, `10,00 €`.
 *
 * The time field's sibling for a value that is TYPED rather than picked
 * (owner, 2026-09-10: "do not hand-roll multiple input fields — one
 * reusable component, with a postfix icon or text"). The unit is NOT part
 * of the value: it sits after the figure as its own quiet word, so the
 * field holds `10,00` and says `€`, a placeholder reads `0,00` rather than a
 * blank, and the figure sizes to itself — a hidden sizer shares the cell
 * with the native input, and `field-sizing: content` keeps it honest while
 * typing where the engine knows it.
 *
 * The value is the consumer's, as a string; the field reports what was typed
 * on every `input` and on `change`, and THEN SHOWS WHAT THE OWNER ACCEPTED:
 * `[value]` rewrites the DOM only when the bound expression changes, so a
 * refused or snapped entry would otherwise sit there looking saved. Writing
 * the bound value straight back after the commit is the honest close — an
 * accepted value arrives through the binding a beat later, a rejected one
 * visibly springs back.
 *
 * Focus is drawn on the whole field, the way the time field draws it, so
 * the three fields of a sheet wear one ring.
 */
@Component({
  selector: 'ui-unit-field',
  template: `
    <span class="ui-unit-field__sizer" aria-hidden="true">{{
      uiValue() || uiPlaceholder()
    }}</span>
    <input
      #native
      class="ui-unit-field__native"
      [type]="uiType()"
      [attr.inputmode]="uiInputMode()"
      [value]="uiValue()"
      [attr.placeholder]="uiPlaceholder() || null"
      [attr.id]="uiId()"
      [attr.min]="uiMin()"
      [attr.step]="uiStep()"
      [attr.aria-label]="uiLabel()"
      [attr.aria-describedby]="uiUnit() ? unitId : null"
      [attr.data-testid]="uiTestId()"
      (input)="uiInput.emit(native.value)"
      (change)="commit(native)"
    />
    @if (uiUnit()) {
      <span class="ui-unit-field__unit" [id]="unitId" aria-hidden="true">{{
        uiUnit()
      }}</span>
    }
  `,
  styleUrl: './unit-field.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  host: {
    class: 'ui-unit-field',
    '[attr.data-control-size]': 'uiControlSize()',
  },
})
export class UiUnitField {
  protected readonly unitId = `ui-unit-field-unit-${nextUnitId++}`;

  /** The figure, as the consumer formats it — `30`, `10,00`. Empty shows the placeholder. */
  readonly uiValue = input('');
  /** The unit after the figure — `мин`, `€`. */
  readonly uiUnit = input('');
  /** What an empty field reads — `0,00`, never a blank. */
  readonly uiPlaceholder = input('');
  readonly uiType = input<'text' | 'number'>('text');
  readonly uiInputMode = input<'decimal' | 'numeric'>('decimal');
  readonly uiMin = input<number | string | null>(null);
  readonly uiStep = input<number | string | null>(null);
  /** The accessible name, when no `<label for>` names the field. */
  readonly uiLabel = input<string | null>(null);
  /** The native input's id, for a `<label for>`. */
  readonly uiId = input<string | null>(null);
  readonly uiTestId = input<string | null>(null);
  readonly uiControlSize = input<'small' | 'regular'>('regular');
  /** Every keystroke, raw — for an owner that wants to be dirty while typing. */
  readonly uiInput = output<string>();
  /** What was typed, raw, when the field is left. */
  readonly uiValueChange = output<string>();

  protected commit(native: HTMLInputElement): void {
    this.uiValueChange.emit(native.value);
    native.value = this.uiValue();
  }
}
