import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  ViewEncapsulation,
  afterNextRender,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';

/**
 * DOM form of the large-title sentinel marker (the HTML parser lowercases
 * template attributes: `uiSheetLargeTitle` → `uisheetlargetitle`).
 */
const LARGE_TITLE_SELECTOR = '[uisheetlargetitle]';

/**
 * Sheet header — the grabber pill + scroll-collapsing centered title +
 * trailing actions bar every sheet shares (UINavigationBar large-title
 * collapse; SwiftUI parity: a large title with
 * `.navigationBarTitleDisplayMode(.inline)` on a sheet). Extracted from the
 * landing's cr-modal-sheet so the geometry (52px `--control-size-prominent`
 * bar, sticky at `--sys-layer-header`) exists ONCE in the DS.
 *
 * At rest the bar is TRANSPARENT chrome: no fill, no hairline, compact
 * title hidden — the in-content large title carries the identity. Only
 * when that large title scrolls under the bar does the header "land":
 * compact title fades/rises in, surface fill + hairline appear.
 *
 * Markup contract (attribute-marked slots, both optional):
 * ```html
 * <ui-sheet-header>
 *   <div uiTitle>{{ compactTitle }}</div>
 *   <button uiTrailing uiButton …>…</button>
 * </ui-sheet-header>
 * ```
 * Collapse is FIRST-CLASS — mechanisms, in priority order:
 * 1. `uiCollapsed` input: when the owner passes a boolean it wins outright
 *    (for owners that already track the crossing themselves).
 * 2. Sentinel observation (the default — every sheet gets it for free):
 *    the consumer labels its in-content large title with the
 *    `uiSheetLargeTitle` attribute. The header finds its nearest
 *    scroll-container ancestor and watches the sentinel with an
 *    IntersectionObserver whose top rootMargin subtracts the bar height —
 *    "slid under the bar", not "left the scroller box", is the crossing
 *    (same geometry the locations sheet pioneered). A MutationObserver
 *    re-resolves the sentinel when the sheet swaps its content subtree
 *    (`@if (active…)` per open). With NO labelled sentinel the header
 *    falls back to collapsing whenever the scroller is scrolled at all
 *    (an inline-title bar shows its chrome as soon as content runs
 *    underneath it).
 * 3. Scroll-linked CSS (progressive enhancement): `uiSheetLargeTitle` also
 *    names the sentinel's view-timeline `--ui-sheet-headline` (consumers
 *    may equally name it via their own CSS), and in browsers with
 *    scroll-driven animations the compact title + chrome bind per-frame to
 *    the large title's exit instead of the binary flip.
 * 4. Legacy fallback: the owner stamps `data-visible` on its `[uiTitle]`
 *    element — the title shows and the chrome follows (`:has()`).
 *
 * The grabber is presentation only (shown inside UiSheetBehavior's default
 * drag media, max-width 760px); the OWNER wires drag-to-dismiss pointer
 * events to the behavior.
 */
@Component({
  selector: 'ui-sheet-header',
  template: `
    <span class="ui-sheet-header__grabber" aria-hidden="true"></span>
    <ng-content select="[uiTitle]" />
    <ng-content select="[uiTrailing]" />
  `,
  styleUrl: './sheet-header.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Unscoped: bare `.ui-*`/`[data-*]` selectors never match a component's
  // own HOST element under emulated encapsulation (see avatar.ts) — and
  // global `.ui-*` classes are this system's actual styling contract (§3.1).
  encapsulation: ViewEncapsulation.None,
  host: {
    class: 'ui-sheet-header',
    '[attr.data-collapsed]': "collapsed() ? '' : null",
  },
})
export class UiSheetHeader {
  /**
   * Owner-driven collapse override. Leave unset (`undefined`) to use the
   * built-in sentinel observation; pass a boolean to drive the collapsed
   * state entirely from the owner's own scroll tracking.
   */
  readonly uiCollapsed = input<boolean | undefined>(undefined);

  private readonly elementRef = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly destroyRef = inject(DestroyRef);

  private readonly observedCollapsed = signal(false);
  protected readonly collapsed = computed(
    () => this.uiCollapsed() ?? this.observedCollapsed(),
  );

  private scroller: HTMLElement | null = null;
  private sentinel: Element | null = null;
  private intersectionObserver: IntersectionObserver | undefined;

  /** No-sentinel fallback: any scroll means content runs under the bar. */
  private readonly onScrollerScroll = (): void => {
    if (this.sentinel || !this.scroller) return;
    this.observedCollapsed.set(this.scroller.scrollTop > 0);
  };

  constructor() {
    // afterNextRender is browser-only, so no PLATFORM_ID guard is needed;
    // projected content (including the sentinel) exists by then.
    afterNextRender(() => this.observe());
    this.destroyRef.onDestroy(() => {
      this.intersectionObserver?.disconnect();
      this.scroller?.removeEventListener('scroll', this.onScrollerScroll);
    });
  }

  private observe(): void {
    // Same availability guard as uiReveal: jsdom/older engines have no
    // IntersectionObserver — the header then keeps its resting chrome
    // (owners can still drive `uiCollapsed` / `data-visible`).
    if (typeof IntersectionObserver === 'undefined') return;
    const scroller = this.findScroller();
    if (!scroller) return;
    this.scroller = scroller;

    this.syncSentinel();
    scroller.addEventListener('scroll', this.onScrollerScroll, {
      passive: true,
    });

    // Detail sheets typically swap their content subtree per open
    // (`@if (activeLocation())` …) — re-resolve the sentinel whenever the
    // scroller's contents change so observation survives the swap.
    if (typeof MutationObserver !== 'undefined') {
      const mutations = new MutationObserver(() => this.syncSentinel());
      mutations.observe(scroller, { childList: true, subtree: true });
      this.destroyRef.onDestroy(() => mutations.disconnect());
    }
  }

  private syncSentinel(): void {
    const scroller = this.scroller;
    if (!scroller) return;
    const sentinel = scroller.querySelector(LARGE_TITLE_SELECTOR);
    if (sentinel === this.sentinel) return;

    this.intersectionObserver?.disconnect();
    this.intersectionObserver = undefined;
    this.sentinel = sentinel;
    if (!sentinel) {
      this.onScrollerScroll();
      return;
    }

    // The sticky bar is dead viewing area at the top of the scroller —
    // subtract it via rootMargin so the crossing is "slid under the bar".
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const exitedAbove =
            !entry.isIntersecting &&
            entry.boundingClientRect.bottom <= (entry.rootBounds?.top ?? 0);
          this.observedCollapsed.set(exitedAbove);
        }
      },
      {
        root: scroller,
        rootMargin: `-${this.elementRef.nativeElement.offsetHeight}px 0px 0px 0px`,
        threshold: 0,
      },
    );
    observer.observe(sentinel);
    this.intersectionObserver = observer;
  }

  /** Nearest ancestor that actually scrolls — the sheet's own scroller. */
  private findScroller(): HTMLElement | null {
    for (
      let node = this.elementRef.nativeElement.parentElement;
      node !== null;
      node = node.parentElement
    ) {
      const { overflowY } = getComputedStyle(node);
      if (overflowY === 'auto' || overflowY === 'scroll') return node;
    }
    return null;
  }
}
