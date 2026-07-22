import { Component, inject, input } from '@angular/core';
import { UiSheetBehavior, type UiSheetScrollEvent } from '@creativo/ui/layout';

/** Kept as the landing-facing name; the shape now lives in the DS layer. */
export type ModalSheetScrollEvent = UiSheetScrollEvent;

@Component({
  selector: 'cr-modal-sheet',
  imports: [],
  templateUrl: './modal-sheet.component.html',
  styleUrl: './modal-sheet.component.css',
  // All modal machinery (body scroll lock, focus trap/restore, Escape +
  // backdrop dismissal, drag-to-dismiss, inert background, scroll progress)
  // is the shared UiSheetBehavior from libs/ui/layout — this component owns
  // only the landing sheet's surface/markup and delegates events to it.
  hostDirectives: [
    {
      directive: UiSheetBehavior,
      outputs: [
        'uiSheetDismissed: dismissed',
        'uiSheetScrolled: sheetScrolled',
      ],
    },
  ],
  host: {
    // The sheet stamps its own open state — consumers' content-in
    // animations key off `cr-modal-sheet[data-open]`, and state a component
    // owns belongs on its own host, not on each consumer's template
    // (locations' sheet animations were silently dead because only
    // services.page.html remembered to bind this).
    '[attr.data-open]': "open() ? '' : null",
    // Generic, reusable-shell testid/state — this component is used by
    // several consumers (locations, team-showcase, …), so this stays
    // call-site-agnostic; consumers add their own specific testid on their
    // own sheet content element instead of overloading this one.
    'data-testid': 'modal-sheet',
    '[attr.data-state]': "open() ? 'open' : closing() ? 'closing' : 'closed'",
  },
})
export class ModalSheetComponent {
  private readonly behavior = inject(UiSheetBehavior);

  readonly sheetId = input.required<string>();
  readonly labelledBy = input.required<string>();
  readonly closeLabel = input.required<string>();
  readonly open = input(false);
  readonly closing = input(false);
  readonly titleVisible = input(false);
  protected readonly dragging = this.behavior.dragging;

  constructor() {
    this.behavior.connect({
      open: this.open,
      closing: this.closing,
      dialogSelector: '.modal-sheet',
      scrollerSelector: '.modal-sheet__scroll',
      initialFocusSelector: '.modal-sheet__close',
      inertSelectors: ['.cr-shell__header'],
      dragVar: '--modal-sheet-drag-y',
    });
  }

  protected requestDismiss(): void {
    this.behavior.requestDismiss();
  }

  protected onBackdropPointerDown(event: PointerEvent): void {
    this.behavior.onBackdropPointerDown(event);
  }

  protected onBackdropPointerUp(event: PointerEvent): void {
    this.behavior.onBackdropPointerUp(event);
  }

  protected onScroll(event: Event): void {
    this.behavior.onScroll(event);
  }

  protected onKeydown(event: KeyboardEvent): void {
    this.behavior.onKeydown(event);
  }

  protected onDragStart(event: PointerEvent): void {
    this.behavior.onDragStart(event);
  }

  protected onDragMove(event: PointerEvent): void {
    this.behavior.onDragMove(event);
  }

  protected onDragEnd(event: PointerEvent): void {
    this.behavior.onDragEnd(event);
  }
}
