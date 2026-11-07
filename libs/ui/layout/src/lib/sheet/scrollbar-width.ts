import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import {
  DestroyRef,
  type EnvironmentProviders,
  Injectable,
  PLATFORM_ID,
  inject,
  provideEnvironmentInitializer,
} from '@angular/core';

/**
 * THE PAGE'S SCROLLBAR WIDTH, KNOWN BEFORE A SHEET OPENS (2026-11-07,
 * owner: "buttery smooth"). A sheet's scroll lock pads the body by the
 * scrollbar it hides, so the page does not shift sideways. Measuring it at
 * the open (`innerWidth − documentElement.clientWidth`) is a read of layout
 * in the middle of the render that inserts the sheet: a forced layout, then
 * the lock's own writes dirty the page and the browser styles it again.
 * That read was about a third of the script a small sheet's open ran.
 *
 * Here a `ResizeObserver` on the root keeps the width current: it reports
 * sizes after a layout the browser did anyway, never forcing one. Readings
 * taken while a lock holds the scrollbar away are ignored (they would say
 * 0). Before the first report, `width()` measures once, as the lock did.
 */
@Injectable({ providedIn: 'root' })
export class UiScrollbarWidth {
  private readonly document = inject(DOCUMENT);
  private known: number | null = null;

  constructor() {
    if (!isPlatformBrowser(inject(PLATFORM_ID))) return;
    const view = this.document.defaultView;
    if (view === null || typeof ResizeObserver === 'undefined') return;
    const root = this.document.documentElement;
    const observer = new ResizeObserver((entries) => {
      if (this.document.body?.style.overflow === 'hidden') return;
      const entry = entries[entries.length - 1];
      if (entry === undefined) return;
      this.known = Math.max(0, view.innerWidth - entry.contentRect.width);
    });
    observer.observe(root);
    inject(DestroyRef).onDestroy(() => observer.disconnect());
  }

  /** The classic scrollbar's width in CSS pixels; 0 for overlay scrollbars. */
  width(): number {
    if (this.known !== null) return this.known;
    const view = this.document.defaultView;
    return Math.max(
      0,
      (view?.innerWidth ?? 0) - this.document.documentElement.clientWidth,
    );
  }
}

/**
 * Starts watching the scrollbar at boot, so the first sheet a person opens
 * reads a known width too.
 */
export function provideUiScrollbarWidth(): EnvironmentProviders {
  return provideEnvironmentInitializer(() => {
    inject(UiScrollbarWidth);
  });
}
