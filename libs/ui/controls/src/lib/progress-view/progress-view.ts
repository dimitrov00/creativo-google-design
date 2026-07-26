import {
  ChangeDetectionStrategy,
  Component,
  ViewEncapsulation,
  input,
} from '@angular/core';
import type { UiControlSize } from '../button/button';

/**
 * ≙ SwiftUI `ProgressView()` / `ProgressView(value:)` — the indeterminate
 * spinner ring by default; binding `uiValue` (0…1) switches to the linear
 * determinate bar, exactly like SwiftUI's value-initialized form. The bar
 * fills its container's inline size — consumers own placement/measure.
 */
@Component({
  selector: 'ui-progress-view',
  template: `@if (uiValue() !== undefined) {
    <div class="ui-progress-view__fill"></div>
  }`,
  styleUrl: './progress-view.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Unscoped: bare `.ui-*`/`[data-*]` selectors never match a component's
  // own HOST element under emulated encapsulation (see avatar.ts) — and
  // global `.ui-*` classes are this system's actual styling contract (§3.1).
  encapsulation: ViewEncapsulation.None,
  host: {
    class: 'ui-progress-view',
    '[attr.data-control-size]': 'uiControlSize()',
    '[attr.data-determinate]': "uiValue() !== undefined ? '' : null",
    '[style.--ui-progress-value]': 'uiValue() ?? null',
    '[attr.role]': "uiValue() !== undefined ? 'progressbar' : 'status'",
    '[attr.aria-label]': "uiValue() !== undefined ? null : 'Loading'",
    '[attr.aria-valuemin]': 'uiValue() !== undefined ? 0 : null',
    '[attr.aria-valuemax]': 'uiValue() !== undefined ? 1 : null',
    '[attr.aria-valuenow]': 'uiValue() ?? null',
  },
})
export class UiProgressView {
  readonly uiControlSize = input<UiControlSize>('regular');
  /** 0…1 — bound value flips the spinner into the determinate bar. */
  readonly uiValue = input<number | undefined>(undefined);
}
