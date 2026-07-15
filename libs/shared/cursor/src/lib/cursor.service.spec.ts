import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CursorService } from './cursor.service';

function mockMatchMedia(overrides: Partial<Record<string, boolean>>) {
  const listeners = new Map<
    string,
    Set<(event: MediaQueryListEvent) => void>
  >();

  window.matchMedia = vi.fn((query: string) => {
    const mql = {
      matches: overrides[query] ?? false,
      media: query,
      onchange: null,
      addEventListener: (
        _type: string,
        callback: (event: MediaQueryListEvent) => void,
      ) => {
        if (!listeners.has(query)) listeners.set(query, new Set());
        listeners.get(query)?.add(callback);
      },
      removeEventListener: (
        _type: string,
        callback: (event: MediaQueryListEvent) => void,
      ) => {
        listeners.get(query)?.delete(callback);
      },
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    } as unknown as MediaQueryList;
    return mql;
  }) as unknown as typeof window.matchMedia;

  return {
    trigger(query: string, matches: boolean) {
      listeners
        .get(query)
        ?.forEach((callback) => callback({ matches } as MediaQueryListEvent));
    },
  };
}

describe('CursorService', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('is enabled by default when neither reduced-motion nor a coarse pointer is present', () => {
    mockMatchMedia({});
    const service = TestBed.inject(CursorService);
    expect(service.isEnabled()).toBe(true);
  });

  it('is disabled when the OS requests reduced motion', () => {
    mockMatchMedia({ '(prefers-reduced-motion: reduce)': true });
    const service = TestBed.inject(CursorService);
    expect(service.isEnabled()).toBe(false);
  });

  it('is disabled on a coarse (touch) pointer', () => {
    mockMatchMedia({ '(pointer: coarse)': true });
    const service = TestBed.inject(CursorService);
    expect(service.isEnabled()).toBe(false);
  });

  it('reacts live to a reduced-motion preference change, without requiring a reload', () => {
    const media = mockMatchMedia({});
    const service = TestBed.inject(CursorService);
    expect(service.isEnabled()).toBe(true);

    media.trigger('(prefers-reduced-motion: reduce)', true);
    expect(service.isEnabled()).toBe(false);

    media.trigger('(prefers-reduced-motion: reduce)', false);
    expect(service.isEnabled()).toBe(true);
  });

  it('has no active cursor target by default, and can be set/cleared', () => {
    mockMatchMedia({});
    const service = TestBed.inject(CursorService);
    expect(service.activeTarget()).toBeNull();

    const element = document.createElement('button');
    service.activeTarget.set({ element, style: 'fill' });
    expect(service.activeTarget()).toEqual({ element, style: 'fill' });

    service.activeTarget.set(null);
    expect(service.activeTarget()).toBeNull();
  });
});
