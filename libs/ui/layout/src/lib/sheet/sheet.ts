import {
  ChangeDetectionStrategy,
  Component,
  ViewEncapsulation,
  input,
} from '@angular/core';

export type UiSheetPlacement = 'bottom' | 'center' | 'end';

/**
 * Headless modal/drawer surface — bottom sheet on mobile, side drawer/dialog
 * on desktop. Purely presentational at this phase: no focus-trap/open-state
 * machinery, just the visual surface + `[data-open]` hook for a future
 * overlay service to drive.
 */
@Component({
  selector: 'ui-sheet',
  template: `<div class="ui-sheet__surface"><ng-content /></div>`,
  styleUrl: './sheet.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Unscoped: bare `.ui-*`/`[data-*]` selectors never match a component's
  // own HOST element under emulated encapsulation (see avatar.ts) — and
  // global `.ui-*` classes are this system's actual styling contract (§3.1).
  encapsulation: ViewEncapsulation.None,
  host: {
    class: 'ui-sheet',
    role: 'dialog',
    '[attr.data-open]': "uiOpen() ? '' : null",
    '[attr.data-placement]': 'uiPlacement()',
    '[attr.aria-modal]': 'uiOpen() || null',
  },
})
export class UiSheet {
  readonly uiOpen = input(false);
  readonly uiPlacement = input<UiSheetPlacement>('bottom');
}
