import { DOCUMENT } from '@angular/common';
import { Injector, afterNextRender, inject, signal } from '@angular/core';

/**
 * FULL SCREEN for a frame (owner, 2026-09-10) — one rule for the visit
 * sheet's picture and the block sheet's.
 *
 * HIG's idiom: an expand control at the head's trailing edge, the same
 * control flipped to leave, and always an obvious way out — Escape too,
 * consumed here before the sheet reads it as "close". Entering and leaving
 * GROW (owner: "some sort of grow out and in animation"): a view
 * transition morphs the frame's box between its two states — the section
 * carries a `view-transition-name` — and where the platform has none, or
 * motion is reduced, the frame simply switches.
 *
 * A plain class made in a field initialiser: `inject()` still resolves
 * there, so the editor that owns it need not thread a document through.
 *
 * `settled` runs once the frame has its new height, either way — the
 * editor centres the block in it (owner, 2026-09-10: "after rescheduling
 * in full screen, on exit the event should be scrolled to, centred"). It
 * runs BEFORE a view transition takes its new snapshot, so the picture the
 * animation lands on is already the centred one.
 *
 * TRULY THE WHOLE SCREEN (owner, later the same day: "not filling the
 * sheet height but the entire screen"). A fixed box inside the sheet fills
 * the sheet's SURFACE — its transform is the containing block — so while
 * expanded the section is a manual `popover` instead: the top layer is
 * positioned against the viewport whatever any ancestor transforms or
 * clips, the element keeps its place in the DOM and in Angular's tree, and
 * the date menu, a popover too, still opens above it. Where the platform
 * has no popovers the fixed box remains the fallback.
 */
export class FrameFullscreen {
  readonly expanded = signal(false);
  private readonly document = inject(DOCUMENT);
  private readonly injector = inject(Injector);

  constructor(
    private readonly options: {
      /** The section that lifts — the one carrying the `popover` attribute. */
      readonly surface?: () => HTMLElement | undefined;
      readonly settled?: (expanded: boolean) => void;
    } = {},
  ) {}

  /** The top layer, entered once the attribute is rendered and left before it goes. */
  private raise(): void {
    const el = this.options.surface?.();
    if (!el || typeof el.showPopover !== 'function') return;
    if (!el.hasAttribute('popover') || el.matches(':popover-open')) return;
    try {
      el.showPopover();
    } catch {
      // Not a popover at this moment — the fixed box fallback still fills the sheet.
    }
  }

  private lower(): void {
    const el = this.options.surface?.();
    if (!el || typeof el.hidePopover !== 'function') return;
    try {
      if (el.matches(':popover-open')) el.hidePopover();
    } catch {
      // Already down.
    }
  }

  private settle(next: boolean): void {
    if (next) this.raise();
    this.options.settled?.(next);
  }

  toggle(): void {
    this.set(!this.expanded());
  }

  onEscape(event: Event): void {
    if (!this.expanded()) return;
    // A menu open inside the frame owns this Escape — the date picker, a
    // choice — and the key reaches the section only when focus sits on
    // the menu's trigger rather than inside it. Leave it to the menu.
    if (
      this.options.surface?.()?.querySelector('.ui-menu__surface[data-open]')
    ) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    this.set(false);
  }

  set(next: boolean): void {
    // A transition that waits for a render that never comes would hang the
    // page; the same state twice is no change.
    if (this.expanded() === next) return;
    const doc = this.document as Document & {
      startViewTransition?: (update: () => Promise<void>) => unknown;
    };
    const still =
      doc.defaultView?.matchMedia?.('(prefers-reduced-motion: reduce)')
        .matches ?? false;
    if (!next) this.lower();
    if (typeof doc.startViewTransition !== 'function' || still) {
      this.expanded.set(next);
      afterNextRender(() => this.settle(next), { injector: this.injector });
      return;
    }
    doc.startViewTransition(
      () =>
        new Promise<void>((resolve) => {
          this.expanded.set(next);
          afterNextRender(
            () => {
              this.settle(next);
              resolve();
            },
            { injector: this.injector },
          );
        }),
    );
  }
}
