import { isPlatformBrowser } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  Directive,
  ElementRef,
  Injector,
  PLATFORM_ID,
  ViewEncapsulation,
  afterNextRender,
  effect,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import {
  type MenuBox,
  type MenuSide,
  resolveMenuGeometry,
} from './menu-geometry';

export type UiMenuPlacement = 'automatic' | 'bottom' | 'top';
export type UiMenuAlignment = 'leading' | 'trailing' | 'center';
export type UiMenuItemRole = 'default' | 'destructive';

/**
 * The control that opens a `ui-menu` — projected into the menu's trigger
 * slot so the surface can anchor to it. Stamps the APG menu-button
 * relationship (`aria-haspopup` / `aria-expanded`); the consumer keeps
 * ownership of the control's own look and its `(click)`.
 */
@Directive({
  selector: '[uiMenuTrigger]',
  host: {
    'aria-haspopup': 'menu',
    '[attr.aria-expanded]': 'expanded()',
  },
})
export class UiMenuTrigger {
  /** Set by the parent `ui-menu` — consumers never bind this. */
  readonly expanded = signal(false);
}

/**
 * One action inside a `ui-menu`. A `button` or an `a`, or a `label` when
 * the action is "open a file picker" (the label form is the only way to
 * reach a hidden `<input type="file">` without scripting a click).
 */
@Directive({
  selector:
    'button[uiMenuItem], a[uiMenuItem], label[uiMenuItem], [uiMenuItem]',
  host: {
    class: 'ui-menu__item',
    '[attr.role]': "uiSelected() === undefined ? 'menuitem' : 'menuitemradio'",
    '[attr.aria-checked]': 'uiSelected() ?? null',
    '[attr.data-role]': 'uiMenuItemRole()',
    '[attr.tabindex]': '-1',
  },
})
export class UiMenuItem {
  /** `destructive` paints the item red and, by HIG convention, belongs LAST in the menu. */
  readonly uiMenuItemRole = input<UiMenuItemRole>('default');

  /**
   * Present ⇒ this item is one OPTION in a single-select menu rather than a
   * command, and the role changes with it (`menuitemradio` + `aria-checked`,
   * which is what a menu expressing a choice owes assistive tech).
   *
   * The visual selection is not this directive's job: a picker puts
   * `uiListRow` on its items and gets the app's one selected-row treatment,
   * the same one the location step uses.
   */
  readonly uiSelected = input<boolean | undefined>(undefined);
  readonly element = inject<ElementRef<HTMLElement>>(ElementRef);
}

/**
 * ≙ SwiftUI `Menu { … } label: { … }` / UIKit `UIMenu` — the anchored
 * action list HIG reaches for by default (WWDC20 "Design with iOS pickers,
 * menus and actions"): it opens NEXT TO the control that summoned it,
 * doesn't dim the background, and closes on any outside press. Action
 * sheets are the other tool, reserved for destructive confirmations where
 * the finger-travel friction is the whole point — a menu is not that.
 *
 * Composition — trigger and items are both projected, so the menu owns the
 * anchoring, the surface and the keyboard model while the consumer keeps
 * its own control:
 *
 * ```html
 * <ui-menu [uiPresented]="open()" (uiDismissed)="open.set(false)">
 *   <button uiMenuTrigger uiButton (click)="open.set(true)">Edit</button>
 *   <button uiMenuItem (click)="choose()">Choose photo</button>
 *   <button uiMenuItem uiMenuItemRole="destructive" (click)="remove()">
 *     Remove photo
 *   </button>
 * </ui-menu>
 * ```
 *
 * The surface stays MOUNTED and hidden rather than being unmounted, so
 * both the entrance and the exit ride one CSS transition with no
 * open/closing dance in consumers (`visibility: hidden` also takes the
 * items out of the tab order while closed).
 */
/** The breathing room a surface keeps between itself and the window's edge. */
const SURFACE_GUTTER_PX = 12;
/**
 * Below this, capping stops helping: a two-row menu in a 40px slot is not
 * more usable for being scrollable, it is just unreadable. The surface
 * keeps this much and slides into the window instead.
 */
const SURFACE_MIN_BLOCK_PX = 160;
/**
 * The most of the screen a menu may take. Past this it stops reading as a
 * popover over the page and starts reading as a sheet that replaced it.
 */
const SURFACE_MAX_VIEWPORT_FRACTION = 0.55;
/** The gap between trigger and surface when the token cannot be read. */
const SURFACE_ANCHOR_GAP_PX = 4;
/** How long the exit fade is given before the surface leaves the top layer, when the token cannot be read. */
const SURFACE_EXIT_MS = 150;

@Component({
  selector: 'ui-menu',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ng-content select="[uiMenuTrigger]" />
    <div
      #surface
      class="ui-menu__surface"
      role="menu"
      tabindex="-1"
      popover="manual"
      [attr.aria-label]="uiLabel() || null"
      [attr.data-alignment]="uiAlignment()"
      (keydown)="onKeydown($event)"
      (click)="onSurfaceClick($event)"
    >
      <ng-content />
    </div>
  `,
  styleUrl: './menu.css',
  // Unscoped: bare `.ui-*`/`[data-*]` selectors never match a component's
  // own host under emulated encapsulation, and the global `.ui-*` cascade
  // IS this system's styling contract (§3.1).
  encapsulation: ViewEncapsulation.None,
  host: {
    '(keydown)': 'onHostKeydown($event)',
    class: 'ui-menu',
    '[attr.data-open]': "uiPresented() ? '' : null",
  },
})
export class UiMenu {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly hostRef = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);

  readonly uiPresented = input(false);
  /** `automatic` flips above the trigger when the surface wouldn't fit below. */
  readonly uiPlacement = input<'automatic' | MenuSide>('automatic');
  readonly uiAlignment = input<UiMenuAlignment>('leading');
  /** Accessible name for the menu itself — describe the thing being acted on. */
  readonly uiLabel = input('');
  readonly uiDismissed = output<void>();

  private readonly surface =
    viewChild.required<ElementRef<HTMLElement>>('surface');

  /*
   * THE PRESENTATION'S OWN STATE — plain fields, not signals: none of it is
   * rendered by the template. It is written by the component's own
   * measuring and read back by the frame loop, and a signal here would
   * invite a reader to depend on it.
   */
  /** The side chosen for THIS presentation; `null` between presentations. */
  private side: MenuSide | null = null;
  /** The surface's natural size — measured on open and whenever its content or the window changes. */
  private natural = { width: 0, height: 0 };
  /** What the last placement was computed from, so a frame that moved nothing writes nothing. */
  private placedFrom = '';
  private frame: number | null = null;
  /** The anchor gap and the safe areas, read once per measure — not per frame. */
  private gapPx = SURFACE_ANCHOR_GAP_PX;
  private safe = { top: 0, right: 0, bottom: 0, left: 0 };
  private contentObserver: ResizeObserver | null = null;
  private lowerTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly onExitEnd = (event: TransitionEvent): void => {
    if (event.propertyName === 'opacity') this.lowerNow();
  };

  constructor() {
    effect(() => {
      if (!isPlatformBrowser(this.platformId)) return;
      const presented = this.uiPresented();
      this.syncTriggerExpanded(presented);
      if (presented) {
        this.onOpened();
      } else {
        this.onClosed();
      }
    });
    // A menu destroyed while open (route change, *ngIf on an ancestor)
    // would otherwise leave its document listeners behind and emit through
    // a dead OutputRef on the next press anywhere in the app.
    inject(DestroyRef).onDestroy(() => {
      this.onClosed();
      this.lowerNow();
    });
  }

  /*
   * ── THE PRESENTATION ─────────────────────────────────────────────────
   *
   * ### The top layer (2026-09-09), and the order things happen in (2026-09-11)
   * The surface used to be absolutely positioned inside its anchor, which
   * made it a prisoner of every stacking context and overflow clip between
   * the trigger and the page — the exact arms race the popover API exists
   * to end. It is a `popover="manual"`: `showPopover()` lifts it into the
   * top layer, above everything regardless of where it sits in the tree.
   *
   * It is raised FIRST, then measured, then placed, and only then revealed.
   * The earlier order — reveal by binding, then measure, then raise — meant
   * the entrance transition began inside the sheet's own stacking context
   * (a `transform`ed ancestor makes `position: fixed` mean "fixed to me")
   * and the element was promoted to the top layer mid-fade: on a phone that
   * read as a flash at the wrong place. Now nothing is seen until it is in
   * its final layer at its final coordinates.
   *
   * ### One side per presentation, and following, not re-deciding
   * The side (below or above) is chosen once, on open, from the surface's
   * natural size and the reachable window, and kept while it serves — it
   * is re-decided only when the window itself changes (a keyboard, a
   * rotation, a toolbar collapsing) and the surface no longer fits. What
   * happens EVERY frame is cheaper and quieter: one read of the anchor's
   * box, and a write of the surface's coordinates if it moved. That is how
   * a menu hangs off a row in a sheet that is still sliding in, or being
   * dragged, or scrolled by something other than a finger, without
   * jumping from under its trigger to over it as the toolbar collapses.
   *
   * ### The reachable window
   * Coordinates are clamped inside the VISUAL viewport less the safe areas
   * — not `innerHeight`, which on a phone includes what a keyboard covers
   * and what a notch hides. A menu opened beside a field that raises the
   * keyboard is pushed up into view rather than left under the keys.
   *
   * ### Modal to the page behind it
   * A menu on the platform is modal: the content behind it does not scroll
   * while it is open, and the touch that dismisses it goes to nothing else.
   * A touch outside the menu is swallowed here (which is also what dismisses
   * it, through the pointer event that precedes it), and so is a wheel.
   * Without that, the first touch outside both closed the menu and scrolled
   * the sheet under it, so the trigger slid away from the fading surface.
   */
  private onOpened(): void {
    // A re-open during the exit fade: the surface is still in the top layer.
    this.cancelLower();
    this.listen();
    // `afterNextRender`, not `requestAnimationFrame`: the surface can only
    // be measured once its content has rendered, and rAF is throttled in
    // background tabs and some embedded browser views — where it never
    // fires, the menu would open with focus stranded on <body> and the
    // whole keyboard model dead.
    afterNextRender(
      () => {
        if (!this.uiPresented()) return;
        this.raise();
        this.remeasure();
        this.reveal();
        this.focusItem(0);
        this.follow();
      },
      { injector: this.injector },
    );
  }

  private onClosed(): void {
    this.unlisten();
    this.stopFollowing();
    this.conceal();
    this.side = null;
    this.placedFrom = '';
  }

  private raise(): void {
    const surface = this.surface().nativeElement;
    if (typeof surface.showPopover !== 'function') return;
    try {
      if (!this.raised()) surface.showPopover();
    } catch {
      /* not a popover here — the fixed coordinates still stand */
    }
  }

  /** Whether the surface is in the top layer — false where the API is missing. */
  private raised(): boolean {
    try {
      return this.surface().nativeElement.matches(':popover-open');
    } catch {
      return false;
    }
  }

  /**
   * Out of the top layer — AFTER the exit fade. Lowering at once (the
   * earlier behaviour, relying on `transition: overlay` where an engine
   * supports it) dropped the surface back into the sheet's stacking context
   * for the length of its fade: on engines without discrete `overlay`
   * transitions it jumped to wherever `position: fixed` meant inside the
   * transformed sheet and faded out there.
   */
  private lowerLater(): void {
    if (!this.raised()) return;
    this.cancelLower();
    const surface = this.surface().nativeElement;
    surface.addEventListener('transitionend', this.onExitEnd);
    this.lowerTimer = setTimeout(
      () => this.lowerNow(),
      this.motionMs('--sys-motion-duration-instant', SURFACE_EXIT_MS) + 50,
    );
  }

  private lowerNow(): void {
    this.cancelLower();
    const surface = this.surface().nativeElement;
    if (typeof surface.hidePopover !== 'function') return;
    try {
      if (this.raised()) surface.hidePopover();
    } catch {
      /* already down */
    }
  }

  private cancelLower(): void {
    if (this.lowerTimer !== null) clearTimeout(this.lowerTimer);
    this.lowerTimer = null;
    this.surface().nativeElement.removeEventListener(
      'transitionend',
      this.onExitEnd,
    );
  }

  /** The entrance begins here — after the surface is raised, measured and placed. */
  private reveal(): void {
    this.surface().nativeElement.setAttribute('data-open', '');
  }

  private conceal(): void {
    const surface = this.surface().nativeElement;
    if (!surface.hasAttribute('data-open')) {
      this.lowerNow();
      return;
    }
    surface.removeAttribute('data-open');
    this.lowerLater();
  }

  /*
   * ── MEASURING AND PLACING ────────────────────────────────────────────
   */

  /**
   * The surface's natural size and the anchor's width, then a placement.
   *
   * Run on open and whenever the surface's content or the window changes —
   * never per frame, because reading `scrollHeight` after resetting the
   * cap forces a layout, and a layout per scroll event is the jank that
   * was mistaken for "the menu moving around".
   */
  private remeasure(): void {
    const surface = this.surface().nativeElement;
    const style = surface.style;
    this.gapPx = this.tokenPx('--sys-space-tight', SURFACE_ANCHOR_GAP_PX);
    this.safe = {
      top: this.tokenPx('--ui-menu-safe-top', 0),
      right: this.tokenPx('--ui-menu-safe-right', 0),
      bottom: this.tokenPx('--ui-menu-safe-bottom', 0),
      left: this.tokenPx('--ui-menu-safe-left', 0),
    };
    const window = this.reachableWindow();
    style.setProperty(
      '--ui-menu-window-inline',
      `${Math.max(0, window.width - 2 * SURFACE_GUTTER_PX)}px`,
    );
    style.setProperty('--ui-menu-anchor-width', `${this.anchorBox().width}px`);
    // The NATURAL size: the border box with the cap lifted, or a menu capped
    // once would report the cap as its need and never earn its room back.
    style.removeProperty('--ui-menu-max-block');
    this.natural = {
      width: surface.offsetWidth,
      height: surface.offsetHeight || surface.scrollHeight,
    };
    this.placedFrom = '';
    this.place();
  }

  /**
   * Coordinates from the anchor's box and the reachable window, written only
   * when either has moved. Cheap enough to run every frame while open.
   */
  private place(): void {
    const anchor = this.anchorBox();
    const window = this.reachableWindow();
    const from = [
      anchor.top,
      anchor.left,
      anchor.width,
      anchor.height,
      window.top,
      window.left,
      window.width,
      window.height,
    ].join('|');
    if (from === this.placedFrom) return;
    this.placedFrom = from;

    const geometry = resolveMenuGeometry({
      anchor,
      surface: this.natural,
      window,
      placement: this.uiPlacement(),
      alignment: this.uiAlignment(),
      current: this.side,
      gap: this.gapPx,
      gutter: SURFACE_GUTTER_PX,
      minBlock: SURFACE_MIN_BLOCK_PX,
      maxFraction: SURFACE_MAX_VIEWPORT_FRACTION,
    });
    this.side = geometry.side;

    const surface = this.surface().nativeElement;
    const offset = this.containingBlockOffset();
    const style = surface.style;
    surface.setAttribute('data-placement', geometry.side);
    style.setProperty('--ui-menu-max-block', `${geometry.maxBlock}px`);
    style.right = 'auto';
    style.bottom = 'auto';
    style.top = `${geometry.top - offset.top}px`;
    style.left = `${geometry.left - offset.left}px`;
  }

  /** One read per frame; a write only when the anchor or the window moved. */
  private follow(): void {
    if (typeof requestAnimationFrame !== 'function') return;
    this.stopFollowing();
    const tick = (): void => {
      if (!this.uiPresented()) {
        this.frame = null;
        return;
      }
      this.place();
      this.frame = requestAnimationFrame(tick);
    };
    this.frame = requestAnimationFrame(tick);
  }

  private stopFollowing(): void {
    if (this.frame !== null && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(this.frame);
    }
    this.frame = null;
  }

  private anchorBox(): MenuBox {
    const rect = this.hostRef.nativeElement.getBoundingClientRect();
    return {
      top: rect.top,
      left: rect.left,
      width: rect.width,
      height: rect.height,
    };
  }

  /**
   * The part of the viewport a finger can reach: the VISUAL viewport (which
   * a keyboard shrinks and a zoom pans, while `innerHeight` says nothing of
   * either), less the safe areas the stylesheet resolves from `env()`.
   */
  private reachableWindow(): MenuBox {
    const safe = this.safe;
    const visual = window.visualViewport;
    const base =
      visual && visual.width > 0 && visual.height > 0
        ? {
            top: visual.offsetTop,
            left: visual.offsetLeft,
            width: visual.width,
            height: visual.height,
          }
        : {
            top: 0,
            left: 0,
            width: window.innerWidth,
            height: window.innerHeight,
          };
    return {
      top: base.top + safe.top,
      left: base.left + safe.left,
      width: Math.max(0, base.width - safe.left - safe.right),
      height: Math.max(0, base.height - safe.top - safe.bottom),
    };
  }

  /**
   * Where `top: 0` actually is for this surface.
   *
   * In the top layer that is the viewport, and the answer is zero. Where the
   * popover API is missing (an older engine) the surface is a plain
   * `position: fixed` box, and a `transform`, `filter` or `contain` on any
   * ancestor — the sheet's slide-in transform, for one — makes that
   * ancestor its containing block: coordinates measured from the viewport
   * must have that ancestor's own offset taken off, or the menu lands a
   * sheet's height away from its trigger.
   */
  private containingBlockOffset(): { top: number; left: number } {
    if (this.raised()) return { top: 0, left: 0 };
    let ancestor = this.surface().nativeElement.parentElement;
    while (ancestor && ancestor !== document.documentElement) {
      if (establishesFixedContainingBlock(ancestor)) {
        const rect = ancestor.getBoundingClientRect();
        return {
          top: rect.top + ancestor.clientTop,
          left: rect.left + ancestor.clientLeft,
        };
      }
      ancestor = ancestor.parentElement;
    }
    return { top: 0, left: 0 };
  }

  /** A length token off the surface's computed style, in px, or the fallback. */
  private tokenPx(property: string, fallback: number): number {
    const raw = getComputedStyle(this.surface().nativeElement).getPropertyValue(
      property,
    );
    const value = Number.parseFloat(raw);
    return Number.isFinite(value) ? value : fallback;
  }

  /** A duration token off the surface's computed style, in ms, or the fallback. */
  private motionMs(property: string, fallback: number): number {
    const raw = getComputedStyle(this.surface().nativeElement)
      .getPropertyValue(property)
      .trim();
    const value = Number.parseFloat(raw);
    if (!Number.isFinite(value)) return fallback;
    return raw.endsWith('ms') ? value : value * 1000;
  }

  /*
   * ── LISTENING ────────────────────────────────────────────────────────
   */

  private listen(): void {
    const host = this.hostRef.nativeElement;
    // Outside press closes — the menu is a light-dismiss surface with no
    // scrim, so this listener IS the dismissal. Capture phase, so a press
    // that stops propagation still closes it.
    document.addEventListener('pointerdown', this.onDocumentPointerDown, {
      capture: true,
    });
    // …and the TOUCH that pressed goes nowhere else: no scroll of what is
    // behind, no tap on whatever the menu was over. `passive: false` is
    // what lets it be cancelled at all.
    document.addEventListener('touchstart', this.onDocumentTouchStart, {
      capture: true,
      passive: false,
    });
    document.addEventListener('wheel', this.onDocumentWheel, {
      capture: true,
      passive: false,
    });
    // THE TRIGGER TOGGLES (owner, 2026-09-09). A second press on the control
    // that opened the menu closes it — every consumer binds `(click)` to
    // `open.set(true)`, which alone could only ever re-open. Capture phase
    // on the host, so this runs before the trigger's own handler and stops
    // it there: one press, one outcome.
    host.addEventListener('click', this.onHostClickWhileOpen, {
      capture: true,
    });
    // The WINDOW changes — a rotation, a keyboard, a toolbar collapsing —
    // are the one thing that may re-decide the side. Scrolling is not
    // listened for: it cannot happen behind an open menu, and what moves
    // the anchor otherwise is caught by the frame loop.
    window.addEventListener('resize', this.onWindowChange);
    window.visualViewport?.addEventListener('resize', this.onWindowChange);
    window.visualViewport?.addEventListener('scroll', this.onWindowChange);
    // The surface's own content changing size — a note appearing under a
    // field, a filtered list — re-measures, so a menu growing upward keeps
    // its bottom edge on the anchor.
    if (typeof ResizeObserver === 'function') {
      this.contentObserver = new ResizeObserver(() => {
        if (
          this.uiPresented() &&
          this.surface().nativeElement.hasAttribute('data-open')
        ) {
          this.remeasure();
        }
      });
      this.contentObserver.observe(this.surface().nativeElement);
    }
  }

  private unlisten(): void {
    const host = this.hostRef.nativeElement;
    document.removeEventListener('pointerdown', this.onDocumentPointerDown, {
      capture: true,
    });
    document.removeEventListener('touchstart', this.onDocumentTouchStart, {
      capture: true,
    });
    document.removeEventListener('wheel', this.onDocumentWheel, {
      capture: true,
    });
    host.removeEventListener('click', this.onHostClickWhileOpen, {
      capture: true,
    });
    window.removeEventListener('resize', this.onWindowChange);
    window.visualViewport?.removeEventListener('resize', this.onWindowChange);
    window.visualViewport?.removeEventListener('scroll', this.onWindowChange);
    this.contentObserver?.disconnect();
    this.contentObserver = null;
  }

  private readonly onWindowChange = (): void => {
    if (!this.uiPresented()) return;
    this.remeasure();
  };

  private readonly onDocumentPointerDown = (event: PointerEvent): void => {
    if (!this.hostRef.nativeElement.contains(event.target as Node)) {
      this.uiDismissed.emit();
    }
  };

  private readonly onDocumentTouchStart = (event: Event): void => {
    if (this.hostRef.nativeElement.contains(event.target as Node)) return;
    if (event.cancelable) event.preventDefault();
  };

  private readonly onDocumentWheel = (event: Event): void => {
    if (this.surface().nativeElement.contains(event.target as Node)) return;
    if (event.cancelable) event.preventDefault();
  };

  private readonly onHostClickWhileOpen = (event: Event): void => {
    const target = event.target as HTMLElement | null;
    if (!target?.closest('[uiMenuTrigger]')) return;
    event.stopPropagation();
    event.preventDefault();
    this.dismissToTrigger();
  };

  /*
   * ── THE KEYBOARD MODEL ───────────────────────────────────────────────
   */

  private items(): HTMLElement[] {
    return Array.from(
      this.surface().nativeElement.querySelectorAll<HTMLElement>(
        '.ui-menu__item:not([disabled])',
      ),
    );
  }

  /**
   * Focus moves into the menu so Escape and the arrow keys have a home.
   * Pointer users see no ring — the items style `:focus-visible` only.
   * `preventScroll`: the surface is already where it should be, and a
   * focus that scrolls "into view" scrolled the sheet under the menu.
   */
  private focusItem(index: number): void {
    const items = this.items();
    if (items.length === 0) return;
    const wrapped = (index + items.length) % items.length;
    items[wrapped]?.focus({ preventScroll: true });
  }

  private activeIndex(): number {
    const items = this.items();
    return items.indexOf(document.activeElement as HTMLElement);
  }

  protected onKeydown(event: KeyboardEvent): void {
    switch (event.key) {
      case 'Escape':
        event.preventDefault();
        // The menu is the topmost transient thing: Escape closes IT, and
        // must not travel on to a sheet or dialog around it, which would
        // dismiss on the same press (staff visit sheet, 2026-09-09).
        event.stopPropagation();
        this.dismissToTrigger();
        return;
      case 'ArrowDown':
        event.preventDefault();
        this.focusItem(this.activeIndex() + 1);
        return;
      case 'ArrowUp':
        event.preventDefault();
        this.focusItem(this.activeIndex() - 1);
        return;
      case 'Home':
        event.preventDefault();
        this.focusItem(0);
        return;
      case 'End':
        event.preventDefault();
        this.focusItem(this.items().length - 1);
        return;
      case 'Tab':
        // Tabbing out light-dismisses (APG) — the focus move itself is the
        // user's intent, so it is not prevented.
        this.uiDismissed.emit();
        return;
      default:
        return;
    }
  }

  /**
   * Escape on the TRIGGER, while open. A surface that holds nothing to
   * focus — a calendar, a search — leaves focus on the trigger, and the
   * surface's own handler never sees the key: it went on to the sheet
   * around the menu and closed THAT instead (2026-09-10). The host sits
   * above trigger and surface alike, so it closes the menu and keeps the
   * press to itself, exactly as the surface does. A press inside the
   * surface never gets here — the surface stops it first.
   */
  protected onHostKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Escape' || !this.uiPresented()) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest('.ui-menu__surface')) return;
    event.preventDefault();
    event.stopPropagation();
    this.dismissToTrigger();
  }

  /** Choosing an action closes the menu — every item is a one-shot command. */
  protected onSurfaceClick(event: Event): void {
    const target = event.target as HTMLElement | null;
    if (target?.closest('.ui-menu__item')) this.dismissToTrigger();
  }

  private dismissToTrigger(): void {
    this.uiDismissed.emit();
    if (!isPlatformBrowser(this.platformId)) return;
    // Focus returns to the control that opened the menu (APG) — otherwise
    // it would land on <body> and the keyboard user loses their place.
    this.hostRef.nativeElement
      .querySelector<HTMLElement>('[uiMenuTrigger]')
      ?.focus({ preventScroll: true });
  }

  private syncTriggerExpanded(expanded: boolean): void {
    const trigger = this.hostRef.nativeElement.querySelector('[uiMenuTrigger]');
    trigger?.setAttribute('aria-expanded', String(expanded));
  }
}

/**
 * Does this element make `position: fixed` descendants fixed to IT rather
 * than to the viewport? The properties the spec lists — a transform, a
 * perspective, a filter (backdrop included), a `will-change` naming any of
 * them, or layout/paint containment. Only consulted when the surface could
 * not be raised into the top layer, where none of this matters.
 */
function establishesFixedContainingBlock(element: Element): boolean {
  const style = getComputedStyle(element);
  const read = (property: string): string =>
    style.getPropertyValue(property).trim();
  const none = (value: string): boolean => value === '' || value === 'none';
  return (
    !none(read('transform')) ||
    !none(read('perspective')) ||
    !none(read('filter')) ||
    !none(read('backdrop-filter')) ||
    !none(read('-webkit-backdrop-filter')) ||
    /transform|perspective|filter/.test(read('will-change')) ||
    /layout|paint|strict|content/.test(read('contain'))
  );
}
