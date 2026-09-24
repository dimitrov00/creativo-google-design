import { isPlatformBrowser } from '@angular/common';
import {
  afterNextRender,
  Component,
  DestroyRef,
  effect,
  inject,
  input,
  output,
  PLATFORM_ID,
  type ElementRef,
  viewChild,
  ViewEncapsulation,
} from '@angular/core';
import { UiButton } from '../button/button';
import { UiIcon } from '../icon/icon';
import {
  UiSheet,
  type UiSheetBehavior,
  type UiSheetPresentationSizing,
  type UiSheetScrollEvent,
} from '@creativo/ui/layout';
import { UiMaterialDirective } from '@creativo/ui/modifiers';
import { UiSheetHeader } from '@creativo/ui/patterns';

/** Kept as the landing-facing name; the shape now lives in the DS layer. */
export type ModalSheetScrollEvent = UiSheetScrollEvent;

@Component({
  selector: 'ui-modal-sheet',
  imports: [UiButton, UiIcon, UiMaterialDirective, UiSheet, UiSheetHeader],
  templateUrl: './modal-sheet.html',
  styleUrl: './modal-sheet.css',
  // Internals converged on the DS sheet primitives: ui-sheet hosts the
  // shared UiSheetBehavior (body scroll lock, focus trap/restore, Escape +
  // backdrop dismissal, drag-to-dismiss) and ui-sheet-header owns the
  // grabber/collapsing-title/close geometry — this component keeps only
  // the landing-facing `ui-modal-sheet` API (promoted from the landing's cr-modal-sheet — one modal sheet for every consumer: landing set-pieces, the phone-field country picker, …).
  //
  // Unscoped like the DS components it shells: the `.ui-sheet__surface`
  // overrides below must reach INTO ui-sheet's (None-encapsulated)
  // template, and emulated scoping stamps `_ngcontent` on every selector
  // part — the surface never carries it, so every piercing rule
  // (drag-follow, the shared-inset override) silently matched nothing.
  // All selectors in the stylesheet stay `.modal-sheet`-prefixed.
  encapsulation: ViewEncapsulation.None,
  host: {
    // The sheet stamps its own open state — consumers' content-in
    // animations key off `ui-modal-sheet[data-open]`, and state a component
    // owns belongs on its own host, not on each consumer's template
    // (locations' sheet animations were silently dead because only
    // services.page.html remembered to bind this).
    '[attr.data-open]': "open() ? '' : null",
    // Generic, reusable-shell testid/state — this component is used by
    // several consumers (services, team-showcase, …), so this stays
    // call-site-agnostic; consumers add their own specific testid on their
    // own sheet content element instead of overloading this one.
    'data-testid': 'modal-sheet',
    '[attr.data-state]': "open() ? 'open' : closing() ? 'closing' : 'closed'",
    '[attr.data-fitted]': "fitted() ? '' : null",
  },
})
export class UiModalSheet {
  private readonly platformId = inject(PLATFORM_ID);

  readonly sheetId = input.required<string>();
  readonly labelledBy = input.required<string>();
  readonly closeLabel = input.required<string>();
  readonly open = input(false);
  readonly closing = input(false);
  /**
   * Inline-title mode (utility pickers): the bar title stays visible from
   * the start instead of landing only once content scrolls under the bar.
   * Content-rich set pieces (landing sheets) keep the default large-title
   * collapse.
   */
  readonly titleAlwaysVisible = input(false);
  /**
   * The owner's own word on the collapse (≙ `ui-sheet-header`'s
   * `uiCollapsed`, its first mechanism): `true` lands the compact title
   * whatever the large title's scroll says, `false` keeps it away, and
   * `undefined` (the default) leaves the sentinel observation in charge.
   * For a page whose large title FOLDS while a search is engaged (the
   * `.searchable` grammar): the title is gone but never scrolled under the
   * bar, so no observer would ever see it cross — the owner says so.
   */
  readonly titleCollapsed = input<boolean | undefined>(undefined);

  /**
   * Strip the header bar to its grabber — no title, no close control.
   *
   * The bar is right for a sheet whose content needs naming. It is dead weight
   * on one that names itself in its first row: two stacked rows of chrome
   * before any content, where the second already says who and when. Consumers
   * that set this MUST carry their own dismiss affordance in
   * `[sheet-accessory]` — the grabber, the scrim and Escape all still dismiss,
   * but a visible control is not optional (HIG: a sheet always offers a way
   * out that does not require a gesture).
   *
   * The header ELEMENT stays: it owns the grabber and the drag-to-dismiss
   * pointer handlers, and removing it would take both.
   */
  readonly bareHeader = input(false);
  /**
   * Size the sheet to its CONTENT rather than to the viewport.
   *
   * The default height is unconditional, so a two-line confirmation drew the
   * same 90svh box as a full booking form — a sentence, then six hundred
   * pixels of nothing, with the action bar stranded at the bottom of an
   * empty screen. Fitted turns that height into a cap: short content hugs,
   * long content scrolls at exactly the same ceiling.
   *
   * For confirmations and short notices. A sheet whose content arrives
   * asynchronously should stay unfitted, or its height jumps as it loads.
   */
  readonly fitted = input(false);
  /**
   * How wide the surface may grow on regular widths (≙ `.presentationSizing`).
   *
   * `page` is the set-piece default this shell was promoted for — galleries
   * and location detail trade the drawer measure for the wide container. A
   * FORM ladder wants `automatic`: its rows were designed at a phone's
   * width, and at `page` a 1280px viewport put a label at the far left and
   * its value 1,600px away (staff visit sheet, reviewed 2026-09-08).
   */
  readonly uiPresentationSizing = input<UiSheetPresentationSizing>('page');
  /** Opt out of the open-time scroll-to-top when the consumer positions the scroller itself. */
  readonly resetScrollOnOpen = input(true);
  /** Dismissal *request* (Escape / backdrop / drag / close control) —
   *  forwarded from the behavior; the owner flips `open` itself. */
  readonly dismissed = output<void>();
  /** The exit transition finished (or was cancelled) while `closing` —
   *  owners complete their close state on this instead of duplicating the
   *  CSS exit duration as a TS timer literal (locations precedent: the
   *  motion tokens stay the single source of truth). */
  readonly closeFinished = output<void>();
  /** Scroll progress of the sheet scroller (the behavior's event shape). */
  readonly sheetScrolled = output<ModalSheetScrollEvent>();

  /** The shared behavior instance hosted by the inner ui-sheet. */
  private readonly behavior =
    viewChild.required<UiSheetBehavior>('sheetBehavior');
  private readonly scroller = viewChild<ElementRef<HTMLElement>>('scroller');
  private readonly destroyRef = inject(DestroyRef);
  private readonly chrome = viewChild<ElementRef<HTMLElement>>('chrome');

  constructor() {
    /*
     * THE CHROME'S HEIGHT, PUBLISHED (2026-09-09). Content that wants to pin
     * under the bar — a search band inside a pushed page — cannot know how
     * tall the sticky chrome is (bar, grabber, an accessory when there is
     * one), and guessing from tokens put it nine pixels under the bar. The
     * shell measures itself and writes `--modal-sheet-chrome-height` on the
     * scroller, so any descendant may `position: sticky` against it.
     */
    afterNextRender(() => {
      const chrome = this.chrome()?.nativeElement;
      const scroller = this.scroller()?.nativeElement;
      if (!chrome || !scroller || typeof ResizeObserver === 'undefined') return;
      const publish = () =>
        scroller.style.setProperty(
          '--modal-sheet-chrome-height',
          `${chrome.getBoundingClientRect().height}px`,
        );
      publish();
      const observer = new ResizeObserver(publish);
      observer.observe(chrome);
      this.destroyRef.onDestroy(() => observer.disconnect());
    });
    // ui-sheet re-exposes only `uiOnDismiss`; scroll progress is forwarded
    // here under the landing-facing output name (one progress formula, the
    // behavior's).
    afterNextRender(() => {
      this.behavior().uiSheetScrolled.subscribe((event) =>
        this.sheetScrolled.emit(event),
      );
    });

    // Scroller back to the top on every open — previously the behavior's
    // `scrollerSelector` option; ui-sheet connects without one, so the
    // shell restates it (same rAF timing the behavior used). Consumers
    // that position the scroller themselves on open (the phone picker
    // scrolls to the selected country) opt out via `resetScrollOnOpen`.
    effect(() => {
      if (!this.open() || !isPlatformBrowser(this.platformId)) return;
      if (!this.resetScrollOnOpen()) return;
      const scroller = this.scroller()?.nativeElement;
      if (!scroller) return;
      requestAnimationFrame(() => {
        scroller.scrollTop = 0;
      });
    });
  }

  /**
   * Returns the scroller to the top — the same reset `open` performs,
   * exposed for owners that swap the sheet's SUBJECT while it stays open
   * (following a reference inside the sheet). A new subject has to start
   * at its own top; inheriting the previous one's scroll drops you into
   * the middle of content you have not seen.
   */
  scrollToTop(): void {
    const scroller = this.scroller()?.nativeElement;
    if (!scroller || !isPlatformBrowser(this.platformId)) return;
    // Next frame, for the same reason the open-time reset defers: a caller
    // swapping the subject writes the new content in the SAME change
    // detection pass, and a scrollTop set before that content lands is
    // undone as the box is re-laid out.
    requestAnimationFrame(() => {
      scroller.scrollTop = 0;
    });
  }

  /**
   * Completes the close when the inner ui-sheet host's scrim fade — the
   * exit's final track on the element itself (descendant transitions
   * bubble but are filtered out) — ends or is cancelled.
   */
  protected onExitTransitionEnd(event: TransitionEvent): void {
    if (!this.closing()) return;
    if (event.target !== event.currentTarget) return;
    if (event.propertyName !== 'opacity') return;
    this.closeFinished.emit();
  }
}
