import {
  ChangeDetectionStrategy,
  Component,
  ViewEncapsulation,
  booleanAttribute,
  input,
} from '@angular/core';

/** SwiftUI parity: `ToolbarItemPlacement` top bar vs `.bottomBar`. */
export type UiToolbarPlacement = 'top' | 'bottom';
/** ≙ SwiftUI `.toolbarBackground(_:)` visibility — `automatic` chrome or `hidden`. */
/**
 * ≙ SwiftUI `.toolbarBackground(_:for:)`.
 *
 * `automatic` is the solid bar with a hairline. `hidden` is transparent chrome
 * for bars over media (and, when sticky, plain page surface so scrolled
 * content never slides through the controls). `scrim` is the third: the bar
 * itself stays transparent and a fade ramps UP from its bottom edge, so
 * content dissolves as it passes underneath — the mirror of
 * `ui-page-action-bar`'s bottom ramp, and the right chrome for a bar floating
 * over something that must stay visible behind it, like a map.
 */
export type UiToolbarBackground = 'automatic' | 'hidden' | 'scrim';

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
    '[attr.data-toolbar-background]': 'uiToolbarBackground()',
  },
})
export class UiToolbar {
  readonly uiSticky = input(false, { transform: booleanAttribute });
  readonly uiPlacement = input<UiToolbarPlacement>('top');
  readonly uiToolbarBackground = input<UiToolbarBackground>('automatic');
}
