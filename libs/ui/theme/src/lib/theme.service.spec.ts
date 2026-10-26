import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_THEME,
  META_THEME_COLOR,
  THEME_STORAGE_KEY,
} from '@creativo/ui/tokens';
import { ThemeService } from './theme.service';

const SYSTEM_LIGHT = '(prefers-color-scheme: light)';
const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';

type Listener = (event: MediaQueryListEvent) => void;

/**
 * A `matchMedia` the spec drives (jsdom ships none): the system appearance,
 * with the listeners the service registered on it, and the motion setting.
 */
function stubMatchMedia(systemLight: boolean, reducedMotion = false) {
  const listeners = new Set<Listener>();
  const system = {
    matches: systemLight,
    media: SYSTEM_LIGHT,
    addEventListener: (_: string, listener: Listener) =>
      listeners.add(listener),
    removeEventListener: (_: string, listener: Listener) =>
      listeners.delete(listener),
  };
  Object.defineProperty(document.defaultView as Window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string) =>
      query === SYSTEM_LIGHT
        ? system
        : { matches: query === REDUCED_MOTION && reducedMotion, media: query },
  });
  return {
    listeners,
    change(light: boolean) {
      system.matches = light;
      for (const listener of [...listeners]) {
        listener({ matches: light } as MediaQueryListEvent);
      }
    },
  };
}

/** A `startViewTransition` that runs the update at once and counts skips. */
function stubViewTransition() {
  const skipTransition = vi.fn();
  const startViewTransition = vi.fn((update: () => void) => {
    update();
    return { skipTransition };
  });
  Object.defineProperty(document, 'startViewTransition', {
    configurable: true,
    writable: true,
    value: startViewTransition,
  });
  return { startViewTransition, skipTransition };
}

/** What the pre-paint script stamped before Angular ran. */
function stamp(theme: string | null): void {
  if (theme === null) document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', theme);
}

const stored = (): string | null => localStorage.getItem(THEME_STORAGE_KEY);
const attribute = (): string | null =>
  document.documentElement.getAttribute('data-theme');
const metaColor = (): string | null =>
  document.querySelector('meta[name="theme-color"]')?.getAttribute('content') ??
  null;

const boot = (): ThemeService => TestBed.inject(ThemeService);

beforeEach(() => {
  localStorage.clear();
  const meta = document.createElement('meta');
  meta.name = 'theme-color';
  meta.content = META_THEME_COLOR.dark;
  document.head.append(meta);
});

afterEach(() => {
  TestBed.resetTestingModule();
  vi.restoreAllMocks();
  localStorage.clear();
  stamp(null);
  document.querySelector('meta[name="theme-color"]')?.remove();
  Reflect.deleteProperty(document.defaultView as Window, 'matchMedia');
  Reflect.deleteProperty(document, 'startViewTransition');
});

describe('ThemeService — boot', () => {
  it('reads the theme the pre-paint script stamped', () => {
    stamp('light');
    expect(boot().theme()).toBe('light');
  });

  it('falls back to the tokens’ default where nothing valid was stamped', () => {
    stamp(null);
    expect(boot().theme()).toBe(DEFAULT_THEME);
    TestBed.resetTestingModule();
    stamp('sepia');
    expect(boot().theme()).toBe(DEFAULT_THEME);
  });

  it('writes nothing to storage, and leaves the stamped page alone', () => {
    stubMatchMedia(true);
    stamp('light');
    const setItem = vi.spyOn(Storage.prototype, 'setItem');

    boot();

    // The live gap OR-47 closes: a first visit saved the resolved theme and
    // froze the system setting forever.
    expect(setItem).not.toHaveBeenCalled();
    expect(stored()).toBeNull();
    expect(attribute()).toBe('light');
    expect(metaColor()).toBe(META_THEME_COLOR.dark);
  });
});

describe('ThemeService — an explicit choice', () => {
  it('saves a toggle, and paints the attribute and the meta colour from the tokens', () => {
    stamp('dark');
    const theme = boot();

    theme.toggle();

    expect(stored()).toBe('light');
    expect(theme.theme()).toBe('light');
    expect(attribute()).toBe('light');
    expect(metaColor()).toBe(META_THEME_COLOR.light);

    theme.toggle();

    expect(stored()).toBe('dark');
    expect(attribute()).toBe('dark');
    expect(metaColor()).toBe(META_THEME_COLOR.dark);
  });

  it('saves a set theme', () => {
    stamp('dark');
    boot().set('light');
    expect(stored()).toBe('light');
  });

  it('still paints when storage refuses to keep the choice', () => {
    stamp('dark');
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    const theme = boot();

    theme.set('light');

    expect(theme.theme()).toBe('light');
    expect(attribute()).toBe('light');
  });
});

describe('ThemeService — the system appearance', () => {
  it('follows a system change before any choice, without saving it', () => {
    const system = stubMatchMedia(false);
    stamp('dark');
    const theme = boot();

    system.change(true);

    expect(theme.theme()).toBe('light');
    expect(attribute()).toBe('light');
    expect(metaColor()).toBe(META_THEME_COLOR.light);
    expect(stored()).toBeNull();

    system.change(false);

    expect(theme.theme()).toBe('dark');
    expect(stored()).toBeNull();
  });

  it('stops following once the visitor toggles', () => {
    const system = stubMatchMedia(false);
    stamp('dark');
    const theme = boot();

    theme.toggle();
    system.change(false);

    expect(theme.theme()).toBe('light');
    expect(attribute()).toBe('light');
  });

  it('ignores the system while an earlier visit’s choice is stored', () => {
    const system = stubMatchMedia(true);
    localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    stamp('dark');
    const theme = boot();

    system.change(true);

    expect(theme.theme()).toBe('dark');
    expect(attribute()).toBe('dark');
  });

  it('follows the system past a stored value the pre-paint script ignores', () => {
    const system = stubMatchMedia(false);
    localStorage.setItem(THEME_STORAGE_KEY, 'sepia');
    stamp('dark');
    const theme = boot();

    system.change(true);

    expect(theme.theme()).toBe('light');
  });

  it('keeps a choice storage refused when the system changes after it', () => {
    const system = stubMatchMedia(false);
    stamp('dark');
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    const theme = boot();

    theme.set('light');
    system.change(false);

    expect(theme.theme()).toBe('light');
  });

  it('lets go of the system listener when the app is torn down', () => {
    const system = stubMatchMedia(false);
    boot();
    expect(system.listeners.size).toBe(1);

    TestBed.resetTestingModule();

    expect(system.listeners.size).toBe(0);
  });
});

describe('ThemeService — the crossfade', () => {
  it('switches inside one view transition, and skips it under reduced motion', () => {
    stubMatchMedia(false, true);
    const { startViewTransition, skipTransition } = stubViewTransition();
    stamp('dark');

    boot().toggle();

    expect(startViewTransition).toHaveBeenCalledTimes(1);
    expect(skipTransition).toHaveBeenCalledTimes(1);
    expect(attribute()).toBe('light');
  });

  it('keeps the transition when motion is allowed', () => {
    stubMatchMedia(false, false);
    const { startViewTransition, skipTransition } = stubViewTransition();
    stamp('dark');

    boot().toggle();

    expect(startViewTransition).toHaveBeenCalledTimes(1);
    expect(skipTransition).not.toHaveBeenCalled();
  });

  it('crossfades a followed system change the same way', () => {
    const system = stubMatchMedia(false, true);
    const { startViewTransition, skipTransition } = stubViewTransition();
    stamp('dark');
    boot();

    system.change(true);

    expect(startViewTransition).toHaveBeenCalledTimes(1);
    expect(skipTransition).toHaveBeenCalledTimes(1);
    expect(attribute()).toBe('light');
  });
});
