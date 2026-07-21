import {
  ChangeDetectionStrategy,
  Component,
  ViewEncapsulation,
  input,
} from '@angular/core';

/** Horizontal bar — app header / action bar, typically sticky. */
@Component({
  selector: 'ui-toolbar',
  template: `<ng-content />`,
  styleUrl: './toolbar.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Unscoped: bare `.ui-*`/`[data-*]` selectors never match a component's
  // own HOST element under emulated encapsulation (see avatar.ts) — and
  // global `.ui-*` classes are this system's actual styling contract (§3.1).
  encapsulation: ViewEncapsulation.None,
  host: {
    class: 'ui-toolbar',
    '[attr.data-sticky]': "uiSticky() ? '' : null",
  },
})
export class UiToolbar {
  readonly uiSticky = input(false);
}
