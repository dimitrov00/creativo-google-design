import {
  ChangeDetectionStrategy,
  Component,
  ViewEncapsulation,
  input,
} from '@angular/core';

/** SwiftUI parity: `Divider()` — axis follows the enclosing stack. */
export type UiDividerOrientation = 'horizontal' | 'vertical';

/** Hairline separator — the one sanctioned 1px `--sys-color-separator` rule. */
@Component({
  selector: 'ui-divider',
  template: ``,
  styleUrl: './divider.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Unscoped: bare `.ui-*`/`[data-*]` selectors never match a component's
  // own HOST element under emulated encapsulation (see avatar.ts) — and
  // global `.ui-*` classes are this system's actual styling contract (§3.1).
  encapsulation: ViewEncapsulation.None,
  host: {
    class: 'ui-divider',
    role: 'separator',
    '[attr.aria-orientation]': 'uiOrientation()',
    '[attr.data-orientation]': 'uiOrientation()',
    '[attr.data-inset]': "uiInset() ? '' : null",
  },
})
export class UiDivider {
  readonly uiOrientation = input<UiDividerOrientation>('horizontal');
  /** Leading inset aligning the hairline with list-row content past a glyph. */
  readonly uiInset = input(false);
}
