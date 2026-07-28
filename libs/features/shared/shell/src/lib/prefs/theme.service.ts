import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import { Injectable, PLATFORM_ID, inject, signal } from '@angular/core';

type UiTheme = 'light' | 'dark';

// `@creativo/ui/tokens` owns this key (LANG/THEME_STORAGE_KEY), but the
// module-boundary policy keeps `type:tokens` TS out of feature libs — the
// string is the stable pre-paint contract asserted by pre-paint.spec.ts.
const THEME_STORAGE_KEY = 'ui-theme';

/**
 * Light/dark toggle over the pre-paint contract: the boot script stamps
 * `data-theme` on `<html>` from `localStorage['ui-theme']` before Angular
 * runs; this service is the RUNTIME writer of the same three surfaces
 * (attribute, storage key, `<meta name="theme-color">`), so a toggle and a
 * reload always agree. v2 equivalent: `app.store.ts` setMode +
 * `updateThemeColor`.
 */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly document = inject(DOCUMENT);
  private readonly platformId = inject(PLATFORM_ID);

  readonly theme = signal<UiTheme>(this.readInitial());

  toggle(): void {
    this.set(this.theme() === 'dark' ? 'light' : 'dark');
  }

  /**
   * A same-document View Transition crossfades the WHOLE page (root
   * snapshot old → new) as one smooth pass — the same browser primitive
   * `withViewTransitions` already uses for route changes (app.config.ts),
   * styled by the SAME global `::view-transition-old(root)` /
   * `::view-transition-new(root)` rule in apps/web/src/styles.css (so route
   * changes and theme switches share one consistent crossfade feel, no
   * separate duration to invent). Without this, per-element CSS
   * transitions — e.g. the header's scroll-driven background-color ease in
   * landing-header.component.css vs body's in styles.css — fire
   * independently at different speeds, so only some surfaces visibly
   * animate and others snap: reads as the header "lagging" behind an
   * otherwise-instant switch. `skipTransition()` on reduced-motion mirrors
   * app.config.ts's `onViewTransitionCreated` check exactly.
   */
  set(theme: UiTheme): void {
    if (
      !isPlatformBrowser(this.platformId) ||
      typeof this.document.startViewTransition !== 'function'
    ) {
      this.applyTheme(theme);
      return;
    }

    const transition = this.document.startViewTransition(() =>
      this.applyTheme(theme),
    );
    const reducedMotion = this.document.defaultView?.matchMedia(
      '(prefers-reduced-motion: reduce)',
    ).matches;
    if (reducedMotion) transition.skipTransition();
  }

  private applyTheme(theme: UiTheme): void {
    this.theme.set(theme);
    const root = this.document.documentElement;
    root.setAttribute('data-theme', theme);
    // Meta theme-color mirrors the page background — read the token the new
    // attribute resolves to instead of duplicating the per-theme hex here.
    const background = this.document.defaultView
      ?.getComputedStyle(root)
      .getPropertyValue('--sys-color-background')
      .trim();
    if (background) {
      this.document
        .querySelector('meta[name="theme-color"]')
        ?.setAttribute('content', background);
    }
    try {
      this.document.defaultView?.localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // Storage can be unavailable in privacy-restricted browsers.
    }
  }

  private readInitial(): UiTheme {
    if (!isPlatformBrowser(this.platformId)) return 'dark';
    const stamped = this.document.documentElement.getAttribute('data-theme');
    return stamped === 'light' ? 'light' : 'dark';
  }
}
