// jsdom does not implement matchMedia — DesignSystemPreferences reads
// prefers-color-scheme through it, app.config.ts prefers-reduced-motion, and
// the medal and client-card pages their width probes.
if (!window.matchMedia) {
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    }) as MediaQueryList;
}

// jsdom does not implement ResizeObserver — the gap visualiser (sc-gap-viz)
// and the DS scroll row, menu and modal sheet observe their boxes with it.
if (!window.ResizeObserver) {
  window.ResizeObserver = class {
    observe(): void {
      // no-op: jsdom has no real layout to observe
    }
    unobserve(): void {
      // no-op
    }
    disconnect(): void {
      // no-op
    }
  } as unknown as typeof ResizeObserver;
}
