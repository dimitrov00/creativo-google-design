import '@angular/compiler';
import '@analogjs/vitest-angular/setup-snapshots';
import { setupTestBed } from '@analogjs/vitest-angular/setup-testbed';

setupTestBed();

// jsdom does not implement matchMedia — CursorService/gsap's ScrollTrigger
// rely on it to read prefers-color-scheme / prefers-reduced-motion / pointer
// type. Tests override it per-case.
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

// jsdom does not implement IntersectionObserver — UiRevealDirective and
// UiSheetHeader observe scroll sentinels with it; without a stub their
// guarded construction logs "IntersectionObserver is not defined" stderr
// noise (tests still pass — the directives no-op when observation fails).
if (!window.IntersectionObserver) {
  window.IntersectionObserver = class {
    readonly root = null;
    readonly rootMargin = '0px';
    readonly scrollMargin = '0px';
    readonly thresholds: readonly number[] = [0];
    observe(): void {
      // no-op: jsdom has no real viewport to intersect with
    }
    unobserve(): void {
      // no-op
    }
    disconnect(): void {
      // no-op
    }
    takeRecords(): IntersectionObserverEntry[] {
      return [];
    }
  } as unknown as typeof IntersectionObserver;
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
