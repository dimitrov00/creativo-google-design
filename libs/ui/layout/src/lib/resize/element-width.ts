import {
  DestroyRef,
  type ElementRef,
  type Signal,
  effect,
  inject,
  signal,
} from '@angular/core';

/**
 * AN ELEMENT'S INLINE WIDTH AS A SIGNAL (the chart kit's one measurement,
 * `docs/designs/staff-analytics-v2.md` «Chart kit»). A `ResizeObserver`
 * reports the content-box width after a layout the browser did anyway —
 * never a forced read — so a chart lays its `viewBox` out in CSS pixels
 * and its words never stretch.
 *
 * Call it in an injection context (a component's field initialiser or
 * constructor): the element arrives as a signal (`viewChild`), so the
 * observer follows the element the view currently holds and stops when the
 * owner is destroyed. Where the API is absent (jsdom, a server) the signal
 * stays `0`, and the owner draws at its fallback width.
 */
export function elementWidth(
  element: Signal<ElementRef<Element> | undefined>,
): Signal<number> {
  const width = signal(0);
  if (typeof ResizeObserver === 'undefined') return width.asReadonly();

  const observer = new ResizeObserver((entries) => {
    const entry = entries[entries.length - 1];
    if (entry === undefined) return;
    width.set(entry.contentRect.width);
  });

  effect((onCleanup) => {
    const target = element()?.nativeElement;
    if (target === undefined) return;
    observer.observe(target);
    onCleanup(() => observer.unobserve(target));
  });
  inject(DestroyRef).onDestroy(() => observer.disconnect());

  return width.asReadonly();
}
