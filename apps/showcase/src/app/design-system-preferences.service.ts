import { DOCUMENT } from '@angular/common';
import { Injectable, effect, inject, signal } from '@angular/core';
import type { UiDensity, UiTheme } from '@creativo/ui/tokens';

const THEME_KEY = 'showcase-theme';
const DENSITY_KEY = 'showcase-density';

/** Drives `data-theme`/`data-density` on `<html>` for the new sys-* design system (§3, §3.1). */
@Injectable({ providedIn: 'root' })
export class DesignSystemPreferences {
  private readonly document = inject(DOCUMENT);
  private readonly window = this.document.defaultView;

  readonly theme = signal<UiTheme>(this.readTheme());
  readonly density = signal<UiDensity>(this.readDensity());

  constructor() {
    effect(() => {
      const theme = this.theme();
      this.document.documentElement.setAttribute('data-theme', theme);
      this.store(THEME_KEY, theme);
    });

    effect(() => {
      const density = this.density();
      if (density === 'regular') {
        this.document.documentElement.removeAttribute('data-density');
      } else {
        this.document.documentElement.setAttribute('data-density', density);
      }
      this.store(DENSITY_KEY, density);
    });
  }

  toggleTheme(): void {
    this.theme.set(this.theme() === 'dark' ? 'light' : 'dark');
  }

  setDensity(density: UiDensity): void {
    this.density.set(density);
  }

  private readTheme(): UiTheme {
    const stored = this.readStored(THEME_KEY);
    if (stored === 'light' || stored === 'dark') return stored;
    const prefersLight = this.matchMediaSafe(
      '(prefers-color-scheme: light)',
    )?.matches;
    return prefersLight ? 'light' : 'dark';
  }

  private readDensity(): UiDensity {
    const stored = this.readStored(DENSITY_KEY);
    if (stored === 'compact' || stored === 'regular' || stored === 'spacious') {
      return stored;
    }
    return 'regular';
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
