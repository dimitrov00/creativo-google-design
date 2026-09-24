import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import {
  DestroyRef,
  Directive,
  ElementRef,
  PLATFORM_ID,
  Signal,
  effect,
  inject,
  output,
  signal,
} from '@angular/core';

/** Emitted on every scroll of the sheet's configured scroller. */
export interface UiSheetScrollEvent {
  readonly scroller: HTMLElement;
  /** 0 → top, 1 → fully scrolled. */
  readonly progress: number;
}

/**
 * Wiring passed by the owning sheet component via {@link UiSheetBehavior.connect}.
 * All selectors are resolved inside the host element; `inertSelectors` are
 * resolved against the document (background chrome to freeze while modal).
 */
export interface UiSheetBehaviorOptions {
  /** The sheet is open (drives environment activation + initial focus). */
  readonly open: Signal<boolean>;
  /** The sheet is playing its exit transition (environment stays active). */
  readonly closing?: Signal<boolean>;
  /** Element that carries the live drag-offset custom property. */
  readonly dialogSelector?: string;
  /** Scroller reset to the top on each open; source of scroll progress. */
  readonly scrollerSelector?: string;
  /** Element focused when the sheet opens. */
  readonly initialFocusSelector?: string;
  /** Document-level background chrome made `inert` while the sheet is up. */
  readonly inertSelectors?: readonly string[];
  /**
   * Chrome that stays LIVE inside an inert target — e.g. a header whose
   * trigger doubles as the sheet's ✕ close. Exempt subtrees are never
   * inerted; targets containing them are frozen child-by-child around
   * them (same walk as around the sheet itself).
   */
  readonly inertExemptSelectors?: readonly string[];
  /** Name of the CSS custom property carrying the drag offset (px). */
  readonly dragVar?: string;
  /** Media query gating drag-to-dismiss (default: the mobile bottom
   *  sheet, `(max-width: 760px)`) — centered desktop dialogs don't drag. */
  readonly dragMedia?: string;
  /**
   * Lock the document's scroll while the sheet is up (the default). A sheet
   * presented INSIDE another sheet — a card over the visit editor — leaves
   * the lock to its host: two locks restoring one `body` in any order would
   * hand the page back frozen, or unfreeze it under the host. Read at
   * activation, so a sheet that learns where it stands once the tree is
   * built may answer then.
   */
  readonly lockScroll?: boolean | (() => boolean);
}

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * The modal-sheet behavior contract, extracted from the landing's
 * `cr-modal-sheet` so every sheet surface shares one implementation:
 * body scroll lock, focus capture/trap/restore, Escape + backdrop
 * dismissal, drag-to-dismiss via pointer events, background `inert`
 * management and scroll-progress emission.
 *
 * Purely imperative — no host bindings of its own. The owning component
 * applies it via `hostDirectives`, calls {@link connect} in its
 * constructor, and delegates the relevant DOM events to the `on*`
 * methods from wherever its template attaches them (backdrop, dialog,
 * drag handle, scroller). Dismissal is *requested*, never performed:
 * `uiSheetDismissed` fires and the owner flips its own open state.
 */
@Directive({
  selector: '[uiSheetBehavior]',
  exportAs: 'uiSheetBehavior',
})
export class UiSheetBehavior {
  private readonly document = inject(DOCUMENT);
  private readonly elementRef = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly destroyRef = inject(DestroyRef);

  private readonly options = signal<UiSheetBehaviorOptions | null>(null);
  private previousBodyOverflow = '';
  private previousBodyPaddingRight = '';
  private scrollLocked = false;
  private inertedElements: HTMLElement[] = [];
  private previousFocus: HTMLElement | null = null;
  private environmentActive = false;
  private wasOpen = false;
  private dragPointerId: number | null = null;
  private dragStartY = 0;
  private dragStartTime = 0;
  private dragOffset = 0;

  /** The user asked to close (Escape, backdrop, drag past threshold, close control). */
  readonly uiSheetDismissed = output<void>();
  /** Scroll progress of the configured scroller (see {@link onScroll}). */
  readonly uiSheetScrolled = output<UiSheetScrollEvent>();
  private readonly draggingState = signal(false);
  /** True while a drag-to-dismiss gesture is in flight. */
  readonly dragging = this.draggingState.asReadonly();

  constructor() {
    effect(() => {
      const options = this.options();
      if (!options) return;
      const open = options.open();
      const active = open || (options.closing?.() ?? false);
      if (!isPlatformBrowser(this.platformId)) return;

      if (active && !this.environmentActive) this.activateEnvironment(options);
      if (open && !this.wasOpen) {
        requestAnimationFrame(() => {
          const host = this.elementRef.nativeElement;
          if (options.scrollerSelector) {
            const scroller = host.querySelector<HTMLElement>(
              options.scrollerSelector,
            );
            if (scroller) scroller.scrollTop = 0;
          }
          if (options.initialFocusSelector) {
            host
              .querySelector<HTMLElement>(options.initialFocusSelector)
              ?.focus();
          }
        });
      }
      if (!active && this.environmentActive) this.deactivateEnvironment();
      this.wasOpen = open;
    });

    this.destroyRef.onDestroy(() => {
      if (isPlatformBrowser(this.platformId)) this.deactivateEnvironment();
    });
  }

  /**
   * Hand the directive its state + DOM wiring. Call once from the owning
   * component's constructor; the behavior is inert until connected.
   */
  connect(options: UiSheetBehaviorOptions): void {
    this.options.set(options);
  }

  /** Emit `uiSheetDismissed` unless the sheet is closed or already closing. */
  requestDismiss(): void {
    const options = this.options();
    if (!options || !options.open() || (options.closing?.() ?? false)) return;
    this.uiSheetDismissed.emit();
  }

  private backdropPressArmed = false;

  /** Attach to the backdrop element: arms a dismiss on a direct press.
   *  Dismissal fires on the paired pointerup (also on the backdrop) — a
   *  stray touch that lands on the backdrop but slides onto the sheet no
   *  longer closes it. */
  onBackdropPointerDown(event: PointerEvent): void {
    this.backdropPressArmed = event.target === event.currentTarget;
  }

  /** Attach to the backdrop element's `(pointerup)`. */
  onBackdropPointerUp(event: PointerEvent): void {
    const armed = this.backdropPressArmed;
    this.backdropPressArmed = false;
    if (armed && event.target === event.currentTarget) this.requestDismiss();
  }

  /** Attach to the scroller's `(scroll)`: emits normalized progress. */
  onScroll(event: Event): void {
    const scroller = event.currentTarget as HTMLElement;
    const scrollable = Math.max(
      1,
      scroller.scrollHeight - scroller.clientHeight,
    );
    this.uiSheetScrolled.emit({
      scroller,
      progress: Math.min(1, Math.max(0, scroller.scrollTop / scrollable)),
    });
  }

  /**
   * Attach to the dialog's `(keydown)`: Escape dismisses, Tab is trapped —
   * and both STOP HERE. A sheet stacked inside another sheet's surface is
   * inside its DOM too: an Escape that went on bubbling would close both,
   * and a Tab the inner trap did not wrap would be wrapped by the outer's
   * — out of the dialog that has the focus.
   */
  onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      this.requestDismiss();
      return;
    }
    if (event.key !== 'Tab') return;
    event.stopPropagation();

    const dialog = event.currentTarget as HTMLElement;
    const focusable = Array.from(
      dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
    ).filter((element) => element.getClientRects().length > 0);
    const first = focusable[0];
    const last = focusable.at(-1);
    if (!first || !last) return;
    if (event.shiftKey && this.document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && this.document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  /** Attach to the drag handle's `(pointerdown)`. */
  onDragStart(event: PointerEvent): void {
    if (event.button !== 0 || (this.options()?.closing?.() ?? false)) return;
    if ((event.target as Element | null)?.closest('button, a')) return;
    // Drag-to-dismiss is a bottom-sheet gesture — centered desktop dialogs
    // don't slide down, so the gesture is gated to the presentation that
    // actually has the affordance (default: the mobile bottom sheet).
    const media = this.options()?.dragMedia ?? '(max-width: 760px)';
    if (!this.document.defaultView?.matchMedia(media).matches) return;

    this.dragPointerId = event.pointerId;
    this.dragStartY = event.clientY;
    this.dragStartTime = performance.now();
    this.dragOffset = 0;
    this.draggingState.set(true);
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  }

  /** Attach to the drag handle's `(pointermove)`. */
  onDragMove(event: PointerEvent): void {
    if (event.pointerId !== this.dragPointerId) return;
    this.dragOffset = Math.max(0, event.clientY - this.dragStartY);
    this.dialogElement()?.style.setProperty(
      this.dragVar(),
      `${this.dragOffset}px`,
    );
    if (this.dragOffset > 0) event.preventDefault();
  }

  /** Attach to the drag handle's `(pointerup)` and `(pointercancel)`. */
  onDragEnd(event: PointerEvent): void {
    if (event.pointerId !== this.dragPointerId) return;
    const handle = event.currentTarget as HTMLElement;
    this.dragPointerId = null;
    this.draggingState.set(false);
    if (handle.hasPointerCapture(event.pointerId)) {
      handle.releasePointerCapture(event.pointerId);
    }

    const elapsed = Math.max(1, performance.now() - this.dragStartTime);
    const velocity = this.dragOffset / elapsed;
    // The gesture is over either way: the surface goes back to rest. A
    // dismissal is only REQUESTED, and an owner may refuse it (a guard over
    // a dirty draft asks first) — left sunk by the drag, the sheet stayed
    // displaced for as long as the answer took (found in review,
    // 2026-09-23). An accepted dismissal plays its own exit from rest.
    this.dialogElement()?.style.setProperty(this.dragVar(), '0px');
    if (this.dragOffset > 110 || velocity > 0.65) this.requestDismiss();
  }

  private dragVar(): string {
    return this.options()?.dragVar ?? '--ui-sheet-drag-y';
  }

  private dialogElement(): HTMLElement | null {
    const selector = this.options()?.dialogSelector;
    if (!selector) return null;
    return this.elementRef.nativeElement.querySelector<HTMLElement>(selector);
  }

  private activateEnvironment(options: UiSheetBehaviorOptions): void {
    this.environmentActive = true;
    this.previousFocus = this.document.activeElement as HTMLElement | null;
    const lockScroll =
      typeof options.lockScroll === 'function'
        ? options.lockScroll()
        : (options.lockScroll ?? true);
    if (lockScroll) {
      this.scrollLocked = true;
      this.previousBodyOverflow = this.document.body.style.overflow;
      // Compensate the vanished scrollbar so the page doesn't shift sideways
      // while locked (scrollbar-gutter can't help here: the lock removes the
      // scroll container's scrollbar entirely).
      const scrollbarWidth =
        (this.document.defaultView?.innerWidth ?? 0) -
        this.document.documentElement.clientWidth;
      this.previousBodyPaddingRight = this.document.body.style.paddingRight;
      if (scrollbarWidth > 0) {
        this.document.body.style.paddingRight = `${scrollbarWidth}px`;
      }
      this.document.body.style.overflow = 'hidden';
    }
    // Inert each target — but NEVER a subtree that contains the sheet
    // itself (a sheet rendered INSIDE the targeted shell would otherwise
    // freeze its own controls — the landing menu's exact failure mode) or
    // an exempt subtree (chrome that must stay live, e.g. the header
    // whose trigger doubles as the sheet's ✕). Around either, the walk
    // descends and freezes the other children instead — the standard
    // modal-inert algorithm.
    const host = this.elementRef.nativeElement;
    const exempt = (options.inertExemptSelectors ?? []).flatMap((selector) =>
      Array.from(this.document.querySelectorAll<HTMLElement>(selector)),
    );
    this.inertedElements = [];
    const applyInert = (element: HTMLElement): void => {
      const isOrInsideExempt = exempt.some(
        (live) => live === element || live.contains(element),
      );
      if (isOrInsideExempt) return;
      const containsLiveBranch =
        element.contains(host) || exempt.some((live) => element.contains(live));
      if (!containsLiveBranch) {
        element.setAttribute('inert', '');
        this.inertedElements.push(element);
        return;
      }
      for (const child of Array.from(element.children)) {
        if (child instanceof HTMLElement) applyInert(child);
      }
    };
    for (const selector of options.inertSelectors ?? []) {
      const element = this.document.querySelector<HTMLElement>(selector);
      if (element) applyInert(element);
    }
  }

  private deactivateEnvironment(): void {
    if (!this.environmentActive) return;
    this.environmentActive = false;
    if (this.scrollLocked) {
      this.scrollLocked = false;
      this.document.body.style.overflow = this.previousBodyOverflow;
      this.document.body.style.paddingRight = this.previousBodyPaddingRight;
    }
    for (const element of this.inertedElements) {
      element.removeAttribute('inert');
    }
    this.inertedElements = [];
    this.dialogElement()?.style.removeProperty(this.dragVar());
    // Captured BEFORE the field is cleared: the callback runs a frame later,
    // and reading the field then found it already null — focus never went
    // back to the control that opened the sheet (found 2026-09-16 by the
    // action sheet's spec).
    const previous = this.previousFocus;
    this.previousFocus = null;
    requestAnimationFrame(() => previous?.focus());
  }
}
