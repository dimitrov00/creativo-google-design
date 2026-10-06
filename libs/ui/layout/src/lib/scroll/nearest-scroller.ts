/**
 * THE NEAREST SCROLLER — the first ANCESTOR of `from` that actually scrolls
 * on the block axis: the one whose computed `overflow-y` is `auto` or
 * `scroll`. `null` when nothing above it does, which means the page itself
 * scrolls (the viewport is nobody's ancestor).
 *
 * One walk, shared (reuse, never copy): the sheet header finds the scroller
 * it collapses against with it, and the visits browser the one its month
 * pills follow. It moved UP here from `ui-sheet-header`'s private
 * `findScroller()`; nothing about it changed on the way.
 *
 * What it deliberately does NOT answer:
 *
 * - `from` itself is never returned. The caller is a bar, a headline or a
 *   list INSIDE a scroller and asks what it rides in, so an element that
 *   scrolls its own content still gets its ancestor.
 * - `overflow-y: hidden` and `clip` are not scrollers, whatever they hold:
 *   they cannot be scrolled by the person, and an observer rooted on one
 *   would never fire.
 * - Whether the scroller has anything to scroll RIGHT NOW. A sheet that
 *   fits its detent today overflows after the next read; the answer is the
 *   element that WOULD scroll, so it stays valid while the content grows.
 *
 * Reads layout (`getComputedStyle`), so call it after render
 * (`afterNextRender`, an event handler), never while a template is being
 * checked; it touches `window`, so never on the server.
 */
export function nearestScroller(from: Element): HTMLElement | null {
  for (
    let node = from.parentElement;
    node !== null;
    node = node.parentElement
  ) {
    const { overflowY } = getComputedStyle(node);
    if (overflowY === 'auto' || overflowY === 'scroll') return node;
  }
  return null;
}
