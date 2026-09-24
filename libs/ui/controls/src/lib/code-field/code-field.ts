import {
  ChangeDetectionStrategy,
  Component,
  ViewEncapsulation,
  input,
  output,
} from '@angular/core';
import type { UiControlSize } from '../button/button';

/** SwiftUI parity: `.textFieldStyle(.roundedBorder)` and `.textFieldStyle(.plain)`. */
export type UiCodeFieldAppearance = 'bordered' | 'plain';

/**
 * THE CODE FIELD — a code somebody types or reads off a print: `GIFT2025`,
 * `FIRST10`.
 *
 * The text field's sibling for a value that is a CODE (owner, 2026-09-16:
 * "why hand-roll inputs instead of a robust component you reuse?"):
 * capitals as typed and on the keyboard, tabular, autocorrect and
 * spell-check off; every keystroke reported raw through `uiInput`; Return
 * as `uiSubmit`, for an owner whose CTA asks the code; a refused code marked
 * with the native `aria-invalid`, the words of the verdict being the
 * owner's. An accessory at the trailing edge — a scan glyph, a clear glyph —
 * is projected (`[uiCodeFieldAction]`) INSIDE the field, so the field owes
 * nothing to what it is used for.
 *
 * Two dresses, the way SwiftUI's text field has two styles. BORDERED (the
 * default) is the form field of the signup flow — the text field's own
 * frame, fill, tiers and focus glow, composed the way the phone field
 * composes its country trigger and number inside one border, so a code
 * field and a name field on one form are one family. PLAIN carries no
 * surface of its own: its owner (a pill, a row) is the surface, a hidden
 * sizer lets the field hug its code, and the owner draws the ring when it
 * says so (`--ui-field-ring`), the way the unit and time fields hand theirs
 * over.
 */
@Component({
  selector: 'ui-code-field',
  template: `
    <span class="ui-code-field__frame">
      <span class="ui-code-field__sizer" aria-hidden="true">{{
        uiValue() || uiPlaceholder()
      }}</span>
      <input
        #native
        class="ui-code-field__native"
        type="text"
        autocomplete="off"
        autocapitalize="characters"
        autocorrect="off"
        spellcheck="false"
        [attr.enterkeyhint]="uiEnterKeyHint()"
        [attr.maxlength]="uiMaxLength()"
        [value]="uiValue()"
        [attr.placeholder]="uiPlaceholder() || null"
        [attr.id]="uiId()"
        [attr.aria-label]="uiLabel()"
        [attr.aria-invalid]="uiInvalid() || null"
        [attr.data-testid]="uiTestId()"
        (input)="uiInput.emit(native.value)"
        (change)="commit(native)"
        (keydown.enter)="uiSubmit.emit()"
      />
      <span class="ui-code-field__accessory"
        ><ng-content select="[uiCodeFieldAction]"
      /></span>
    </span>
  `,
  styleUrl: './code-field.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  host: {
    class: 'ui-code-field',
    '[attr.data-appearance]': 'uiAppearance()',
    '[attr.data-control-size]': 'uiControlSize()',
    '[attr.data-invalid]': 'uiInvalid() ? "" : null',
    '[attr.data-empty]': 'uiValue() ? null : ""',
  },
})
export class UiCodeField {
  /** The code, as the owner holds it. Empty shows the placeholder. */
  readonly uiValue = input('');
  /** What an empty field reads — an example code, never a blank. */
  readonly uiPlaceholder = input('');
  /** The accessible name, when no `<label for>` names the field. */
  readonly uiLabel = input<string | null>(null);
  /** The native input's id, for a `<label for>`. */
  readonly uiId = input<string | null>(null);
  readonly uiTestId = input<string | null>(null);
  /** The form field's frame (default), or no surface of its own. */
  readonly uiAppearance = input<UiCodeFieldAppearance>('bordered');
  /** The text field's 36/44/52 ladder, for the bordered dress. */
  readonly uiControlSize = input<UiControlSize>('regular');
  /** A code the owner refused: `aria-invalid`, and the frame or ring in the destructive ink. */
  readonly uiInvalid = input(false);
  readonly uiMaxLength = input<number | null>(null);
  readonly uiEnterKeyHint = input<'done' | 'go' | 'search' | 'send'>('done');
  /** Every keystroke, raw. */
  readonly uiInput = output<string>();
  /**
   * What was typed, raw, when the field is left. Note that Return makes the
   * engine fire this a beat after `uiSubmit`; an owner that asks on Return
   * must not read it as typing.
   */
  readonly uiValueChange = output<string>();
  /** Return — the owner's CTA, from the keyboard. */
  readonly uiSubmit = output<void>();

  protected commit(native: HTMLInputElement): void {
    this.uiValueChange.emit(native.value);
    native.value = this.uiValue();
  }
}
