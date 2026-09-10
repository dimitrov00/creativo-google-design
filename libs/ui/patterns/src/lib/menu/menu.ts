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
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';

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
/** The breathing room a surface keeps between itself and the viewport edge. */
const SURFACE_GUTTER_PX = 12;
/**
 * Below this, capping stops helping: a two-row menu in a 40px slot is not
 * more usable for being scrollable, it is just unreadable. The surface
 * overflows instead and the platform's own scrolling takes over.
 */
const SURFACE_MIN_BLOCK_PX = 160;
/**
 * The most of the screen a menu may take. Past this it stops reading as a
 * popover over the page and starts reading as a sheet that replaced it.
 */
const SURFACE_MAX_VIEWPORT_FRACTION = 0.55;
/** The gap between trigger and surface when the token cannot be read. */
const SURFACE_ANCHOR_GAP_PX = 8;

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
      [attr.data-open]="uiPresented() ? '' : null"
      [attr.data-placement]="resolvedPlacement()"
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
  readonly uiPlacement = input<UiMenuPlacement>('automatic');
  readonly uiAlignment = input<UiMenuAlignment>('leading');
  /** Accessible name for the menu itself — describe the thing being acted on. */
  readonly uiLabel = input('');
  readonly uiDismissed = output<void>();

  private readonly surface =
    viewChild.required<ElementRef<HTMLElement>>('surface');

  private readonly measuredPlacement = signal<'bottom' | 'top'>('bottom');
  protected readonly resolvedPlacement = computed(() => {
    const requested = this.uiPlacement();
    return requested === 'automatic' ? this.measuredPlacement() : requested;
  });

  constructor() {
    effect(() => {
      if (!isPlatformBrowser(this.platformId)) return;
      const presented = this.uiPresented();
      this.syncTriggerExpanded(presented);
      if (presented) {
        this.onOpened();
      } else {
        this.teardownOutsidePress();
        this.lower();
      }
    });
    // A menu destroyed while open (route change, *ngIf on an ancestor)
    // would otherwise leave its document listener behind and emit through
    // a dead OutputRef on the next press anywhere in the app.
    inject(DestroyRef).onDestroy(() => {
      this.teardownOutsidePress();
      this.lower();
    });
  }

  private onOpened(): void {
    // Outside press closes — the menu is a light-dismiss surface with no
    // scrim, so this listener IS the dismissal. Capture phase, so a press
    // that stops propagation still closes it.
    document.addEventListener('pointerdown', this.onDocumentPointerDown, {
      capture: true,
    });
    // THE TRIGGER TOGGLES (owner, 2026-09-09). A second press on the control
    // that opened the menu closes it — every consumer binds `(click)` to
    // `open.set(true)`, which alone could only ever re-open. Capture phase
    // on the host, so this runs before the trigger's own handler and stops
    // it there: one press, one outcome.
    this.hostRef.nativeElement.addEventListener(
      'click',
      this.onHostClickWhileOpen,
      { capture: true },
    );
    // The anchor moves when anything scrolls or the viewport changes; the
    // surface follows it (capture, so every scroller counts).
    window.addEventListener('scroll', this.onViewportMove, {
      capture: true,
      passive: true,
    });
    window.addEventListener('resize', this.onViewportMove);
    // Focus moves into the menu so Escape and the arrow keys have a home.
    // Pointer users see no ring — the items style `:focus-visible` only.
    //
    // `afterNextRender`, not `requestAnimationFrame`: the item can only
    // take focus once `data-open` has painted (a `visibility: hidden`
    // element refuses focus), and rAF is throttled in background tabs and
    // some embedded browser views — where it never fires, the menu would
    // open with focus stranded on <body> and the whole keyboard model
    // dead.
    afterNextRender(
      () => {
        /*
         * ⚠ AFTER RENDER, not inside the effect that opened the menu.
         * Measuring there read the trigger's rect before `data-open` had
         * painted and before the sheet around it had settled, which on a
         * menu deep in a scrolling sheet produced a host rect far below the
         * fold — and from it a cap of 1163px on an 812px screen. A
         * measurement of an unpainted layout is not a measurement.
         */
        this.measurePlacement();
        this.position();
        this.raise();
        this.focusItem(0);
      },
      { injector: this.injector },
    );
  }

  /*
   * THE TOP LAYER (2026-09-09).
   *
   * The surface used to be absolutely positioned inside its anchor, which
   * made it a prisoner of every stacking context and overflow clip between
   * the trigger and the page: a status menu in a raised strip painted
   * UNDER the rows that followed it, a chip's menu inside a clipping swipe
   * row opened as a sliver, and each consumer answered with a z-index of
   * its own — the exact arms race the popover API exists to end.
   *
   * The surface is a `popover="manual"` now: `showPopover()` lifts it into
   * the top layer, above everything on the page regardless of where it
   * sits in the tree, and clips and stacking contexts stop mattering. Its
   * place is measured from the trigger and written as fixed viewport
   * coordinates, kept fresh while the page underneath scrolls or resizes.
   * The trigger stays the anchor and the menu stays its DOM child — focus,
   * outside-press and Escape all still work by containment.
   *
   * Where the API is missing (jsdom, an old engine) nothing changes but the
   * coordinates: the surface is `position: fixed` either way, so it lands
   * in the same place — merely without the top layer's immunity.
   */
  private raise(): void {
    const surface = this.surface().nativeElement;
    if (typeof surface.showPopover !== 'function') return;
    try {
      if (!surface.matches(':popover-open')) surface.showPopover();
    } catch {
      /* not a popover here — the fixed coordinates still stand */
    }
  }

  private lower(): void {
    const surface = this.surface().nativeElement;
    if (typeof surface.hidePopover !== 'function') return;
    try {
      if (surface.matches(':popover-open')) surface.hidePopover();
    } catch {
      /* already down */
    }
  }

  /**
   * Fixed viewport coordinates from the trigger's rect, on the side and at
   * the alignment the menu resolved to. Runs on open and again whenever the
   * viewport moves, so a menu hanging off a row in a scrolling sheet keeps
   * hanging off it.
   */
  private position(): void {
    const surface = this.surface().nativeElement;
    const host = this.hostRef.nativeElement.getBoundingClientRect();
    const style = surface.style;
    const gap =
      Number.parseFloat(
        getComputedStyle(surface).getPropertyValue('--sys-space-tight'),
      ) || SURFACE_ANCHOR_GAP_PX;
    const viewportWidth = document.documentElement.clientWidth;
    const viewportHeight = document.documentElement.clientHeight;
    style.setProperty('--ui-menu-anchor-width', `${host.width}px`);
    if (this.resolvedPlacement() === 'top') {
      style.top = 'auto';
      style.bottom = `${viewportHeight - host.top + gap}px`;
    } else {
      style.bottom = 'auto';
      style.top = `${host.bottom + gap}px`;
    }
    switch (this.uiAlignment()) {
      case 'trailing':
        style.left = 'auto';
        style.right = `${viewportWidth - host.right}px`;
        break;
      case 'center':
        style.right = 'auto';
        style.left = `${host.left + host.width / 2}px`;
        break;
      default:
        style.right = 'auto';
        style.left = `${host.left}px`;
    }
  }

  private readonly onViewportMove = (): void => {
    this.measurePlacement();
    this.position();
  };

  /**
   * Flip above the trigger when the surface would overflow — and CAP it
   * either way.
   *
   * The surface bounded its inline size carefully and its block size not at
   * all, so a menu with more items than the viewport has room for simply
   * grew off the screen: the last services in a shop's catalogue, the last
   * chairs in a big roster, unreachable with no indication they were there.
   * Flipping alone never fixed it — a list too tall for the space below is
   * usually too tall for the space above as well.
   *
   * The cap is the REAL distance to the viewport edge on the side the menu
   * lands, less a gutter, published as `--ui-menu-max-block` for the
   * stylesheet to apply with `overflow-y`. A `vh` guess would be wrong for
   * every trigger that is not in the middle of the screen — which, for a
   * menu hanging off a row in a scrolling sheet, is all of them.
   *
   * ⚠ It runs for EVERY placement now, not only `automatic`. A menu pinned
   * to `bottom` has exactly the same problem and used to skip this method
   * on its first line.
   */
  private measurePlacement(): void {
    const host = this.hostRef.nativeElement.getBoundingClientRect();
    const surface = this.surface().nativeElement;

    // Measure the UNCAPPED height, or a menu that was capped once keeps the
    // old cap as its "needed" height and never flips back.
    surface.style.removeProperty('--ui-menu-max-block');
    const needed = surface.scrollHeight || surface.offsetHeight;

    const gutter = SURFACE_GUTTER_PX;
    const below = window.innerHeight - host.bottom - gutter;
    const above = host.top - gutter;

    if (this.uiPlacement() === 'automatic') {
      this.measuredPlacement.set(
        below < needed && above > below ? 'top' : 'bottom',
      );
    }

    const room = this.resolvedPlacement() === 'top' ? above : below;
    /*
     * FLOOR and CEILING, and both earn their place.
     *
     * The floor: a trigger pressed against the edge would otherwise cap the
     * menu to nothing at all. Below it the surface overflows its room rather
     * than becoming unreadable, which is the lesser failure.
     *
     * The ceiling: a FRACTION of the viewport, not all of it. Two jobs in
     * one number. It guards the arithmetic — `room` comes from a rect, and a
     * rect measured against a host that has moved (a sheet mid-scroll, a
     * transform in flight) can be arbitrarily large, so no menu may ever be
     * taller than the screen it is drawn on. And it is a design floor under
     * the platform's own manners: a menu is a CHOOSER, not a page. A list
     * that fills the screen has stopped being a menu and started being a
     * modal, and it buries the control it hangs off along with everything
     * else the reader was looking at.
     */
    const ceiling = Math.max(
      window.innerHeight * SURFACE_MAX_VIEWPORT_FRACTION,
      SURFACE_MIN_BLOCK_PX,
    );
    surface.style.setProperty(
      '--ui-menu-max-block',
      `${Math.min(Math.max(room, SURFACE_MIN_BLOCK_PX), ceiling)}px`,
    );
  }

  private items(): HTMLElement[] {
    return Array.from(
      this.surface().nativeElement.querySelectorAll<HTMLElement>(
        '.ui-menu__item:not([disabled])',
      ),
    );
  }

  private focusItem(index: number): void {
    const items = this.items();
    if (items.length === 0) return;
    const wrapped = (index + items.length) % items.length;
    items[wrapped]?.focus();
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
      ?.focus();
  }

  private syncTriggerExpanded(expanded: boolean): void {
    const trigger = this.hostRef.nativeElement.querySelector('[uiMenuTrigger]');
    trigger?.setAttribute('aria-expanded', String(expanded));
  }

  private readonly onDocumentPointerDown = (event: PointerEvent): void => {
    if (!this.hostRef.nativeElement.contains(event.target as Node)) {
      this.uiDismissed.emit();
    }
  };

  private readonly onHostClickWhileOpen = (event: Event): void => {
    const target = event.target as HTMLElement | null;
    if (!target?.closest('[uiMenuTrigger]')) return;
    event.stopPropagation();
    event.preventDefault();
    this.dismissToTrigger();
  };

  private teardownOutsidePress(): void {
    document.removeEventListener('pointerdown', this.onDocumentPointerDown, {
      capture: true,
    });
    this.hostRef.nativeElement.removeEventListener(
      'click',
      this.onHostClickWhileOpen,
      { capture: true },
    );
    window.removeEventListener('scroll', this.onViewportMove, {
      capture: true,
    });
    window.removeEventListener('resize', this.onViewportMove);
  }
}
