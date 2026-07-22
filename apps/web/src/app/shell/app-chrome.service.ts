import { DOCUMENT } from '@angular/common';
import { Injectable, effect, inject, signal } from '@angular/core';
import { TranslocoService } from '@jsverse/transloco';
import {
  DEFAULT_DENSITY,
  DEFAULT_LANG,
  DEFAULT_THEME,
  DENSITY_STORAGE_KEY,
  LANG_STORAGE_KEY,
  THEME_STORAGE_KEY,
  UiDensity,
  UiTheme,
} from '@creativo/ui/tokens';

/**
 * Post-bootstrap counterpart to `index.html`'s pre-paint script (blueprint
 * §7.6) — reads the SAME storage keys so the attributes it stamps on
 * `<html>` agree with what pre-paint already set (no flash), then keeps
 * them reactive for the rest of the session (e.g. a future preferences
 * toggle can just write these signals).
 */
@Injectable({ providedIn: 'root' })
export class AppChromeService {
  private readonly document = inject(DOCUMENT);
  private readonly window = this.document.defaultView;
  private readonly transloco = inject(TranslocoService);

  readonly theme = signal<UiTheme>(this.readTheme());
  readonly density = signal<UiDensity>(this.readDensity());

  constructor() {
    effect(() => {
      this.document.documentElement.setAttribute('data-theme', this.theme());
      this.store(THEME_STORAGE_KEY, this.theme());
    });

    effect(() => {
      const density = this.density();
      if (density === DEFAULT_DENSITY) {
        this.document.documentElement.removeAttribute('data-density');
      } else {
        this.document.documentElement.setAttribute('data-density', density);
      }
      this.store(DENSITY_STORAGE_KEY, density);
    });

    const storedLang = this.readStored(LANG_STORAGE_KEY);
    this.transloco.setActiveLang(
      storedLang === 'bg' || storedLang === 'en' ? storedLang : DEFAULT_LANG,
    );
    this.document.documentElement.lang = this.transloco.getActiveLang();
    this.transloco.langChanges$.subscribe((lang) => {
      this.document.documentElement.lang = lang;
      this.store(LANG_STORAGE_KEY, lang);
    });
  }

  setTheme(theme: UiTheme): void {
    this.theme.set(theme);
  }

  setDensity(density: UiDensity): void {
    this.density.set(density);
  }

  private readTheme(): UiTheme {
    const stored = this.readStored(THEME_STORAGE_KEY);
    if (stored === 'light' || stored === 'dark') return stored;
    const prefersLight = this.matchMediaSafe(
      '(prefers-color-scheme: light)',
    )?.matches;
    return prefersLight ? 'light' : DEFAULT_THEME;
  }

  private readDensity(): UiDensity {
    const stored = this.readStored(DENSITY_STORAGE_KEY);
    return stored === 'compact' || stored === 'regular' || stored === 'spacious'
      ? stored
      : DEFAULT_DENSITY;
  }

  private matchMediaSafe(query: string): MediaQueryList | undefined {
    return typeof this.window?.matchMedia === 'function'
      ? this.window.matchMedia(query)
      : undefined;
  }

  private readStored(key: string): string | null {
    try {
      return typeof this.window?.localStorage?.getItem === 'function'
        ? this.window.localStorage.getItem(key)
        : null;
    } catch {
      return null;
    }
  }

  private store(key: string, value: string): void {
    try {
      this.window?.localStorage?.setItem?.(key, value);
    } catch {
      // non-critical persistence — ignore (SSR shim / privacy mode)
    }
  }
}
