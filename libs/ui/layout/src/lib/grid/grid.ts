import {
  ChangeDetectionStrategy,
  Component,
  ViewEncapsulation,
  input,
} from '@angular/core';
import type { UiStackGap } from '../stack/stack';

/**
 * SwiftUI parity: `LazyVGrid(columns: [GridItem(.flexible())], spacing:)` —
 * an equal-column grid. The column count is published as the
 * `--ui-grid-columns` custom property (the sanctioned exception to
 * "zero styles in TS", like `uiFrame`: a raw count has no finite semantic
 * scale), so consumers can override it in their own media queries for
 * responsive column counts.
 */
@Component({
  selector: 'ui-grid',
  template: `<ng-content />`,
  styleUrl: './grid.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Unscoped: bare `.ui-*`/`[data-*]` selectors never match a component's
  // own HOST element under emulated encapsulation (see avatar.ts) — and
  // global `.ui-*` classes are this system's actual styling contract (§3.1).
  encapsulation: ViewEncapsulation.None,
  host: {
    class: 'ui-grid',
    '[style.--ui-grid-columns]': 'uiColumns()',
    '[attr.data-gap]': 'uiGap()',
    '[attr.data-row-gap]': 'uiRowGap() ?? null',
  },
})
export class UiGrid {
  readonly uiColumns = input(2);
  readonly uiGap = input<UiStackGap>('regular');
  /** Optional row-gap override; unset leaves `uiGap` on both axes. */
  readonly uiRowGap = input<UiStackGap | undefined>(undefined);
}
