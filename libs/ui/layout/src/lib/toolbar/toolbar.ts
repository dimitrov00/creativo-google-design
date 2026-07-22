import {
  ChangeDetectionStrategy,
  Component,
  ViewEncapsulation,
  input,
} from '@angular/core';

/** SwiftUI parity: `ToolbarItemPlacement` top bar vs `.bottomBar`. */
export type UiToolbarPlacement = 'top' | 'bottom';
/** SwiftUI parity: default chrome vs `.toolbarBackground(.hidden)`. */
export type UiToolbarTone = 'default' | 'overlay';

/** Horizontal bar — app header / action bar (top), or a bottom action bar. */
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
    '[attr.data-placement]': 'uiPlacement()',
    '[attr.data-tone]': 'uiTone()',
  },
})
export class UiToolbar {
  readonly uiSticky = input(false);
  readonly uiPlacement = input<UiToolbarPlacement>('top');
  readonly uiTone = input<UiToolbarTone>('default');
}
