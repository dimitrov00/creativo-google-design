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

  set(theme: UiTheme): void {
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
