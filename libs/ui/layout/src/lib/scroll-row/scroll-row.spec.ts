import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { UiScrollRow, type UiScrollRowFullBleed } from './scroll-row';

@Component({
  imports: [UiScrollRow],
  template: `<ui-scroll-row
    [uiSnap]="snap()"
    [uiSpacing]="'compact'"
    [uiFullBleed]="fullBleed()"
    data-testid="scroll-row"
    >content</ui-scroll-row
  >`,
})
class HostComponent {
  snap = signal<'none' | 'start' | 'center'>('start');
  fullBleed = signal(false);
}

describe('UiScrollRow', () => {
  let fixture: ComponentFixture<HostComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HostComponent],
    }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
  });

  it('writes snap/gap as data-* attributes and omits data-full-bleed by default', () => {
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement.querySelector(
      '[data-testid="scroll-row"]',
    );
    expect(el.classList.contains('ui-scroll-row')).toBe(true);
    expect(el.getAttribute('data-snap')).toBe('start');
    expect(el.getAttribute('data-spacing')).toBe('compact');
    expect(el.getAttribute('data-full-bleed')).toBeNull();
  });

  it('updates data-snap when the snap signal changes', () => {
    fixture.detectChanges();
    fixture.componentInstance.snap.set('center');
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement.querySelector(
      '[data-testid="scroll-row"]',
    );
    expect(el.getAttribute('data-snap')).toBe('center');
  });

  it('writes data-full-bleed as an empty-string attribute when uiFullBleed is true', () => {
    fixture.componentInstance.fullBleed.set(true);
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement.querySelector(
      '[data-testid="scroll-row"]',
    );
    expect(el.getAttribute('data-full-bleed')).toBe('');
  });
});

/*
 * SHELVES INSIDE A SHEET (2026-09-28): the column's bleed and the
 * container-relative item width (≙ `containerRelativeFrame`).
 */
@Component({
  imports: [UiScrollRow],
  template: `
    <ui-scroll-row
      data-testid="shelf"
      uiSpacing="compact"
      [uiFullBleed]="bleed()"
      [uiContainerRelativeCount]="count()"
      [uiContainerRelativeSpan]="span()"
    >
      <span>12.08</span>
      <span>15.07</span>
    </ui-scroll-row>
    <ui-scroll-row data-testid="bare" uiFullBleed>content</ui-scroll-row>
    <ui-scroll-row data-testid="column" uiFullBleed="container"
      >content</ui-scroll-row
    >
  `,
})
class ShelfHost {
  readonly bleed = signal<UiScrollRowFullBleed>('container');
  readonly count = signal<number | null>(7);
  readonly span = signal(2);
}

describe('UiScrollRow · in a sheet', () => {
  let fixture: ComponentFixture<ShelfHost>;
  const row = (testId: string): HTMLElement =>
    fixture.nativeElement.querySelector(`[data-testid="${testId}"]`);

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ShelfHost],
      errorOnUnknownElements: true,
      errorOnUnknownProperties: true,
    }).compileComponents();
    fixture = TestBed.createComponent(ShelfHost);
    fixture.detectChanges();
  });

  it('stamps the container bleed as its own value, never as the viewport’s', () => {
    expect(row('shelf').getAttribute('data-full-bleed')).toBe('container');
    expect(row('column').getAttribute('data-full-bleed')).toBe('container');
    // The bare attribute keeps meaning the viewport, as it always did.
    expect(row('bare').getAttribute('data-full-bleed')).toBe('');

    fixture.componentInstance.bleed.set(false);
    fixture.detectChanges();
    expect(row('shelf').hasAttribute('data-full-bleed')).toBe(false);
  });

  it('publishes the count and the span for the item width', () => {
    const shelf = row('shelf');
    expect(shelf.getAttribute('data-relative')).toBe('');
    expect(shelf.style.getPropertyValue('--ui-scroll-row-count')).toBe('7');
    expect(shelf.style.getPropertyValue('--ui-scroll-row-span')).toBe('2');
  });

  it('sizes nothing without a usable count', () => {
    fixture.componentInstance.count.set(null);
    fixture.detectChanges();
    expect(row('shelf').hasAttribute('data-relative')).toBe(false);
    expect(row('shelf').style.getPropertyValue('--ui-scroll-row-count')).toBe(
      '',
    );
    expect(row('shelf').style.getPropertyValue('--ui-scroll-row-span')).toBe(
      '',
    );

    fixture.componentInstance.count.set(0);
    fixture.detectChanges();
    expect(row('shelf').hasAttribute('data-relative')).toBe(false);
  });
});

/*
 * THE GEOMETRY, READ FROM THE STYLESHEET. jsdom lays nothing out, so the
 * rules are held where they are written.
 */
describe('scroll-row.css · bleeds and the relative width', () => {
  const css = readFileSync(resolve(__dirname, 'scroll-row.css'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\s+/g, ' ')
    .replace(/\(\s/g, '(')
    .replace(/\s\)/g, ')');

  /** One rule's declarations, found by its exact (whitespace-folded) selector. */
  function rule(selector: string): Map<string, string> {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // eslint-disable-next-line security/detect-non-literal-regexp -- an escaped selector from this spec, over the DS's own stylesheet.
    const match = new RegExp(
      `(?:^|[{};])\\s*${escaped}\\s*\\{([^{}]*)\\}`,
    ).exec(css);
    if (!match) throw new Error(`no rule «${selector}» in scroll-row.css`);
    const found = new Map<string, string>();
    for (const declaration of (match[1] as string).split(';')) {
      const colon = declaration.indexOf(':');
      if (colon < 0) continue;
      found.set(
        declaration.slice(0, colon).trim(),
        declaration.slice(colon + 1).trim(),
      );
    }
    return found;
  }

  it('keeps the two bleeds exclusive: the viewport rule matches the empty value only', () => {
    expect(css).not.toMatch(/\.ui-scroll-row\[data-full-bleed\]\s*\{/);
    expect(rule(".ui-scroll-row[data-full-bleed='']").get('inline-size')).toBe(
      '100vw',
    );
    const column = rule(".ui-scroll-row[data-full-bleed='container']");
    expect(column.has('inline-size')).toBe(false);
    const gutter =
      'var(--ui-scroll-row-gutter, var(--ui-sheet-inset, var(--sys-space-regular)))';
    expect(column.get('margin-inline')).toBe(`calc(-1 * ${gutter})`);
    expect(column.get('padding-inline')).toBe(gutter);
    expect(column.get('scroll-padding-inline')).toBe(gutter);
  });

  it('publishes the gap from every spacing rung', () => {
    for (const spacing of [
      'none',
      'tight',
      'compact',
      'regular',
      'comfortable',
      'loose',
      'spacious',
    ]) {
      const rung = rule(`.ui-scroll-row[data-spacing='${spacing}']`);
      expect(rung.get('--ui-scroll-row-gap')).toContain(
        `var(--sys-space-${spacing})`,
      );
      expect(rung.get('gap')).toBe('var(--ui-scroll-row-gap)');
    }
  });

  it('shares the row between count columns, spacing counted (7 / 2 peeks 3.5)', () => {
    // At the 355 pt sheet column with the compact gap (8): (355 − 6 × 8) / 7
    // × 2 + 8 ≈ 95.7 per item — three and a half across, the half a peek.
    expect(
      rule('.ui-scroll-row[data-relative]').get('--ui-scroll-row-item'),
    ).toBe(
      'calc((100% - (var(--ui-scroll-row-count) - 1) * var(--ui-scroll-row-gap)) / var(--ui-scroll-row-count) * var(--ui-scroll-row-span) + (var(--ui-scroll-row-span) - 1) * var(--ui-scroll-row-gap))',
    );
    // Published, so a row that lays its items on tracks (a rail of medal
    // tiles, medal.css) sizes its columns by the same share — one formula.
    expect(rule('.ui-scroll-row[data-relative] > *').get('inline-size')).toBe(
      'var(--ui-scroll-row-item)',
    );
  });
});

/*
 * THE KEYBOARD STOP (2026-09-28 · axe scrollable-region-focusable on the
 * achievements' records). jsdom lays nothing out and has no
 * ResizeObserver: the observer is stubbed to report once, and the row's
 * overflow is its scroll/client widths, set per case.
 */
describe('UiScrollRow · a keyboard stop while it overflows with nothing focusable', () => {
  @Component({
    imports: [UiScrollRow],
    template: `
      <ui-scroll-row [uiLabel]="label()" data-testid="cards">
        <div>23 любима</div>
        <div>7 ранни</div>
      </ui-scroll-row>
      <ui-scroll-row uiLabel="Скоро" data-testid="buttons">
        <button type="button">Фейд</button>
      </ui-scroll-row>
      <ui-scroll-row
        role="list"
        aria-label="Снимки"
        tabindex="0"
        uiLabel="Скоро"
        data-testid="named"
      >
        <div role="listitem">1</div>
      </ui-scroll-row>
    `,
  })
  class StopHost {
    label = signal<string | null>('Рекорди');
  }

  const observers: FakeResizeObserver[] = [];
  class FakeResizeObserver {
    constructor(readonly callback: () => void) {
      observers.push(this);
    }
    observe(): void {
      return;
    }
    unobserve(): void {
      return;
    }
    disconnect(): void {
      return;
    }
  }

  /** The row's overflow, as a layout engine would report it. */
  function overflow(el: HTMLElement, scrollWidth: number, clientWidth = 355) {
    Object.defineProperty(el, 'scrollWidth', {
      configurable: true,
      value: scrollWidth,
    });
    Object.defineProperty(el, 'clientWidth', {
      configurable: true,
      value: clientWidth,
    });
  }

  beforeEach(() => {
    observers.length = 0;
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function mount() {
    await TestBed.configureTestingModule({
      imports: [StopHost],
      errorOnUnknownElements: true,
      errorOnUnknownProperties: true,
    }).compileComponents();
    const fixture = TestBed.createComponent(StopHost);
    const q = (id: string) =>
      fixture.nativeElement.querySelector(
        `[data-testid="${id}"]`,
      ) as HTMLElement;
    for (const id of ['cards', 'buttons', 'named']) overflow(q(id), 520);
    fixture.detectChanges();
    await fixture.whenStable();
    return { fixture, q };
  }

  /** What the observers would report after a resize. */
  const resized = () => observers.forEach((observer) => observer.callback());

  it('stamps tabindex, a group role and its label on a row of static cards that overflows', async () => {
    const { q } = await mount();
    const cards = q('cards');
    expect(cards.getAttribute('tabindex')).toBe('0');
    expect(cards.getAttribute('role')).toBe('group');
    expect(cards.getAttribute('aria-label')).toBe('Рекорди');
    expect(cards.hasAttribute('data-keyboard-stop')).toBe(true);
  });

  it('stays out of the tab order when its items are reachable, or when it fits', async () => {
    const { q } = await mount();
    expect(q('buttons').hasAttribute('tabindex')).toBe(false);
    expect(q('buttons').hasAttribute('role')).toBe(false);
    const cards = q('cards');
    overflow(cards, 355);
    resized();
    expect(cards.hasAttribute('tabindex')).toBe(false);
    expect(cards.hasAttribute('role')).toBe(false);
    expect(cards.hasAttribute('aria-label')).toBe(false);
    expect(cards.hasAttribute('data-keyboard-stop')).toBe(false);
  });

  it('keeps the consumer’s own tabindex, role and name', async () => {
    const { q } = await mount();
    const named = q('named');
    expect(named.getAttribute('tabindex')).toBe('0');
    expect(named.getAttribute('role')).toBe('list');
    expect(named.getAttribute('aria-label')).toBe('Снимки');
    overflow(named, 355);
    resized();
    expect(named.hasAttribute('data-keyboard-stop')).toBe(false);
    expect(named.getAttribute('tabindex')).toBe('0');
    expect(named.getAttribute('role')).toBe('list');
    expect(named.getAttribute('aria-label')).toBe('Снимки');
  });

  it('follows a label that changes while it is a stop', async () => {
    const { fixture, q } = await mount();
    fixture.componentInstance.label.set('Records');
    fixture.detectChanges();
    expect(q('cards').getAttribute('aria-label')).toBe('Records');
  });

  it('wears the house focus ring, inset', () => {
    const css = readFileSync(
      resolve(__dirname, 'scroll-row.css'),
      'utf8',
    ).replace(/\s+/g, ' ');
    expect(css).toContain(
      '.ui-scroll-row[data-keyboard-stop]:focus-visible { outline: var(--sys-focus-ring-width) solid var(--sys-color-ring); outline-offset: calc(-1 * var(--sys-focus-ring-width)); }',
    );
  });
});
