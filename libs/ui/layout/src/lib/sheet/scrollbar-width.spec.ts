import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { UiScrollbarWidth } from './scrollbar-width';

/** A ResizeObserver the case drives by hand. */
class FakeResizeObserver {
  static last: FakeResizeObserver | null = null;
  constructor(readonly callback: ResizeObserverCallback) {
    FakeResizeObserver.last = this;
  }
  observed = false;
  observe(): void {
    this.observed = true;
  }
  disconnect(): void {
    this.observed = false;
  }
  report(width: number): void {
    this.callback(
      [{ contentRect: { width } } as ResizeObserverEntry],
      this as unknown as ResizeObserver,
    );
  }
}

describe('UiScrollbarWidth', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.style.overflow = '';
    FakeResizeObserver.last = null;
  });

  it('measures once, as the lock did, before anything was observed', () => {
    vi.stubGlobal('ResizeObserver', undefined);
    const expected = Math.max(
      0,
      window.innerWidth - document.documentElement.clientWidth,
    );
    expect(TestBed.inject(UiScrollbarWidth).width()).toBe(expected);
  });

  it('answers from the observer, and ignores a reading taken while a lock holds the scrollbar away', () => {
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
    const scrollbar = TestBed.inject(UiScrollbarWidth);
    const observer = FakeResizeObserver.last as FakeResizeObserver;
    expect(observer.observed).toBe(true);

    observer.report(window.innerWidth - 15);
    expect(scrollbar.width()).toBe(15);

    // Locked: the root grows by the scrollbar it lost; that is not news.
    document.body.style.overflow = 'hidden';
    observer.report(window.innerWidth);
    expect(scrollbar.width()).toBe(15);

    // Unlocked, a window without a classic scrollbar says 0.
    document.body.style.overflow = '';
    observer.report(window.innerWidth);
    expect(scrollbar.width()).toBe(0);
  });
});
