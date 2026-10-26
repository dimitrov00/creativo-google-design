import { DOCUMENT } from '@angular/common';
import { Injectable, effect, inject, signal } from '@angular/core';
import { TranslocoService } from '@jsverse/transloco';
import { Locale, Tag } from '@core/primitives';
import { ThemeService } from '@creativo/ui/theme';
import {
  DEFAULT_DENSITY,
  DEFAULT_LANG,
  DENSITY_STORAGE_KEY,
  LANG_STORAGE_KEY,
  UI_DENSITIES,
  UiDensity,
} from '@creativo/ui/tokens';

/**
 * Post-bootstrap counterpart to `index.html`'s pre-paint script (blueprint
 * §7.6) — reads the SAME storage keys so the attributes it stamps on
 * `<html>` agree with what pre-paint already set (no flash), then keeps
 * them reactive for the rest of the session (e.g. a future preferences
 * toggle can just write these signals).
 *
 * The theme is not stamped here: `ThemeService` is its one writer (OR-47)
 * and saves only an explicit choice. It is started at boot so its system
 * listener follows the appearance on every page, not only the pages whose
 * toggle happens to inject it — from `@creativo/ui/theme`, an entry of its
 * own: through the `@creativo/ui/controls` barrel it dragged 530 kB into
 * the initial chunk.
 */
@Injectable({ providedIn: 'root' })
export class AppChromeService {
  private readonly document = inject(DOCUMENT);
  private readonly window = this.document.defaultView;
  private readonly transloco = inject(TranslocoService);

  readonly density = signal<UiDensity>(this.readDensity());

  constructor() {
    inject(ThemeService);

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
    this.transloco.setActiveLang(Tag.or(Locale, storedLang, DEFAULT_LANG));
    this.document.documentElement.lang = this.transloco.getActiveLang();
    this.transloco.langChanges$.subscribe((lang) => {
      this.document.documentElement.lang = lang;
      this.store(LANG_STORAGE_KEY, lang);
    });
  }

  setDensity(density: UiDensity): void {
    this.density.set(density);
  }

  private readDensity(): UiDensity {
    const stored = this.readStored(DENSITY_STORAGE_KEY);
    return (
      UI_DENSITIES.find((candidate) => candidate === stored) ?? DEFAULT_DENSITY
    );
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
