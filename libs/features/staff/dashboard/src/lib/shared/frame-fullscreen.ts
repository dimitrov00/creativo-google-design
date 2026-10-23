import { type Signal, Injector, inject, signal } from '@angular/core';
import { runViewTransition } from './view-transition';

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
 * A plain object made by a factory in a field initialiser — Angular's
 * `inject*` idiom: `inject()` still resolves there, so the editor that owns
 * it need not thread a document through. Called anywhere else it throws
 * (no injection context), which is why both call sites stay field
 * initialisers.
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
export type FrameFullscreenOptions = {
  /** The section that lifts — the one carrying the `popover` attribute. */
  readonly surface?: () => HTMLElement | undefined;
  readonly settled?: (expanded: boolean) => void;
};

export type FrameFullscreen = {
  readonly expanded: Signal<boolean>;
  readonly toggle: () => void;
  readonly onEscape: (event: Event) => void;
  readonly set: (next: boolean) => void;
};

/** Must run in an injection context — a component FIELD INITIALISER. */
export function injectFrameFullscreen(
  options: FrameFullscreenOptions = {},
): FrameFullscreen {
  const expanded = signal(false);
  const injector = inject(Injector);

  /** The top layer, entered once the attribute is rendered and left before it goes. */
  function raise(): void {
    const el = options.surface?.();
    if (!el || typeof el.showPopover !== 'function') return;
    if (!el.hasAttribute('popover') || el.matches(':popover-open')) return;
    try {
      el.showPopover();
    } catch {
      // Not a popover at this moment — the fixed box fallback still fills the sheet.
    }
  }

  function lower(): void {
    const el = options.surface?.();
    if (!el || typeof el.hidePopover !== 'function') return;
    try {
      if (el.matches(':popover-open')) el.hidePopover();
    } catch {
      // Already down.
    }
  }

  function settle(next: boolean): void {
    if (next) raise();
    options.settled?.(next);
  }

  function set(next: boolean): void {
    // A transition that waits for a render that never comes would hang the
    // page; the same state twice is no change.
    if (expanded() === next) return;
    if (!next) lower();
    // The platform's transition, or a plain switch where there is none or
    // motion is reduced — the shared recipe (`shared/view-transition.ts`),
    // which the schedule's view switch runs through as well.
    runViewTransition(
      () => expanded.set(next),
      injector,
      () => settle(next),
    );
  }

  function toggle(): void {
    set(!expanded());
  }

  function onEscape(event: Event): void {
    if (!expanded()) return;
    // A menu open inside the frame owns this Escape — the date picker, a
    // choice — and the key reaches the section only when focus sits on
    // the menu's trigger rather than inside it. Leave it to the menu.
    if (options.surface?.()?.querySelector('.ui-menu__surface[data-open]')) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    set(false);
  }

  return { expanded: expanded.asReadonly(), toggle, onEscape, set };
}
