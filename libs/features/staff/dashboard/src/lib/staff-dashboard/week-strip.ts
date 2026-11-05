/**
 * Park the week strip on a week, and keep asking until it lands.
 *
 * Deliberately arithmetic rather than `scrollIntoView`: every week is
 * exactly one scrollport wide, so the target is `index x clientWidth` and
 * there is nothing to measure. `scrollIntoView` also walks every scrollable
 * ancestor, which on first paint scrolled the PAGE as a side effect.
 *
 * The retry is the same shape as the dashboard's `settleOnNow` and for the
 * same reason: on a cold load the strip is laid out over several frames,
 * and a scroll against a zero-width box clamps silently to nothing.
 */
export function settleStripOnWeek(
  host: HTMLElement,
  index: number,
  framesLeft: number,
): void {
  if (framesLeft <= 0) return;
  const strip = host.querySelector<HTMLElement>(
    '[data-testid="staff-week-strip"]',
  );
  const page = strip?.clientWidth ?? 0;
  const again = () =>
    requestAnimationFrame(() => settleStripOnWeek(host, index, framesLeft - 1));
  if (strip === null || page === 0) {
    again();
    return;
  }
  const target = index * page;
  if (Math.abs(strip.scrollLeft - target) < 1) return;
  strip.scrollTo({ left: target, behavior: 'instant' });
  again();
}
