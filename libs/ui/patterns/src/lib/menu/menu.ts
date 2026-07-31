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
      }
    });
    // A menu destroyed while open (route change, *ngIf on an ancestor)
    // would otherwise leave its document listener behind and emit through
    // a dead OutputRef on the next press anywhere in the app.
    inject(DestroyRef).onDestroy(() => this.teardownOutsidePress());
  }

  private onOpened(): void {
    this.measurePlacement();
    // Outside press closes — the menu is a light-dismiss surface with no
    // scrim, so this listener IS the dismissal. Capture phase, so a press
    // that stops propagation still closes it.
    document.addEventListener('pointerdown', this.onDocumentPointerDown, {
      capture: true,
    });
    // Focus moves into the menu so Escape and the arrow keys have a home.
    // Pointer users see no ring — the items style `:focus-visible` only.
    //
    // `afterNextRender`, not `requestAnimationFrame`: the item can only
    // take focus once `data-open` has painted (a `visibility: hidden`
    // element refuses focus), and rAF is throttled in background tabs and
    // some embedded browser views — where it never fires, the menu would
    // open with focus stranded on <body> and the whole keyboard model
    // dead.
    afterNextRender(() => this.focusItem(0), { injector: this.injector });
  }

  /** Flip above the trigger when the surface would overflow the viewport. */
  private measurePlacement(): void {
    if (this.uiPlacement() !== 'automatic') return;
    const host = this.hostRef.nativeElement.getBoundingClientRect();
    const surface = this.surface().nativeElement;
    const needed = surface.offsetHeight || surface.scrollHeight;
    const below = window.innerHeight - host.bottom;
    this.measuredPlacement.set(
      below < needed && host.top > needed ? 'top' : 'bottom',
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

  private teardownOutsidePress(): void {
    document.removeEventListener('pointerdown', this.onDocumentPointerDown, {
      capture: true,
    });
  }
}
