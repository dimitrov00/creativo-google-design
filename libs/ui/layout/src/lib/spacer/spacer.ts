import {
  ChangeDetectionStrategy,
  Component,
  ViewEncapsulation,
} from '@angular/core';

/**
 * SwiftUI parity: `Spacer()` — a flexible gap that pushes its flex siblings
 * apart. For use inside `ui-stack`/`ui-toolbar` rows; replaces ad-hoc
 * `justify-content: space-between` wrappers and `margin-*: auto` pins.
 */
@Component({
  selector: 'ui-spacer',
  template: ``,
  styleUrl: './spacer.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Unscoped: bare `.ui-*`/`[data-*]` selectors never match a component's
  // own HOST element under emulated encapsulation (see avatar.ts) — and
  // global `.ui-*` classes are this system's actual styling contract (§3.1).
  encapsulation: ViewEncapsulation.None,
  host: {
    class: 'ui-spacer',
    // Purely presentational — nothing for assistive tech to announce.
    'aria-hidden': 'true',
  },
})
export class UiSpacer {}
