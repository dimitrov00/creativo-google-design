import {
  ChangeDetectionStrategy,
  Component,
  ViewEncapsulation,
  inject,
  input,
} from '@angular/core';
import { UiSheetBehavior } from './sheet-behavior';

export type UiSheetPlacement = 'bottom' | 'center' | 'end';
/** SwiftUI parity: `.presentationDetents` — surface measure, not placement. */
/** ≙ SwiftUI `.presentationSizing(_:)` — automatic, or the wide `.page` set-piece. */
export type UiSheetPresentationSizing = 'automatic' | 'page';

/**
 * Headless modal/drawer surface — bottom sheet on mobile, side drawer/dialog
 * on desktop. The modal behavior contract (body scroll lock, focus
 * capture/trap/restore, Escape + backdrop dismissal) comes from the shared
 * {@link UiSheetBehavior} host directive; dismissal is only *requested* —
 * `uiOnDismiss` fires and the owner flips `uiIsPresented` itself.
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
  hostDirectives: [
    { directive: UiSheetBehavior, outputs: ['uiSheetDismissed: uiOnDismiss'] },
  ],
  host: {
    class: 'ui-sheet',
    role: 'dialog',
    '[attr.data-presented]': "uiIsPresented() ? '' : null",
    '[attr.data-placement]': 'uiPlacement()',
    '[attr.data-presentation-sizing]': 'uiPresentationSizing()',
    '[attr.aria-modal]': 'uiIsPresented() || null',
    // The host IS the scrim — a direct press on it (not on the surface)
    // requests dismissal; Escape/Tab handling delegates to the behavior.
    '(pointerdown)': 'behavior.onBackdropPointerDown($event)',
    '(pointerup)': 'behavior.onBackdropPointerUp($event)',
    '(keydown)': 'behavior.onKeydown($event)',
  },
})
export class UiSheet {
  protected readonly behavior = inject(UiSheetBehavior);

  readonly uiIsPresented = input(false);
  readonly uiPlacement = input<UiSheetPlacement>('bottom');
  readonly uiPresentationSizing = input<UiSheetPresentationSizing>('automatic');
  /**
   * The owner is playing its exit transition — forwarded to the behavior's
   * `closing` signal so the modal environment (scroll lock, `inert`, focus
   * restore) stays active until the close animation actually finishes.
   */
  readonly uiClosing = input(false);

  constructor() {
    this.behavior.connect({
      open: this.uiIsPresented,
      closing: this.uiClosing,
      dialogSelector: '.ui-sheet__surface',
      // Standard dialog a11y: move focus to the first focusable control so
      // keyboard users land inside the sheet (and Escape reaches it).
      initialFocusSelector:
        'a[href], button:not([disabled]), input:not([disabled]), ' +
        'select:not([disabled]), textarea:not([disabled]), ' +
        '[tabindex]:not([tabindex="-1"])',
    });
  }
}
