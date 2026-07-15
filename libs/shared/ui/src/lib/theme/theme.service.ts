import { DOCUMENT } from '@angular/common';
import { Injectable, effect, inject, signal } from '@angular/core';
import type { Theme } from '@creativo/shared/design-tokens';

const STORAGE_KEY = 'cr-theme';

@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly document = inject(DOCUMENT);
  private readonly window = this.document.defaultView;

  // Angular's SSR/prerender DOM shim provides a `defaultView`-like object
  // that is truthy but does not implement `matchMedia`/`localStorage` the
  // way a real browser does — plain `?.` guards aren't enough on their own,
  // these need actual function-type checks (and localStorage access can
  // also throw in some real-browser privacy modes, hence the try/catch).
  private readonly darkSchemeQuery = this.matchMediaSafe(
    '(prefers-color-scheme: dark)',
  );
  private readonly lightSchemeQuery = this.matchMediaSafe(
    '(prefers-color-scheme: light)',
  );

  readonly theme = signal<Theme>(this.readInitialTheme());

  constructor() {
    effect(() => {
      const theme = this.theme();
      // `setAttribute`, not `.dataset[...]` — Angular's SSR DOM shim
      // implements the former but not the latter, and both produce the
      // identical `data-theme="..."` attribute the CSS selectors key off.
      this.document.documentElement.setAttribute('data-theme', theme);
      this.setStoredTheme(theme);
    });

    this.darkSchemeQuery?.addEventListener('change', (event) => {
      this.theme.set(event.matches ? 'dark' : 'light');
    });
  }

  toggle(): void {
    this.theme.set(this.theme() === 'dark' ? 'light' : 'dark');
  }

  private readInitialTheme(): Theme {
    const stored = this.getStoredTheme();
    if (stored === 'light' || stored === 'dark') return stored;
    // Dark is the default brand theme (matches design.google's primary
    // palette) — only fall back to light when the OS explicitly prefers it.
    if (this.lightSchemeQuery?.matches) return 'light';
    return 'dark';
  }

  private matchMediaSafe(query: string): MediaQueryList | undefined {
    return typeof this.window?.matchMedia === 'function'
      ? this.window.matchMedia(query)
      : undefined;
  }

  private getStoredTheme(): string | null {
    try {
      return typeof this.window?.localStorage?.getItem === 'function'
        ? this.window.localStorage.getItem(STORAGE_KEY)
        : null;
    } catch {
      return null;
    }
  }

  private setStoredTheme(theme: Theme): void {
    try {
      this.window?.localStorage?.setItem?.(STORAGE_KEY, theme);
    } catch {
      // non-critical persistence — ignore (SSR shim / privacy mode)
    }
  }
}
