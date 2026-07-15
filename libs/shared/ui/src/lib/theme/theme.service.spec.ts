import { TestBed } from '@angular/core/testing';
import { ThemeService } from './theme.service';

describe('ThemeService', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
  });

  it('defaults to dark when there is no stored preference and the OS does not explicitly prefer light', () => {
    const service = TestBed.inject(ThemeService);
    TestBed.flushEffects();
    expect(service.theme()).toBe('dark');
    expect(document.documentElement.dataset['theme']).toBe('dark');
  });

  it('defaults to light when the OS explicitly prefers light', () => {
    const original = window.matchMedia;
    window.matchMedia = ((query: string) =>
      ({
        matches: query.includes('light'),
        media: query,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      }) as MediaQueryList) as typeof window.matchMedia;

    const service = TestBed.inject(ThemeService);
    TestBed.flushEffects();
    expect(service.theme()).toBe('light');

    window.matchMedia = original;
  });

  it('persists the theme to localStorage and toggles the DOM data-theme attribute', () => {
    const service = TestBed.inject(ThemeService);
    TestBed.flushEffects();
    expect(service.theme()).toBe('dark');

    service.toggle();
    TestBed.flushEffects();
    expect(service.theme()).toBe('light');
    expect(document.documentElement.dataset['theme']).toBe('light');
    expect(localStorage.getItem('cr-theme')).toBe('light');

    service.toggle();
    TestBed.flushEffects();
    expect(service.theme()).toBe('dark');
    expect(localStorage.getItem('cr-theme')).toBe('dark');
  });

  it('reads a previously stored theme on initialization', () => {
    localStorage.setItem('cr-theme', 'light');
    const service = TestBed.inject(ThemeService);
    expect(service.theme()).toBe('light');
  });
});
