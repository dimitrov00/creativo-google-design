import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { TestBed } from '@angular/core/testing';
import { UiModalSheet } from './modal-sheet';

describe('UiModalSheet', () => {
  it('provides one accessible shell contract for projected sheet content', async () => {
    await TestBed.configureTestingModule({
      imports: [UiModalSheet],
    }).compileComponents();

    const fixture = TestBed.createComponent(UiModalSheet);
    fixture.componentRef.setInput('sheetId', 'test-sheet');
    fixture.componentRef.setInput('labelledBy', 'test-title');
    fixture.componentRef.setInput('closeLabel', 'Close details');
    fixture.componentRef.setInput('open', true);
    fixture.detectChanges();
    await fixture.whenStable();
    const host: HTMLElement = fixture.nativeElement;

    expect(host.querySelector('#test-sheet[role="dialog"]')).not.toBeNull();
    expect(host.querySelector('[aria-labelledby="test-title"]')).not.toBeNull();
    expect(host.querySelector('.ui-sheet__surface')).not.toBeNull();
    expect(host.querySelector('.modal-sheet__scroll')).not.toBeNull();
    expect(
      host.querySelector('button[aria-label="Close details"]'),
    ).not.toBeNull();
  });

  describe('the chrome height the collapse timeline is inset by', () => {
    /** jsdom has no ResizeObserver; the shell only needs to be told once. */
    class FakeResizeObserver implements ResizeObserver {
      constructor(readonly callback: ResizeObserverCallback) {}
      observe(): void {
        this.callback([], this);
      }
      unobserve(): void {
        return;
      }
      disconnect(): void {
        return;
      }
    }

    beforeEach(() => {
      vi.stubGlobal('ResizeObserver', FakeResizeObserver);
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('publishes --modal-sheet-chrome-height on the scroller', async () => {
      await TestBed.configureTestingModule({
        imports: [UiModalSheet],
      }).compileComponents();
      const fixture = TestBed.createComponent(UiModalSheet);
      fixture.componentRef.setInput('sheetId', 'test-sheet');
      fixture.componentRef.setInput('labelledBy', 'test-title');
      fixture.componentRef.setInput('closeLabel', 'Close details');
      fixture.componentRef.setInput('open', true);
      fixture.detectChanges();
      await fixture.whenStable();

      const scroller: HTMLElement = fixture.nativeElement.querySelector(
        '.modal-sheet__scroll',
      );
      // jsdom boxes have no layout: the figure is 0, the contract is its name.
      expect(
        scroller.style.getPropertyValue('--modal-sheet-chrome-height'),
      ).toBe('0px');
    });
  });
});

/*
 * THE TOP FADE RIDES THE TITLE'S TIMELINE (2026-09-28). jsdom runs no
 * scroll-driven animation, so the contract is held where it is written — in
 * this shell's stylesheet and in the header's, whose ranges it must meet:
 * the fade is full exactly when the compact title is.
 */
describe('modal-sheet.css · the top fade', () => {
  /** A stylesheet as the cascade reads it: comments out, whitespace folded. */
  function stylesheet(path: string): string {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- the DS's own stylesheets.
    return readFileSync(path, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\s+/g, ' ')
      .replace(/\(\s/g, '(')
      .replace(/\s\)/g, ')');
  }

  /** The body of the first block whose prelude is exactly `prelude`. */
  function block(source: string, prelude: string): string {
    const escaped = prelude.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // eslint-disable-next-line security/detect-non-literal-regexp -- an escaped selector from this spec, over the DS's own stylesheet.
    const head = new RegExp(`(?:^|[{};])\\s*${escaped}\\s*\\{`).exec(source);
    if (!head) throw new Error(`no block «${prelude}»`);
    const open = head.index + head[0].length;
    let depth = 1;
    for (let at = open; at < source.length; at += 1) {
      if (source.charAt(at) === '{') depth += 1;
      if (source.charAt(at) === '}' && (depth -= 1) === 0) {
        return source.slice(open, at);
      }
    }
    throw new Error(`unclosed block «${prelude}»`);
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

  /** The scroll-linked branch: supporting engines, motion allowed. */
  const scrollLinked = (source: string): string =>
    block(
      block(source, '@supports (animation-timeline: view())'),
      '@media (prefers-reduced-motion: no-preference)',
    );

  const css = stylesheet(resolve(__dirname, 'modal-sheet.css'));
  const header = stylesheet(
    resolve(
      __dirname,
      '../../../../patterns/src/lib/sheet-header/sheet-header.css',
    ),
  );

  /** The declarations of the plain `.modal-sheet__scroll` block that sets `name`. */
  const scrollerPublishing = (name: string): Map<string, string> | undefined =>
    [...css.matchAll(/(?<=^|[{};])\s*\.modal-sheet__scroll\s*\{([^{}]*)\}/g)]
      .map((match) => declarations(match[1] as string))
      .find((found) => found.has(name));

  it('ramps the fade on the headline timeline across the whole exit', () => {
    const fade = declarations(
      block(scrollLinked(css), '.modal-sheet__chrome::before'),
    );
    expect(fade.get('animation')).toBe(
      'ui-modal-sheet-chrome-fade linear both',
    );
    expect(fade.get('animation-timeline')).toBe('--ui-sheet-headline');
    expect(fade.get('animation-range')).toBe('exit 0% exit 100%');

    const keyframes = block(css, '@keyframes ui-modal-sheet-chrome-fade');
    expect(declarations(block(keyframes, 'from')).get('opacity')).toBe('0');
    expect(declarations(block(keyframes, 'to')).get('opacity')).toBe('1');
  });

  it('is full the moment the compact title is, and the large title is gone before it arrives', () => {
    const fadeRange = declarations(
      block(scrollLinked(css), '.modal-sheet__chrome::before'),
    ).get('animation-range');
    const headerBody = scrollLinked(block(header, '@layer sys-components'));
    const compactRange = declarations(
      block(headerBody, '.ui-sheet-header > [uititle]'),
    ).get('animation-range');
    const largeRange = declarations(
      block(
        headerBody,
        '[uisheetlargetitle], .ui-sheet-headline[data-media] .ui-sheet-headline__media',
      ),
    ).get('animation-range');

    const [, fadeEnd] = fadeRange?.split(/ (?=exit)/) ?? [];
    const [compactStart, compactEnd] = compactRange?.split(/ (?=exit)/) ?? [];
    const [, largeEnd] = largeRange?.split(/ (?=exit)/) ?? [];
    expect(compactEnd).toBe(fadeEnd);
    expect(largeEnd).toBe(compactStart);
  });

  it('keeps the binary flips for engines without the timeline, off at rest', () => {
    expect(
      declarations(block(css, '.modal-sheet__chrome::before')).get('opacity'),
    ).toBe('0');
    expect(
      declarations(
        block(
          css,
          '.modal-sheet__chrome:has(.ui-sheet-header[data-collapsed])::before, .modal-sheet__chrome:has(.ui-sheet-header [uititle][data-visible])::before',
        ),
      ).get('opacity'),
    ).toBe('1');
  });

  // Wave D r5 (2026-09-28): forced on for an always-titled bar, the fade
  // veiled the photo viewer's picture at rest — its 3rem overhang over the
  // hero's top 30 pt, with nothing scrolled. The title shows from rest; the
  // fade waits for the header's any-scroll collapse, as on every page.
  it('never lays the fade over an always-titled page at rest: the title shows, the fade waits for a scroll', () => {
    expect(css).not.toMatch(/\[data-title-always\][^{]*::before/);
    expect(
      declarations(
        block(css, '.modal-sheet__toolbar[data-title-always] > [uititle]'),
      ).get('opacity'),
    ).toBe('1');
  });

  /** A `linear-gradient(...)`'s colour stops, the direction dropped. */
  function gradientStops(value: string): string[] {
    const inner = /^linear-gradient\((.*)\)$/.exec(value)?.[1] ?? '';
    const parts: string[] = [];
    let depth = 0;
    let start = 0;
    for (let at = 0; at < inner.length; at += 1) {
      const char = inner.charAt(at);
      if (char === '(') depth += 1;
      else if (char === ')') depth -= 1;
      else if (char === ',' && depth === 0) {
        parts.push(inner.slice(start, at).trim());
        start = at + 1;
      }
    }
    parts.push(inner.slice(start).trim());
    return parts.slice(1);
  }

  // Owner critique #1 (2026-09-28): spread over the bar AND the overhang,
  // the ramp was ≈40% at the bar's bottom edge, so at full fade a subline,
  // a capsule or a history row read through the ‹ ✕ chips and into the
  // compact title. The chrome's own box is the surface; the ramp starts at
  // its bottom edge.
  it('is the surface, solid, under the whole chrome — the ramp runs in the overhang only', () => {
    const fade = declarations(block(css, '.modal-sheet__chrome::before'));
    // The two lengths are the scroller's (the clear top reads them too);
    // the ::before inherits them and never redeclares them.
    expect(fade.has('--modal-sheet-fade-overhang')).toBe(false);
    expect(fade.has('--modal-sheet-fade-ramp')).toBe(false);
    const scroller = scrollerPublishing('--modal-sheet-fade-overhang');
    expect(scroller?.get('--modal-sheet-fade-overhang')).toBe('3rem');
    expect(scroller?.get('--modal-sheet-fade-ramp')).toBe('3rem');
    expect(fade.get('inset')).toBe(
      '0 0 calc(-1 * var(--modal-sheet-fade-overhang))',
    );
    const stops = gradientStops(fade.get('background') ?? '');
    expect(stops).toHaveLength(9);
    expect(stops[0]).toBe(
      'var(--sys-color-surface) calc(100% - var(--modal-sheet-fade-ramp))',
    );
    expect(stops.at(-1)).toBe('transparent 100%');
    // Every stop between sits INSIDE the ramp, none above the chrome's edge.
    for (const stop of stops.slice(1, -1)) {
      expect(stop).toMatch(
        /^color-mix\(in srgb, var\(--sys-color-surface\) \d+%, transparent\) calc\(100% - var\(--modal-sheet-fade-ramp\) \* 0\.\d+\)$/,
      );
    }
  });

  /**
   * The tight fade's rule: ONE rule, reached by a pinned section head and
   * by a body that asks for it. Its selectors, and its declarations.
   */
  function tightFade(): {
    readonly selectors: readonly string[];
    readonly variant: Map<string, string>;
  } {
    const found =
      /(?:^|[{};])\s*([^{};]*\[data-sheet-fade='tight'\][^{};]*)\{([^{}]*)\}/.exec(
        css,
      );
    if (!found) throw new Error('no rule names the tight fade');
    return {
      selectors: (found[1] as string).split(',').map((part) => part.trim()),
      variant: declarations(found[2] as string),
    };
  }

  it('keeps a pinned section head crisp: no overhang over it, the ramp inside the bar', () => {
    // On the scroller, so the clear top below it follows: nothing washes
    // under the chrome's edge there, so that edge IS the clear top.
    const { selectors, variant } = tightFade();
    expect(selectors).toContain(
      '.modal-sheet__scroll:has(.ui-section-header[data-pinned])',
    );
    expect(variant.get('--modal-sheet-fade-overhang')).toBe('0px');
    expect(variant.get('--modal-sheet-fade-ramp')).toBe(
      'var(--sys-space-compact)',
    );
  });

  // Revision 3 (F32): the wallet's bar has no large title, so it collapses
  // on the first pixel of scroll, and the 3rem overhang switched on over
  // the orange pass at once. A body whose first object is a coloured
  // surface asks for the pinned head's fade: `data-sheet-fade="tight"`.
  it('gives a body that asks for it the same tight fade: the rule’s second selector', () => {
    const { selectors, variant } = tightFade();
    expect(selectors).toEqual([
      '.modal-sheet__scroll:has(.ui-section-header[data-pinned])',
      ".modal-sheet__scroll:has([data-sheet-fade='tight'])",
    ]);
    // One rule, so the two can never drift apart; and nothing else in the
    // shell names the hook.
    expect(css.match(/data-sheet-fade/g)).toHaveLength(1);
    expect([...variant.keys()]).toEqual([
      '--modal-sheet-fade-overhang',
      '--modal-sheet-fade-ramp',
    ]);
    // On the scroller, where the fade's ::before inherits the two lengths
    // and the clear top reads them: an anchor on such a page lands at the
    // chrome's own edge.
    expect(
      scrollerPublishing('--modal-sheet-clear-top')?.get(
        '--modal-sheet-clear-top',
      ),
    ).toContain('var(--modal-sheet-fade-overhang)');
  });

  it('lets a pinned search band ride the chrome’s own layer, over the fade', () => {
    const search = stylesheet(
      resolve(__dirname, '../search-field/search-field.css'),
    );
    const pinned = declarations(
      block(
        block(search, '@layer sys-components'),
        '.ui-search-field[data-pinned]',
      ),
    );
    expect(pinned.get('z-index')).toBe('var(--sys-layer-header)');
    expect(
      declarations(block(css, '.modal-sheet__chrome')).get('z-index'),
    ).toBe('var(--sys-layer-header)');
  });

  // Wave D r2 (2026-09-28): the «Лоялност» page's anchored heading was
  // scrolled flush to the chrome's bottom edge — inside the fade's 3rem
  // overhang — and arrived ghosted, with the focus on it. Wave D r5: a
  // scroll offset is whole pixels, so a heading at a .625 offset rounded
  // up and landed 0.375 px inside the fade — one pixel of slack, once.
  it('publishes the clear top: the chrome’s measured height plus its fade’s overhang, and a pixel for the scroll’s rounding', () => {
    const scroller = scrollerPublishing('--modal-sheet-clear-top');
    expect(scroller?.get('--modal-sheet-clear-top')).toBe(
      'calc(var(--modal-sheet-chrome-height, var(--control-size-large)) + var(--modal-sheet-fade-overhang) + 1px)',
    );
  });

  it('publishes one origin clearance for every control a page is pushed from', () => {
    // The clear top above (the chrome and its fade), a docked bar below:
    // the value seven feature stylesheets had copied by hand.
    const scroller = scrollerPublishing('--modal-sheet-origin-margin');
    expect(scroller?.get('--modal-sheet-origin-margin')).toBe(
      'var(--modal-sheet-clear-top) calc(var(--control-size-large) + var(--sys-space-regular) * 2)',
    );
  });

  it('gives a form dialog the comfortable gutter at regular widths, the set-piece keeps the fluid one', () => {
    const regular = block(css, '@media (min-width: 761px)');
    expect(
      declarations(
        block(
          regular,
          "ui-sheet.modal-sheet[data-presentation-sizing='automatic']",
        ),
      ).get('--modal-sheet-safe'),
    ).toBe('var(--sys-space-comfortable)');
    expect(
      declarations(block(css, '.modal-sheet')).get('--modal-sheet-safe'),
    ).toBe('clamp(1.25rem, 4vw, 4rem)');
  });
});
