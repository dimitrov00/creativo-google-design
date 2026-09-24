import {
  ChangeDetectionStrategy,
  Component,
  ViewEncapsulation,
  input,
} from '@angular/core';
import type { UiControlSize } from '../button/button';

/**
 * Native `<button>` element — a toggleable pill (filter/choice chip).
 *
 * Projects its content: text, a trailing `ui-icon` (a removable token's
 * ✕), and — projected FIRST — a `ui-avatar` for a chip that stands for a
 * person, which then sits flush with the leading edge (chip.css). Pick the
 * disc one rung under the chip: `small` in a `regular` chip.
 */
@Component({
  selector: 'button[uiChip]',
  template: `<ng-content />`,
  styleUrl: './chip.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Unscoped: bare `.ui-*`/`[data-*]` selectors never match a component's
  // own HOST element under emulated encapsulation (see avatar.ts) — and
  // global `.ui-*` classes are this system's actual styling contract (§3.1).
  encapsulation: ViewEncapsulation.None,
  host: {
    class: 'ui-chip',
    '[attr.data-selected]': 'uiSelected() ? "" : null',
    '[attr.data-control-size]': 'uiControlSize()',
    '[attr.aria-pressed]': 'uiSelected()',
  },
})
export class UiChip {
  readonly uiSelected = input(false);
  readonly uiControlSize = input<UiControlSize>('regular');
}
