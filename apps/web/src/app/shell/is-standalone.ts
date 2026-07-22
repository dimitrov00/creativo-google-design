import { DOCUMENT } from '@angular/common';
import { inject } from '@angular/core';

/**
 * Mirrors v2's `useIsStandalone()` (`src/lib/routing/use-is-standalone.ts`)
 * — `display-mode: standalone` covers installed PWAs on Android/desktop;
 * iOS Safari never sets that media feature and instead exposes the
 * legacy `navigator.standalone` boolean.
 */
export function isStandalone(): boolean {
  const document = inject(DOCUMENT);
  const window = document.defaultView;
  if (!window) return false;

  const standaloneNavigator = window.navigator as Navigator & {
    standalone?: boolean;
  };
  return (
    window.matchMedia?.('(display-mode: standalone)').matches === true ||
    standaloneNavigator.standalone === true
  );
}
