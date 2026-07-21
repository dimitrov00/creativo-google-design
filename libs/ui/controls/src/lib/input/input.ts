import {
  ChangeDetectionStrategy,
  Component,
  ViewEncapsulation,
  input,
} from '@angular/core';
import type { UiControlSize } from '../button/button';

/** Native `<input>`/`<textarea>` element — free a11y semantics, zero ARIA hand-rolling. */
@Component({
  selector: 'input[uiInput], textarea[uiInput]',
  template: '',
  styleUrl: './input.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Unscoped: bare `.ui-*`/`[data-*]` selectors never match a component's
  // own HOST element under emulated encapsulation (see avatar.ts) — and
  // global `.ui-*` classes are this system's actual styling contract (§3.1).
  encapsulation: ViewEncapsulation.None,
  host: {
    class: 'ui-input',
    '[attr.data-size]': 'uiSize()',
    '[attr.data-invalid]': 'uiInvalid() ? "" : null',
    '[attr.aria-invalid]': 'uiInvalid() || null',
  },
})
export class UiInput {
  readonly uiSize = input<UiControlSize>('regular');
  readonly uiInvalid = input(false);
}
