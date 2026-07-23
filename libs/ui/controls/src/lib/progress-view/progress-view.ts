import {
  ChangeDetectionStrategy,
  Component,
  ViewEncapsulation,
  input,
} from '@angular/core';
import type { UiControlSize } from '../button/button';

/** ≙ SwiftUI `ProgressView()` (indeterminate) — pure CSS spinner ring, no content. */
@Component({
  selector: 'ui-progress-view',
  template: '',
  styleUrl: './progress-view.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Unscoped: bare `.ui-*`/`[data-*]` selectors never match a component's
  // own HOST element under emulated encapsulation (see avatar.ts) — and
  // global `.ui-*` classes are this system's actual styling contract (§3.1).
  encapsulation: ViewEncapsulation.None,
  host: {
    class: 'ui-progress-view',
    '[attr.data-control-size]': 'uiControlSize()',
    role: 'status',
    '[attr.aria-label]': '"Loading"',
  },
})
export class UiProgressView {
  readonly uiControlSize = input<UiControlSize>('regular');
}
