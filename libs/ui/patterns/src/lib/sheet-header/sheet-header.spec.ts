import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
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

/**
 * The shell's real nesting: the bar inside a sticky chrome wrapper, the
 * scroller inside a surface that clips, inside a page that scrolls too.
 * The bar must find the NEAREST scroller: past the wrapper and the clip,
 * never as far as the page.
 */
@Component({
  imports: [UiSheetHeader],
  template: `<div data-testid="page" style="overflow-y: scroll">
    <div data-testid="surface" style="overflow-y: hidden">
      <div data-testid="scroller" style="overflow-y: auto">
        <div data-testid="chrome" style="overflow-y: clip">
          <ui-sheet-header data-testid="header">
            <div uiTitle>Compact title</div>
          </ui-sheet-header>
        </div>
        <h2 uiSheetLargeTitle>Large title</h2>
      </div>
    </div>
  </div>`,
})
class NestedHostComponent {}

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

    // The walk is `nearestScroller` (ui/layout), the one the visits browser
    // shares; it moved up from this component, and answers as it did.
    it('finds its scroller with the shared walk: past a wrapper and a clip, never as far as the page', async () => {
      const nested = TestBed.createComponent(NestedHostComponent);
      nested.detectChanges();
      await nested.whenStable();
      const root: HTMLElement = nested.nativeElement;

      const observer = FakeIntersectionObserver.instances.at(-1);
      expect(observer?.root).toBe(
        root.querySelector('[data-testid="scroller"]'),
      );
      expect(observer?.observed).toEqual([
        root.querySelector('[uiSheetLargeTitle]'),
      ]);

      // Collapse follows that scroller's sentinel, as on the flat host.
      observer?.emit({
        isIntersecting: false,
        boundingClientRect: { bottom: 0 } as DOMRectReadOnly,
        rootBounds: { top: 52 } as DOMRectReadOnly,
      });
      nested.detectChanges();
      expect(
        root
          .querySelector('[data-testid="header"]')
          ?.hasAttribute('data-collapsed'),
      ).toBe(true);
    });

    it('stays at rest where nothing above it scrolls: the page does, and the owner drives the bar', async () => {
      const scroller: HTMLElement = fixture.nativeElement.querySelector(
        '[data-testid="scroller"]',
      );
      scroller.style.overflowY = 'visible';
      const before = FakeIntersectionObserver.instances.length;
      fixture.detectChanges();
      await fixture.whenStable();
      expect(FakeIntersectionObserver.instances).toHaveLength(before);
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

/*
 * THE COLLAPSE, ONE TIMELINE (2026-09-28). jsdom runs no scroll-driven
 * animation, so the cross-fade is held where it is written: the timeline's
 * inset, the three ranges on it, and the keyframes they name. Playwright
 * measures the pixels (the wave-D sweep); these keep the numbers from
 * drifting apart again — the fade flipping at the bar's bottom while the
 * compact title followed the scroller's top is how the big name came to
 * ghost behind the chips.
 */
describe('sheet-header.css · the collapse', () => {
  const css = readFileSync(resolve(__dirname, 'sheet-header.css'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\s+/g, ' ')
    .replace(/\(\s/g, '(')
    .replace(/\s\)/g, ')');

  /** The body of the first block whose prelude is exactly `prelude`. */
  function block(source: string, prelude: string): string {
    const escaped = prelude.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // eslint-disable-next-line security/detect-non-literal-regexp -- an escaped selector from this spec, over the DS's own stylesheet.
    const head = new RegExp(`(?:^|[{};])\\s*${escaped}\\s*\\{`).exec(source);
    if (!head) throw new Error(`no block «${prelude}» in sheet-header.css`);
    const open = head.index + head[0].length;
    let depth = 1;
    for (let at = open; at < source.length; at += 1) {
      if (source.charAt(at) === '{') depth += 1;
      if (source.charAt(at) === '}' && (depth -= 1) === 0) {
        return source.slice(open, at);
      }
    }
    throw new Error(`unclosed block «${prelude}» in sheet-header.css`);
  }

  /** A leaf block's declarations, by property. */
  function declarations(body: string): Map<string, string> {
    const found = new Map<string, string>();
    for (const declaration of body.split(';')) {
      const colon = declaration.indexOf(':');
      if (colon < 0) continue;
      found.set(
        declaration.slice(0, colon).trim(),
        declaration.slice(colon + 1).trim(),
      );
    }
    return found;
  }

  const layer = block(css, '@layer sys-components');
  const scrollLinked = block(
    block(layer, '@supports (animation-timeline: view())'),
    '@media (prefers-reduced-motion: no-preference)',
  );
  const scrollLinkedRule = (selector: string) =>
    declarations(block(scrollLinked, selector));

  it('names the timeline on the large title and insets it to the bar’s bottom edge', () => {
    const title = declarations(block(layer, '[uisheetlargetitle]'));
    expect(title.get('view-timeline-name')).toBe('--ui-sheet-headline');
    expect(title.get('view-timeline-inset')).toBe(
      'var(--modal-sheet-chrome-height, var(--control-size-large)) auto',
    );
  });

  it('wraps every large title in balanced lines and never cuts it (wave D r5: «Минали сезони и» / «събития»)', () => {
    const title = declarations(block(layer, '[uisheetlargetitle]'));
    expect(title.get('text-wrap')).toBe('balance');
    expect(title.get('overflow-wrap')).toBe('break-word');
  });

  it('fades the large title and the headline’s face out over the first half of the exit', () => {
    const out = scrollLinkedRule(
      '[uisheetlargetitle], .ui-sheet-headline[data-media] .ui-sheet-headline__media',
    );
    expect(out.get('animation')).toBe('ui-sheet-headline-out linear both');
    expect(out.get('animation-timeline')).toBe('--ui-sheet-headline');
    expect(out.get('animation-range')).toBe('exit 0% exit 50%');
  });

  it('brings the compact title in over the second half, so two names never show at once', () => {
    const compact = scrollLinkedRule('.ui-sheet-header > [uititle]');
    expect(compact.get('animation')).toBe(
      'ui-sheet-header-title-in linear both',
    );
    expect(compact.get('animation-timeline')).toBe('--ui-sheet-headline');
    expect(compact.get('animation-range')).toBe('exit 50% exit 100%');
  });

  it('lands the non-modal bar across the whole exit', () => {
    const bar = scrollLinkedRule('.ui-sheet-header');
    expect(bar.get('animation')).toBe('ui-sheet-header-chrome-in linear both');
    expect(bar.get('animation-timeline')).toBe('--ui-sheet-headline');
    expect(bar.get('animation-range')).toBe('exit 0% exit 100%');
    // Inside the modal shell the bar's own chrome stays off: the fade owns it.
    expect(
      declarations(
        block(
          layer,
          '.modal-sheet__chrome .ui-sheet-header, .modal-sheet__chrome .ui-sheet-header[data-collapsed], .modal-sheet__chrome .ui-sheet-header:has(> [uititle][data-visible])',
        ),
      ).get('animation'),
    ).toBe('none');
  });

  it('defines every keyframe the ranges name, the exit fading 1 → 0', () => {
    const out = block(layer, '@keyframes ui-sheet-headline-out');
    expect(declarations(block(out, 'from')).get('opacity')).toBe('1');
    expect(declarations(block(out, 'to')).get('opacity')).toBe('0');
    const titleIn = block(layer, '@keyframes ui-sheet-header-title-in');
    expect(declarations(block(titleIn, 'from')).get('opacity')).toBe('0');
    expect(declarations(block(titleIn, 'to')).get('opacity')).toBe('1');
    expect(block(layer, '@keyframes ui-sheet-header-chrome-in')).toContain(
      'background-color: var(--sys-color-surface)',
    );
  });
});
