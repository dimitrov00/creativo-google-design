import {
  ChangeDetectionStrategy,
  Component,
  ViewEncapsulation,
  input,
} from '@angular/core';
import type { UiControlSize } from '../button/button';

/**
 * Native `<input>`/`<textarea>` element — free a11y semantics, zero ARIA hand-
 * rolling.
 *
 * @uiPurpose The text field: the look and sizes of a native input or textarea
 *   for free text.
 * @uiSwiftUI `TextField` and `TextEditor`
 * @uiAliases input, text input, textarea, textbox, form field
 * @uiNotThis A search is `ui-search-field`, a figure with a unit
 *   `ui-unit-field`, a code `ui-code-field`, a phone number `ui-phone-field`.
 */
@Component({
  selector: 'input[uiTextField], textarea[uiTextField]',
  template: '',
  styleUrl: './text-field.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Unscoped: bare `.ui-*`/`[data-*]` selectors never match a component's
  // own HOST element under emulated encapsulation (see avatar.ts) — and
  // global `.ui-*` classes are this system's actual styling contract (§3.1).
  encapsulation: ViewEncapsulation.None,
  host: {
    class: 'ui-text-field',
    '[attr.data-control-size]': 'uiControlSize()',
    '[attr.data-invalid]': 'uiInvalid() ? "" : null',
    '[attr.aria-invalid]': 'uiInvalid() || null',
  },
})
export class UiTextField {
  readonly uiControlSize = input<UiControlSize>('regular');
  readonly uiInvalid = input(false);
}
