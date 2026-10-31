import { TestBed } from '@angular/core/testing';
import { TranslocoTestingModule } from '@jsverse/transloco';
import { ThemeService } from '@creativo/ui/theme';
import { DEFAULT_LOCALE } from '@creativo/infrastructure/i18n';
import {
  DEFAULT_LANG,
  DENSITY_STORAGE_KEY,
  LANG_STORAGE_KEY,
  THEME_STORAGE_KEY,
} from '@creativo/ui/tokens';
import { AppChromeService } from './app-chrome.service';

type Listener = (event: MediaQueryListEvent) => void;

/** A system appearance the spec flips (jsdom ships no `matchMedia`). */
function stubSystemAppearance(light: boolean) {
  const listeners = new Set<Listener>();
  Object.defineProperty(document.defaultView as Window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches: query === '(prefers-color-scheme: light)' && light,
      media: query,
      addEventListener: (_: string, listener: Listener) =>
        listeners.add(listener),
      removeEventListener: (_: string, listener: Listener) =>
        listeners.delete(listener),
    }),
  });
  return {
    change(next: boolean) {
      for (const listener of [...listeners]) {
        listener({ matches: next } as MediaQueryListEvent);
      }
    },
  };
}

function boot(): AppChromeService {
  TestBed.configureTestingModule({
    imports: [
      TranslocoTestingModule.forRoot({
        langs: { bg: {}, en: {} },
        translocoConfig: { availableLangs: ['bg', 'en'], defaultLang: 'bg' },
      }),
    ],
  });
  const chrome = TestBed.inject(AppChromeService);
  TestBed.tick();
  return chrome;
}

/**
 * The post-bootstrap half of the pre-paint contract keeps density and the
 * language; the theme has one writer, `ThemeService` (OR-47), which this
 * service only starts.
 */
describe('AppChromeService', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.setAttribute('data-theme', 'light');
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
    document.documentElement.removeAttribute('data-density');
    Reflect.deleteProperty(document.defaultView as Window, 'matchMedia');
  });

  test('pre-paints the app’s default language — the tokens’ copy is the i18n setup’s', () => {
    // `@creativo/ui/tokens` cannot import the i18n lib (type:tokens), so it
    // keeps its own copy for the pre-paint script; this pins the two.
    expect(DEFAULT_LANG).toBe(DEFAULT_LOCALE);
  });

  test('boots without saving a theme, and leaves the stamped one in place', () => {
    stubSystemAppearance(true);

    boot();

    // The live gap: the first effect run saved the resolved theme and froze
    // the system setting for every later visit.
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  test('starts the theme writer, so a page with no toggle follows the system', () => {
    const system = stubSystemAppearance(true);
    boot();

    system.change(false);

    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(TestBed.inject(ThemeService).theme()).toBe('dark');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
  });

  test('keeps restoring the stored density and language', () => {
    localStorage.setItem(DENSITY_STORAGE_KEY, 'compact');
    localStorage.setItem(LANG_STORAGE_KEY, 'en');

    const chrome = boot();

    expect(chrome.density()).toBe('compact');
    expect(document.documentElement.getAttribute('data-density')).toBe(
      'compact',
    );
    expect(document.documentElement.lang).toBe('en');
  });
});
