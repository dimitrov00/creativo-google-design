import {
  ChangeDetectionStrategy,
  Component,
  ViewEncapsulation,
  input,
} from '@angular/core';
import type { UiControlSize } from '../button/button';

/** Custom element — pure CSS spinner, no content. */
@Component({
  selector: 'ui-spinner',
  template: '',
  styleUrl: './spinner.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Unscoped: bare `.ui-*`/`[data-*]` selectors never match a component's
  // own HOST element under emulated encapsulation (see avatar.ts) — and
  // global `.ui-*` classes are this system's actual styling contract (§3.1).
  encapsulation: ViewEncapsulation.None,
  host: {
    class: 'ui-spinner',
    '[attr.data-size]': 'uiSize()',
    role: 'status',
    '[attr.aria-label]': '"Loading"',
  },
})
export class UiSpinner {
  readonly uiSize = input<UiControlSize>('regular');
}
