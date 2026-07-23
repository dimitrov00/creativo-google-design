import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { UiSheetHeader } from './sheet-header';

/**
 * Minimal IntersectionObserver double — jsdom has none, and the collapse
 * behavior only needs `observe` + the constructor-captured callback.
 */
class FakeIntersectionObserver implements IntersectionObserver {
  static instances: FakeIntersectionObserver[] = [];

  readonly root: Element | Document | null;
  readonly rootMargin: string;
  readonly scrollMargin: string = '0px';
  readonly thresholds: readonly number[] = [0];
  readonly observed: Element[] = [];

  constructor(
    readonly callback: IntersectionObserverCallback,
    options?: IntersectionObserverInit,
  ) {
    this.root = options?.root ?? null;
    this.rootMargin = options?.rootMargin ?? '0px';
    FakeIntersectionObserver.instances.push(this);
  }

  observe(target: Element): void {
    this.observed.push(target);
  }
  disconnect(): void {
    this.observed.length = 0;
  }
  unobserve(target: Element): void {
    this.observed.splice(this.observed.indexOf(target), 1);
  }
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }

  emit(entry: Partial<IntersectionObserverEntry>): void {
    this.callback([entry as IntersectionObserverEntry], this);
  }
}

@Component({
  imports: [UiSheetHeader],
  // Inline overflow style so jsdom's getComputedStyle reports a scroll
  // container — the header's scroller discovery walks computed overflow-y.
  template: `<div data-testid="scroller" style="overflow-y: auto">
    <ui-sheet-header data-testid="header" [uiCollapsed]="collapsed()">
      <div uiTitle>Compact title</div>
      <button uiTrailing type="button">Close</button>
    </ui-sheet-header>
    @if (showSentinel()) {
      <h2 uiSheetLargeTitle>Large title</h2>
    }
  </div>`,
})
class HostComponent {
  readonly collapsed = signal<boolean | undefined>(undefined);
  readonly showSentinel = signal(true);
}

describe('UiSheetHeader', () => {
  let fixture: ComponentFixture<HostComponent>;

  beforeEach(async () => {
    FakeIntersectionObserver.instances = [];
    await TestBed.configureTestingModule({
      imports: [HostComponent],
    }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const header = (): HTMLElement =>
    fixture.nativeElement.querySelector('[data-testid="header"]');

  it('stamps the host class and renders the grabber as hidden decoration', async () => {
    fixture.detectChanges();
    await fixture.whenStable();
    const el = header();
    expect(el.classList.contains('ui-sheet-header')).toBe(true);
    const grabber = el.querySelector('.ui-sheet-header__grabber');
    expect(grabber).not.toBeNull();
    expect(grabber?.getAttribute('aria-hidden')).toBe('true');
  });

  it('projects the [uiTitle] and [uiTrailing] slots as direct children', async () => {
    fixture.detectChanges();
    await fixture.whenStable();
    const el = header();
    const title = el.querySelector(':scope > [uiTitle]');
    const trailing = el.querySelector(':scope > [uiTrailing]');
    expect(title?.textContent).toBe('Compact title');
    expect(trailing?.textContent).toBe('Close');
  });

  it('rests uncollapsed without IntersectionObserver support (jsdom guard)', async () => {
    fixture.detectChanges();
    await fixture.whenStable();
    expect(header().hasAttribute('data-collapsed')).toBe(false);
  });

  it('lets the uiCollapsed input drive data-collapsed outright', async () => {
    fixture.detectChanges();
    await fixture.whenStable();

    fixture.componentInstance.collapsed.set(true);
    fixture.detectChanges();
    expect(header().hasAttribute('data-collapsed')).toBe(true);

    fixture.componentInstance.collapsed.set(false);
    fixture.detectChanges();
    expect(header().hasAttribute('data-collapsed')).toBe(false);
  });

  describe('sentinel observation', () => {
    beforeEach(() => {
      vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);
    });

    it('observes the uiSheetLargeTitle sentinel inside the nearest scroller, minus the bar height', async () => {
      fixture.detectChanges();
      await fixture.whenStable();

      const observer = FakeIntersectionObserver.instances.at(-1);
      expect(observer).toBeDefined();
      expect(observer?.observed).toEqual([
        fixture.nativeElement.querySelector('[uiSheetLargeTitle]'),
      ]);
      expect(observer?.root).toBe(
        fixture.nativeElement.querySelector('[data-testid="scroller"]'),
      );
      // Top rootMargin subtracts the sticky bar so the crossing means
      // "slid under the bar" (0px here — jsdom boxes have no layout).
      expect(observer?.rootMargin).toMatch(/^-\d+px 0px 0px 0px$/);
    });

    it('collapses when the large title exits above the bar and expands when it returns', async () => {
      fixture.detectChanges();
      await fixture.whenStable();
      const observer = FakeIntersectionObserver.instances.at(-1);

      observer?.emit({
        isIntersecting: false,
        boundingClientRect: { bottom: 0 } as DOMRectReadOnly,
        rootBounds: { top: 52 } as DOMRectReadOnly,
      });
      fixture.detectChanges();
      expect(header().hasAttribute('data-collapsed')).toBe(true);

      observer?.emit({
        isIntersecting: true,
        boundingClientRect: { bottom: 300 } as DOMRectReadOnly,
        rootBounds: { top: 52 } as DOMRectReadOnly,
      });
      fixture.detectChanges();
      expect(header().hasAttribute('data-collapsed')).toBe(false);
    });

    it('ignores exits below the bar (scrolled past the end, not under the chrome)', async () => {
      fixture.detectChanges();
      await fixture.whenStable();
      const observer = FakeIntersectionObserver.instances.at(-1);

      observer?.emit({
        isIntersecting: false,
        boundingClientRect: { bottom: 900 } as DOMRectReadOnly,
        rootBounds: { top: 52 } as DOMRectReadOnly,
      });
      fixture.detectChanges();
      expect(header().hasAttribute('data-collapsed')).toBe(false);
    });

    it('gives an explicit uiCollapsed input priority over observation', async () => {
      fixture.detectChanges();
      await fixture.whenStable();
      const observer = FakeIntersectionObserver.instances.at(-1);

      observer?.emit({
        isIntersecting: false,
        boundingClientRect: { bottom: 0 } as DOMRectReadOnly,
        rootBounds: { top: 52 } as DOMRectReadOnly,
      });
      fixture.componentInstance.collapsed.set(false);
      fixture.detectChanges();
      expect(header().hasAttribute('data-collapsed')).toBe(false);
    });

    it('falls back to scroll-position collapse when no sentinel is labelled', async () => {
      fixture.componentInstance.showSentinel.set(false);
      fixture.detectChanges();
      await fixture.whenStable();
      // The MutationObserver re-sync is async — flush it.
      await new Promise((resolve) => setTimeout(resolve));

      const scroller: HTMLElement = fixture.nativeElement.querySelector(
        '[data-testid="scroller"]',
      );
      Object.defineProperty(scroller, 'scrollTop', {
        configurable: true,
        value: 120,
      });
      scroller.dispatchEvent(new Event('scroll'));
      fixture.detectChanges();
      expect(header().hasAttribute('data-collapsed')).toBe(true);

      Object.defineProperty(scroller, 'scrollTop', {
        configurable: true,
        value: 0,
      });
      scroller.dispatchEvent(new Event('scroll'));
      fixture.detectChanges();
      expect(header().hasAttribute('data-collapsed')).toBe(false);
    });
  });
});
