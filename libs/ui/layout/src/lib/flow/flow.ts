import {
  ChangeDetectionStrategy,
  Component,
  ViewEncapsulation,
  input,
} from '@angular/core';
import type { UiAlignment, UiSpacing } from '../stack/stack';

/**
 * SwiftUI parity: the flow `Layout` (WWDC22 "Compose custom layouts"
 * FlowLayout — the wrapping HStack). An `HStack` never wraps; a chip/tag
 * cluster that must break onto new lines is its own layout, so it gets its
 * own primitive rather than a wrap flag on `ui-stack`.
 *
 * @uiPurpose Lays children out in a row that wraps onto new lines, for clusters
 *   of chips or tags.
 * @uiSwiftUI a custom `Layout` (the WWDC22 `FlowLayout` sample); SwiftUI ships
 *   no built-in wrapping stack
 * @uiAliases wrap, flex-wrap, flow layout, tag cloud, chip group
 * @uiNotThis A single row or column that never wraps is `ui-stack`; equal
 *   columns are `ui-grid`.
 */
@Component({
  selector: 'ui-flow',
  template: `<ng-content />`,
  styleUrl: './flow.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Unscoped: bare `.ui-*`/`[data-*]` selectors never match a component's
  // own HOST element under emulated encapsulation (see avatar.ts) — and
  // global `.ui-*` classes are this system's actual styling contract (§3.1).
  encapsulation: ViewEncapsulation.None,
  host: {
    class: 'ui-flow',
    '[attr.data-spacing]': 'uiSpacing()',
    '[attr.data-alignment]': 'uiAlignment()',
  },
})
export class UiFlow {
  readonly uiSpacing = input<UiSpacing>('regular');
  readonly uiAlignment = input<UiAlignment>('center');
}
