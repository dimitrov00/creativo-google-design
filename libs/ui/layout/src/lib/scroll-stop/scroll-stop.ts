import {
  DestroyRef,
  ElementRef,
  afterNextRender,
  effect,
  inject,
  type Signal,
} from '@angular/core';

/** What the keyboard can already reach inside a scroller (a link, a control, a stop). */
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), ' +
  'textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), [contenteditable="true"]';

/** The axis a scroller overflows on. */
export type ScrollStopAxis = 'inline' | 'block';

/**
 * Makes the host scroller a keyboard stop while it needs one (WCAG 2.1.1,
 * axe `scrollable-region-focusable`): while it overflows on `axis` and
 * holds nothing focusable, the host gets `tabindex="0"` (the arrow keys
 * then scroll it), `role="group"` unless the consumer gave it a role, and
 * `label` as its `aria-label` unless the consumer named it. Whatever the
 * consumer set itself is left alone, and everything this wrote is lifted
 * the moment the scroller stops overflowing or gains a focusable child.
 *
 * Call it in the constructor of the scroller (`ui-scroll-row`,
 * `ui-scroll-column`): it injects the host and its destroy hook.
 */
export function keyboardScrollStop(
  axis: ScrollStopAxis,
  label: Signal<string | null>,
): void {
  const host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  const destroyRef = inject(DestroyRef);
  /** Whether the host is a stop now, and which attributes this wrote. */
  let stop = false;
  let wroteTabindex = false;
  let wroteRole = false;
  let wroteLabel = false;

  const overflows = (): boolean =>
    axis === 'inline'
      ? host.scrollWidth - host.clientWidth > 1
      : host.scrollHeight - host.clientHeight > 1;

  /** Stamps or lifts the keyboard stop from what the host holds now. */
  const sync = (): void => {
    const next = overflows() && !host.querySelector(FOCUSABLE);
    if (next === stop) return;
    stop = next;
    if (stop) {
      if (!host.hasAttribute('tabindex')) {
        host.setAttribute('tabindex', '0');
        wroteTabindex = true;
      }
      host.setAttribute('data-keyboard-stop', '');
      if (!host.hasAttribute('role')) {
        host.setAttribute('role', 'group');
        wroteRole = true;
      }
      const name = label();
      if (
        name &&
        !host.hasAttribute('aria-label') &&
        !host.hasAttribute('aria-labelledby')
      ) {
        host.setAttribute('aria-label', name);
        wroteLabel = true;
      }
      return;
    }
    host.removeAttribute('data-keyboard-stop');
    if (wroteTabindex) host.removeAttribute('tabindex');
    if (wroteRole) host.removeAttribute('role');
    if (wroteLabel) host.removeAttribute('aria-label');
    wroteTabindex = false;
    wroteRole = false;
    wroteLabel = false;
  };

  afterNextRender(() => {
    if (typeof ResizeObserver === 'undefined') return;
    const resize = new ResizeObserver(() => sync());
    const watch = () => {
      resize.observe(host);
      for (const child of Array.from(host.children)) {
        resize.observe(child);
      }
    };
    watch();
    const mutation =
      typeof MutationObserver === 'undefined'
        ? null
        : new MutationObserver(() => {
            watch();
            sync();
          });
    mutation?.observe(host, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['tabindex', 'href', 'disabled', 'contenteditable'],
    });
    sync();
    destroyRef.onDestroy(() => {
      resize.disconnect();
      mutation?.disconnect();
    });
  });
  // A label that changes while the host is a stop follows it.
  effect(() => {
    const name = label();
    if (!wroteLabel) return;
    if (name) host.setAttribute('aria-label', name);
    else {
      host.removeAttribute('aria-label');
      wroteLabel = false;
    }
  });
}
