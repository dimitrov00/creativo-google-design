import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import {
  UI_OCCASION_FLECKS,
  UiOccasionBand,
  type UiOccasionFleck,
} from './occasion-band';

const css = readFileSync(resolve(__dirname, 'occasion-band.css'), 'utf8');

interface Rule {
  readonly selector: string;
  readonly body: string;
  /** The at-rules the rule stands inside, outermost first. */
  readonly within: readonly string[];
}

/** Whitespace folded, and none inside a bracket: `f( a )` reads `f(a)`. */
const fold = (text: string): string =>
  text
    .replace(/\s+/g, ' ')
    .replace(/\(\s+/g, '(')
    .replace(/\s+\)/g, ')')
    .trim();

/** Every style rule of the stylesheet, comments stripped, with the at-rules around it. */
function rulesOf(source: string): Rule[] {
  const text = source.replace(/\/\*[\s\S]*?\*\//g, '');
  const found: Rule[] = [];
  const open: { prelude: string; nested: boolean }[] = [];
  let buffer = '';
  for (const char of text) {
    if (char === '{') {
      const parent = open.at(-1);
      if (parent) parent.nested = true;
      open.push({ prelude: fold(buffer), nested: false });
      buffer = '';
    } else if (char === '}') {
      const block = open.pop();
      if (block && !block.nested && !block.prelude.startsWith('@')) {
        found.push({
          selector: block.prelude,
          body: fold(buffer),
          within: open.map((outer) => outer.prelude),
        });
      }
      buffer = '';
    } else {
      buffer += char;
    }
  }
  return found;
}

const rules = rulesOf(css);

/** The declarations of the rule with exactly this selector, outside any container query. */
function rule(selector: string): string {
  const wanted = fold(selector);
  const match = rules.find(
    (one) =>
      one.selector === wanted &&
      !one.within.some((outer) => outer.startsWith('@container')),
  );
  if (!match) throw new Error(`occasion-band.css has no "${wanted}" rule`);
  return match.body;
}

/** The rules of the narrow band: the ones inside the container query. */
const narrow = rules.filter((one) =>
  one.within.some((outer) => outer.startsWith('@container')),
);

@Component({
  imports: [UiOccasionBand],
  template: `
    <ui-occasion-band [uiTitle]="title()" role="note" data-testid="band">
      @if (glyph()) {
        <span uiOccasionGlyph data-testid="glyph">🎂</span>
      }
      @if (detail(); as word) {
        <span uiOccasionDetail data-testid="detail">{{ word }}</span>
      }
    </ui-occasion-band>
  `,
})
class Host {
  readonly title = signal('Рожден ден · 34 г.');
  readonly glyph = signal(true);
  readonly detail = signal<string | null>(null);
}

function render() {
  TestBed.configureTestingModule({
    imports: [Host],
    errorOnUnknownElements: true,
    errorOnUnknownProperties: true,
  });
  const fixture = TestBed.createComponent(Host);
  fixture.detectChanges();
  const root = fixture.nativeElement as HTMLElement;
  const band = root.querySelector<HTMLElement>('[data-testid="band"]');
  if (!band) throw new Error('no band');
  return { fixture, host: fixture.componentInstance, band };
}

describe('UiOccasionBand', () => {
  it('says the occasion once: the glyph on its disc, the title beside it', () => {
    const { band } = render();
    expect(band.classList.contains('ui-occasion-band')).toBe(true);
    // The consumer's role stays the consumer's: the band sets none.
    expect(band.getAttribute('role')).toBe('note');
    const lead = band.querySelector('.ui-occasion-band__lead');
    expect(lead).not.toBeNull();
    const disc = lead?.querySelector('.ui-occasion-band__glyph');
    expect(disc?.getAttribute('aria-hidden')).toBe('true');
    expect(disc?.querySelector('[data-testid="glyph"]')).not.toBeNull();
    const title = lead?.querySelector('.ui-occasion-band__title');
    expect(title?.textContent?.trim()).toBe('Рожден ден · 34 г.');
    // The disc leads, the words follow.
    expect([...(lead?.children ?? [])].map((child) => child.className)).toEqual(
      ['ui-occasion-band__glyph', 'ui-occasion-band__lines'],
    );
    // The band's text is its title and nothing else.
    expect(band.textContent?.replace('🎂', '').trim()).toBe(
      'Рожден ден · 34 г.',
    );
  });

  it('follows its title', () => {
    const { band, fixture, host } = render();
    host.title.set('Рожден ден днес');
    fixture.detectChanges();
    expect(
      band.querySelector('.ui-occasion-band__title')?.textContent?.trim(),
    ).toBe('Рожден ден днес');
  });

  it('leaves the disc empty when no glyph is given, so the stylesheet can drop it', () => {
    const { band, fixture, host } = render();
    host.glyph.set(false);
    fixture.detectChanges();
    const disc = band.querySelector('.ui-occasion-band__glyph');
    expect(disc?.childElementCount).toBe(0);
    expect(disc?.textContent).toBe('');
    expect(rule('.ui-occasion-band__glyph:empty')).toContain('display: none');
  });

  it('holds the one detail under the title, in the text column', () => {
    const { band, fixture, host } = render();
    expect(band.querySelector('[data-testid="detail"]')).toBeNull();
    host.detail.set('Георгьовден');
    fixture.detectChanges();
    const lines = band.querySelector('.ui-occasion-band__lines');
    expect([...(lines?.children ?? [])].map((child) => child.tagName)).toEqual([
      'SPAN',
      'SPAN',
    ]);
    expect(lines?.lastElementChild?.getAttribute('data-testid')).toBe('detail');
    expect(lines?.firstElementChild?.className).toBe('ui-occasion-band__title');
  });

  describe('the flecks', () => {
    const drawn = (band: HTMLElement) => [
      ...band.querySelectorAll<HTMLElement>('.ui-occasion-band__fleck'),
    ];

    it('are fourteen hidden spans in one layer under the text column', () => {
      const { band } = render();
      const layer = band.querySelector('.ui-occasion-band__flecks');
      expect(layer?.getAttribute('aria-hidden')).toBe('true');
      // The layer comes first: the text column paints over it.
      expect(band.firstElementChild).toBe(layer);
      const flecks = drawn(band);
      expect(flecks).toHaveLength(14);
      for (const fleck of flecks) {
        expect(fleck.tagName).toBe('SPAN');
        expect(fleck.parentElement).toBe(layer);
        expect(fleck.getAttribute('aria-hidden')).toBe('true');
        expect(fleck.textContent).toBe('');
      }
    });

    it('are drawn from the map: shape, ink and place, in percent', () => {
      const { band } = render();
      const flecks = drawn(band);
      expect(flecks).toHaveLength(UI_OCCASION_FLECKS.length);
      UI_OCCASION_FLECKS.forEach((mark, index) => {
        const fleck = flecks.at(index);
        if (!fleck) throw new Error(`no fleck ${index}`);
        expect(fleck.dataset['shape']).toBe(mark.shape);
        expect(fleck.dataset['ink']).toBe(mark.ink);
        expect(fleck.hasAttribute('data-kept')).toBe(mark.kept);
        expect(fleck.style.getPropertyValue('--ui-occasion-fleck-x')).toBe(
          `${mark.x}%`,
        );
        expect(fleck.style.getPropertyValue('--ui-occasion-fleck-y')).toBe(
          `${mark.y}%`,
        );
        expect(fleck.style.getPropertyValue('--ui-occasion-fleck-turn')).toBe(
          `${mark.turn}deg`,
        );
      });
    });

    it('are the same marks every time: nothing is random', () => {
      const first = render();
      const places = drawn(first.band).map((fleck) => fleck.style.cssText);
      TestBed.resetTestingModule();
      const second = render();
      expect(drawn(second.band).map((fleck) => fleck.style.cssText)).toEqual(
        places,
      );
    });
  });
});

describe('the map', () => {
  const marks: readonly UiOccasionFleck[] = UI_OCCASION_FLECKS;
  const kept = marks.filter((mark) => mark.kept);

  it('holds fourteen marks of three shapes', () => {
    expect(marks).toHaveLength(14);
    expect(new Set(marks.map((mark) => mark.shape))).toEqual(
      new Set(['dot', 'bar', 'spark']),
    );
  });

  it('alternates two inks along its path', () => {
    expect(marks.map((mark) => mark.ink)).toEqual(
      marks.map((_, index) => (index % 2 === 0 ? 'light' : 'dark')),
    );
  });

  it('stands its bars at four angles', () => {
    const angles = new Set(
      marks.filter((mark) => mark.shape === 'bar').map((mark) => mark.turn),
    );
    expect(angles.size).toBe(4);
  });

  it('lies over the WHOLE band: every quarter of its length, the top and the foot', () => {
    for (const [from, to] of [
      [0, 25],
      [25, 50],
      [50, 75],
      [75, 100],
    ] as const) {
      const inQuarter = marks.filter((mark) => mark.x >= from && mark.x < to);
      expect(inQuarter.length).toBeGreaterThanOrEqual(2);
      expect(inQuarter.some((mark) => mark.y < 50)).toBe(true);
      expect(inQuarter.some((mark) => mark.y > 50)).toBe(true);
    }
    for (const mark of marks) {
      expect(mark.x).toBeGreaterThan(0);
      expect(mark.x).toBeLessThan(100);
      expect(mark.y).toBeGreaterThan(0);
      expect(mark.y).toBeLessThan(100);
    }
  });

  it('keeps the title’s row clear: a mark left of the trailing fifth stands in the top or the foot row', () => {
    // The band is 96 and the row 44, centred: from 27 % to 73 %. A mark is
    // 12 at most, so its centre keeps 6.25 % of the band off the row.
    for (const mark of marks.filter((one) => one.x < 80)) {
      const clear = mark.y <= 27 - 6.25 || mark.y >= 73 + 6.25;
      expect(clear).toBe(true);
    }
  });

  it('stands no dot in the title’s row: a dot after the last letter reads as punctuation', () => {
    const inTheRow = marks.filter((mark) => mark.y > 27 && mark.y < 73);
    expect(inTheRow.length).toBeGreaterThan(0);
    expect(inTheRow.map((mark) => mark.shape)).not.toContain('dot');
  });

  it('keeps eight on a narrow band: the four corners’ and four by the trailing edge, four of each ink', () => {
    expect(kept).toHaveLength(8);
    const corner = (mark: UiOccasionFleck): boolean =>
      (mark.x < 10 || mark.x > 90) && (mark.y < 20 || mark.y > 80);
    expect(kept.filter(corner)).toHaveLength(4);
    // One corner each.
    expect(
      new Set(
        kept.filter(corner).map((mark) => `${mark.x < 50}-${mark.y < 50}`),
      ).size,
    ).toBe(4);
    for (const mark of kept.filter((one) => !corner(one))) {
      expect(mark.x).toBeGreaterThan(60);
    }
    expect(kept.filter((mark) => mark.ink === 'light')).toHaveLength(4);
    expect(kept.filter((mark) => mark.ink === 'dark')).toHaveLength(4);
  });

  it('keeps on a narrow band only what a title cannot cover: the rows, and the trailing edge', () => {
    // At 296 the text column ends 24 short of the trailing edge (92 %).
    for (const mark of kept) {
      const inARow = mark.y <= 27 - 6.25 || mark.y >= 73 + 6.25;
      expect(inARow || mark.x > 93).toBe(true);
    }
  });
});

describe('the band’s stylesheet', () => {
  it('is a solid accent band, 96 tall, padded by the gutter, the disc and the title centred', () => {
    const band = rule('.ui-occasion-band');
    expect(band).toContain(
      'background: var(--ui-occasion-band-surface, var(--sys-color-accent))',
    );
    expect(band).toContain('block-size: var(--ui-occasion-band-height, 6rem)');
    expect(band).toContain('padding: var(--sys-space-regular)');
    expect(band).toContain('display: flex');
    expect(band).toContain('align-items: center');
    // No gradient anywhere in the file, and nothing moves.
    expect(css.replace(/\/\*[\s\S]*?\*\//g, '')).not.toMatch(
      /gradient|animation|transition|@keyframes/,
    );
  });

  it('stands alone as a card: fully rounded, lifted', () => {
    const band = rule('.ui-occasion-band');
    expect(band).toContain('border-radius: var(--control-radius-prominent)');
    expect(band).toContain('box-shadow: var(--sys-elevation-raised)');
  });

  it('declares neither hook on the host: each is read with its default, so an ancestor may set it', () => {
    for (const one of rules) {
      expect(one.body).not.toMatch(/(?<![\w(-])--ui-occasion-band-height\s*:/);
      expect(one.body).not.toMatch(/(?<![\w(-])--ui-occasion-band-surface\s*:/);
    }
  });

  it('prints the title as a white display figure, on one line', () => {
    const title = rule('.ui-occasion-band__title');
    expect(title).toContain('font: var(--sys-font-title2)');
    expect(title).toContain('font-variant-numeric: tabular-nums');
    expect(title).toContain('color: var(--sys-color-on-accent)');
    expect(title).toContain('white-space: nowrap');
    expect(title).toContain('text-overflow: ellipsis');
  });

  it('inks nothing else in white: the title is the one text on the orange', () => {
    const inked = rules
      .filter((one) =>
        /(?<![\w-])color:\s*var\(--sys-color-on-accent\)/.test(one.body),
      )
      .map((one) => one.selector);
    expect(inked).toEqual(['.ui-occasion-band__title']);
  });

  it('draws the glyph at 24 in the band’s own colour on a 44 disc, white in both themes', () => {
    const disc = rule('.ui-occasion-band__glyph');
    expect(disc).toContain('inline-size: var(--control-size-regular)');
    expect(disc).toContain('block-size: var(--control-size-regular)');
    expect(disc).toContain('border-radius: var(--control-radius-capsule)');
    expect(disc).toContain('background: var(--sys-color-on-accent)');
    expect(disc).toContain('font-size: calc(var(--sys-space-unit) * 6)');
    expect(disc).toContain(
      'color: var(--ui-occasion-band-surface, var(--sys-color-accent))',
    );
  });

  it('keeps the title’s row solid: the text column paints the band’s colour over the flecks', () => {
    const lead = rule('.ui-occasion-band__lead');
    expect(lead).toContain(
      'background: var(--ui-occasion-band-surface, var(--sys-color-accent))',
    );
    // Over the layer: positioned, and after it in the band.
    expect(lead).toContain('position: relative');
    const layer = rule('.ui-occasion-band__flecks');
    expect(layer).toContain('position: absolute');
    expect(layer).toContain('inset: 0');
    expect(layer).toContain('pointer-events: none');
  });

  it('places a fleck by its centre, from the map’s three properties', () => {
    const fleck = rule('.ui-occasion-band__fleck');
    expect(fleck).toContain('inset-inline-start: var(--ui-occasion-fleck-x)');
    expect(fleck).toContain('inset-block-start: var(--ui-occasion-fleck-y)');
    expect(fleck).toContain('translate: -50% -50%');
    expect(fleck).toContain('rotate: var(--ui-occasion-fleck-turn, 0deg)');
  });

  it('inks the flecks in two tokens at full strength', () => {
    expect(rule(".ui-occasion-band__fleck[data-ink='light']")).toBe(
      'background: var(--sys-color-on-accent);',
    );
    expect(rule(".ui-occasion-band__fleck[data-ink='dark']")).toBe(
      'background: var(--sys-color-media-canvas);',
    );
    for (const one of rules.filter((r) => r.selector.includes('__fleck'))) {
      expect(one.body).not.toMatch(/color-mix|opacity/);
    }
  });

  it('cuts a 6 pt dot, a 4 × 12 bar and a 12 pt four-point spark', () => {
    const dot = rule(".ui-occasion-band__fleck[data-shape='dot']");
    expect(dot).toContain('inline-size: calc(var(--sys-space-unit) * 1.5)');
    expect(dot).toContain('block-size: calc(var(--sys-space-unit) * 1.5)');
    const bar = rule(".ui-occasion-band__fleck[data-shape='bar']");
    expect(bar).toContain('inline-size: var(--sys-space-unit)');
    expect(bar).toContain('block-size: calc(var(--sys-space-unit) * 3)');
    const spark = rule(".ui-occasion-band__fleck[data-shape='spark']");
    expect(spark).toContain('inline-size: calc(var(--sys-space-unit) * 3)');
    expect(spark).toContain('block-size: calc(var(--sys-space-unit) * 3)');
    // Four points out, four in: eight corners.
    const polygon = /clip-path: polygon\(([^)]*)\)/.exec(spark)?.[1] ?? '';
    expect(polygon.split(',')).toHaveLength(8);
  });

  describe('on a narrow band', () => {
    it('answers by the band’s own width, under the 330 pt phone’s line', () => {
      expect(rule('.ui-occasion-band')).toContain(
        'container-type: inline-size',
      );
      const queries = new Set(narrow.flatMap((one) => one.within)).values();
      const query = [...queries].find((one) => one.startsWith('@container'));
      const rems = Number(/inline-size < ([\d.]+)rem/.exec(query ?? '')?.[1]);
      // A container is measured by its content box: the band less its
      // padding (2 × 16). The 390 pt phone's band is 354.8 wide and must
      // keep the whole map; the 330 pt phone's is 294.8 and must not.
      const line = rems * 16;
      expect(line).toBeLessThanOrEqual(354.8 - 32);
      expect(line).toBeGreaterThan(294.8 - 32);
      // The spec's own line: a sheet of 22.5rem, less its insets (2 × 17.6).
      expect(Math.abs(line - (360 - 35.2 - 32))).toBeLessThan(1);
    });

    it('keeps the eight, never none', () => {
      expect(
        narrow.find(
          (one) => one.selector === '.ui-occasion-band__fleck:not([data-kept])',
        )?.body,
      ).toBe('display: none;');
      // Nothing else hides a fleck, anywhere.
      const hiding = rules
        .filter(
          (one) =>
            one.selector.includes('__fleck') &&
            one.body.includes('display: none'),
        )
        .map((one) => one.selector);
      expect(hiding).toEqual(['.ui-occasion-band__fleck:not([data-kept])']);
    });

    it('steps the title down one rung, still a display figure', () => {
      const title = narrow.find(
        (one) => one.selector === '.ui-occasion-band__title',
      )?.body;
      expect(title).toContain('font: var(--sys-font-title3)');
      // 20 px is large text only in bold (18.66 px at 700 and over).
      expect(title).toContain('font-weight: 700');
      expect(title).toContain('font-variant-numeric: tabular-nums');
    });
  });
});
