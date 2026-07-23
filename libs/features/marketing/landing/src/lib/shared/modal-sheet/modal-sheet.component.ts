import { isPlatformBrowser } from '@angular/common';
import {
  Component,
  type ElementRef,
  PLATFORM_ID,
  ViewEncapsulation,
  afterNextRender,
  effect,
  inject,
  input,
  output,
  viewChild,
} from '@angular/core';
import { UiButton, UiIcon } from '@creativo/ui/controls';
import {
  UiSheet,
  type UiSheetBehavior,
  type UiSheetScrollEvent,
} from '@creativo/ui/layout';
import { UiMaterialDirective } from '@creativo/ui/modifiers';
import { UiSheetHeader } from '@creativo/ui/patterns';

/** Kept as the landing-facing name; the shape now lives in the DS layer. */
export type ModalSheetScrollEvent = UiSheetScrollEvent;

@Component({
  selector: 'cr-modal-sheet',
  imports: [UiButton, UiIcon, UiMaterialDirective, UiSheet, UiSheetHeader],
  templateUrl: './modal-sheet.component.html',
  styleUrl: './modal-sheet.component.css',
  // Internals converged on the DS sheet primitives: ui-sheet hosts the
  // shared UiSheetBehavior (body scroll lock, focus trap/restore, Escape +
  // backdrop dismissal, drag-to-dismiss) and ui-sheet-header owns the
  // grabber/collapsing-title/close geometry — this component keeps only
  // the landing-facing `cr-modal-sheet` API for its remaining consumers.
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
    // animations key off `cr-modal-sheet[data-open]`, and state a component
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
  },
})
export class ModalSheetComponent {
  private readonly platformId = inject(PLATFORM_ID);

  readonly sheetId = input.required<string>();
  readonly labelledBy = input.required<string>();
  readonly closeLabel = input.required<string>();
  readonly open = input(false);
  readonly closing = input(false);

  /** Dismissal *request* (Escape / backdrop / drag / close control) —
   *  forwarded from the behavior; the owner flips `open` itself. */
  readonly dismissed = output<void>();
  /** Scroll progress of the sheet scroller (the behavior's event shape). */
  readonly sheetScrolled = output<ModalSheetScrollEvent>();

  /** The shared behavior instance hosted by the inner ui-sheet. */
  private readonly behavior =
    viewChild.required<UiSheetBehavior>('sheetBehavior');
  private readonly scroller = viewChild<ElementRef<HTMLElement>>('scroller');

  constructor() {
    // ui-sheet re-exposes only `uiDismissed`; scroll progress is forwarded
    // here under the landing-facing output name (one progress formula, the
    // behavior's).
    afterNextRender(() => {
      this.behavior().uiSheetScrolled.subscribe((event) =>
        this.sheetScrolled.emit(event),
      );
    });

    // Scroller back to the top on every open — previously the behavior's
    // `scrollerSelector` option; ui-sheet connects without one, so the
    // shell restates it (same rAF timing the behavior used).
    effect(() => {
      if (!this.open() || !isPlatformBrowser(this.platformId)) return;
      const scroller = this.scroller()?.nativeElement;
      if (!scroller) return;
      requestAnimationFrame(() => {
        scroller.scrollTop = 0;
      });
    });
  }
}
