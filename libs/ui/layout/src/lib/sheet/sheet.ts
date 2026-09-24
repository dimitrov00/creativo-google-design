import { isPlatformBrowser } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  PLATFORM_ID,
  ViewEncapsulation,
  afterNextRender,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { UiSheetBehavior } from './sheet-behavior';

/**
 * The mark a sheet's surface carries while another sheet is up OVER it —
 * the surface recedes (modal-sheet.css) and its bars sink out of the way
 * (sheet-action-bar.css), the way the first sheet steps back behind a
 * second on iOS.
 */
export const UI_SHEET_STACKED_ATTRIBUTE = 'data-ui-sheet-stacked';

const SURFACE_SELECTOR = '.ui-sheet__surface';

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
 *
 * STACKED (2026-09-17): a sheet declared INSIDE another sheet's surface —
 * a card over the visit editor, the country picker over a form sheet —
 * presents in the TOP LAYER (a manual popover), so the surface it sits in,
 * transformed and scrolling, can neither contain nor clip it, and it rises
 * over the whole viewport like a second sheet. While it is up the surface
 * beneath is marked {@link UI_SHEET_STACKED_ATTRIBUTE}; the body's scroll
 * lock is left to that surface's own sheet. Where popovers do not exist
 * the sheet stays in place, held inside the surface by its transform —
 * still over the content, just not over the chrome.
 */
@Component({
  selector: 'ui-sheet',
  template: `<div class="ui-sheet__surface" tabindex="-1"><ng-content /></div>`,
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
    '[attr.data-stacked]': "stacked() ? '' : null",
    '[attr.popover]': "stacked() ? 'manual' : null",
    // The host IS the scrim — a direct press on it (not on the surface)
    // requests dismissal; Escape/Tab handling delegates to the behavior.
    '(pointerdown)': 'behavior.onBackdropPointerDown($event)',
    '(pointerup)': 'behavior.onBackdropPointerUp($event)',
    '(keydown)': 'behavior.onKeydown($event)',
  },
})
export class UiSheet {
  protected readonly behavior = inject(UiSheetBehavior);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly destroyRef = inject(DestroyRef);

  /** The surface this sheet is declared inside, once the tree is built; none for a sheet of the page's own. */
  private parentSurface: HTMLElement | null = null;
  /** Declared inside another sheet's surface: presents in the top layer, over it. */
  protected readonly stacked = signal(false);
  private lowering: ReturnType<typeof setTimeout> | null = null;

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
      dialogSelector: SURFACE_SELECTOR,
      // Focus lands on the surface itself (tabindex="-1"), not the first
      // control — keyboard users are inside the dialog (Escape and the Tab
      // trap work) without a visible ring on the close button at every
      // open (owner call 2026-07-23: no control autofocus).
      initialFocusSelector: SURFACE_SELECTOR,
      // A stacked sheet leaves the body's lock to the sheet it sits in.
      lockScroll: () => !this.stacked(),
    });

    if (!isPlatformBrowser(this.platformId)) return;
    // Where the sheet is declared is known only once the tree is built:
    // content projected into another sheet lands in its surface after this
    // constructor runs.
    afterNextRender(() => {
      this.parentSurface =
        this.host.nativeElement.parentElement?.closest<HTMLElement>(
          SURFACE_SELECTOR,
        ) ?? null;
      this.stacked.set(this.parentSurface !== null);
    });
    effect(() => {
      const open = this.uiIsPresented();
      const closing = this.uiClosing();
      if (!this.stacked()) return;
      untracked(() => {
        if (open) this.raise();
        else if (!closing) this.lower();
      });
    });
    this.destroyRef.onDestroy(() => {
      this.parentSurface?.removeAttribute(UI_SHEET_STACKED_ATTRIBUTE);
      if (this.lowering !== null) clearTimeout(this.lowering);
      this.hide();
    });
  }

  /** Up: the surface beneath steps back, and the sheet takes the top layer. */
  private raise(): void {
    this.parentSurface?.setAttribute(UI_SHEET_STACKED_ATTRIBUTE, '');
    if (this.lowering !== null) {
      clearTimeout(this.lowering);
      this.lowering = null;
    }
    const host = this.host.nativeElement;
    if (typeof host.showPopover !== 'function') return;
    if (!host.matches(':popover-open')) host.showPopover();
  }

  /**
   * Down: the surface beneath comes forward at once, and the sheet leaves
   * the top layer once its exit transition is over — read off the
   * surface's own `transitionend`, with the motion token as the fallback
   * clock, so the slide down plays out where it started.
   */
  private lower(): void {
    this.parentSurface?.removeAttribute(UI_SHEET_STACKED_ATTRIBUTE);
    const host = this.host.nativeElement;
    if (
      typeof host.hidePopover !== 'function' ||
      !host.matches(':popover-open')
    ) {
      return;
    }
    const surface = host.querySelector<HTMLElement>(SURFACE_SELECTOR);
    const done = () => {
      surface?.removeEventListener('transitionend', onEnd);
      if (this.lowering !== null) clearTimeout(this.lowering);
      this.lowering = null;
      // Re-presented meanwhile: it stays up.
      if (this.uiIsPresented() || this.uiClosing()) return;
      this.hide();
    };
    const onEnd = (event: TransitionEvent) => {
      if (event.target !== surface) return;
      if (
        event.propertyName !== 'transform' &&
        event.propertyName !== 'opacity'
      )
        return;
      done();
    };
    surface?.addEventListener('transitionend', onEnd);
    const view = this.host.nativeElement.ownerDocument.defaultView;
    const ms = parseFloat(
      view
        ?.getComputedStyle(host)
        .getPropertyValue('--sys-motion-duration-deliberate') || '300',
    );
    this.lowering = setTimeout(done, (Number.isFinite(ms) ? ms : 300) + 50);
  }

  private hide(): void {
    const host = this.host.nativeElement;
    if (
      typeof host.hidePopover === 'function' &&
      host.matches(':popover-open')
    ) {
      host.hidePopover();
    }
  }
}
