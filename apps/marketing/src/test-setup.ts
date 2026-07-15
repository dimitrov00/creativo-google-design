// jsdom does not implement matchMedia — ThemeService/CursorService rely on
// it to read prefers-color-scheme / prefers-reduced-motion / pointer type.
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

// jsdom does not implement ResizeObserver — CursorDotComponent uses it to
// re-measure a "fill" target if its size changes while hovered.
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
