import {
  ChangeDetectionStrategy,
  Component,
  ViewEncapsulation,
  input,
} from '@angular/core';
import type { UiSpacing } from '../stack/stack';

/**
 * SwiftUI parity: `LazyVGrid(columns: [GridItem(.flexible())], spacing:)` —
 * an equal-column grid. The column count is published as the
 * `--ui-grid-columns` custom property (the sanctioned exception to
 * "zero styles in TS", like `uiFrame`: a raw count has no finite semantic
 * scale), so consumers can override it in their own media queries for
 * responsive column counts.
 *
 * `uiAdaptiveMinimum` ≙ `LazyVGrid(columns: [GridItem(.adaptive(minimum:))])`
 * — as many equal columns as fit, each at least the given length (any CSS
 * length; a raw length has no finite semantic scale, same exception as
 * above). When set it takes over the template and `uiColumns` is ignored.
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
    '[style.--ui-grid-adaptive-min]': 'uiAdaptiveMinimum() ?? null',
    '[attr.data-adaptive]': "uiAdaptiveMinimum() !== undefined ? '' : null",
    '[attr.data-spacing]': 'uiSpacing()',
    '[attr.data-row-spacing]': 'uiRowSpacing() ?? null',
  },
})
export class UiGrid {
  readonly uiColumns = input(2);
  /** ≙ `GridItem(.adaptive(minimum:))` — any CSS length, e.g. `"9rem"`. */
  readonly uiAdaptiveMinimum = input<string | undefined>(undefined);
  readonly uiSpacing = input<UiSpacing>('regular');
  /** Optional row-gap override; unset leaves `uiSpacing` on both axes. */
  readonly uiRowSpacing = input<UiSpacing | undefined>(undefined);
}
