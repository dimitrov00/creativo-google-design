import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { UiCard, type UiCardTone } from '../card/card';
import { UiListGroup } from '../list-group/list-group';
import { UiMedal, type UiMedalControlSize, type UiMedalState } from './medal';

const css = readFileSync(resolve(__dirname, 'medal.css'), 'utf8');
const gaugeCss = readFileSync(resolve(__dirname, '../gauge/gauge.css'), 'utf8');
const tokens = readFileSync(
  resolve(__dirname, '../../../../tokens/tokens.css'),
  'utf8',
);

const STATES = ['notStarted', 'inProgress', 'earned', 'complete'] as const;
const SIZES = ['regular', 'large', 'extraLarge'] as const;

/** A stylesheet without its comments, its white space folded. */
const flatten = (sheet: string): string =>
  sheet
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\s+/g, ' ')
    .replace(/\(\s/g, '(')
    .replace(/\s\)/g, ')');

const flat = flatten(css);

/** The body of the ONE rule whose whole selector is `selector`. */
function ownRule(selector: string, sheet = flat, name = 'medal.css'): string {
  const found = [...sheet.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter(
    ([, candidate]) => candidate?.trim() === selector,
  );
  if (found.length !== 1) {
    throw new Error(`${name} has ${found.length} "${selector}" rules`);
  }
  return (found[0]?.[2] ?? '').trim();
}

/** One declaration of a rule's body. */
function declared(body: string, property: string): string {
  // eslint-disable-next-line security/detect-non-literal-regexp -- a property name from this spec, over the DS's own stylesheets.
  const value = new RegExp(`(?:^|; ?)${property}: ([^;]+);`).exec(body)?.[1];
  if (!value) throw new Error(`no ${property} in "${body}"`);
  return value.trim();
}

/** A size token of the DS, `calc(var(--sys-space-unit) * N)`, in points. */
function tokenPoints(token: string): number {
  // eslint-disable-next-line security/detect-non-literal-regexp -- a token name from this spec, over the DS's own tokens file.
  const units = new RegExp(
    `${token}:\\s*calc\\(var\\(--sys-space-unit\\) \\* ([\\d.]+)\\)`,
  ).exec(tokens)?.[1];
  if (!units) throw new Error(`tokens.css sets no ${token} in space units`);
  return Number(units) * 4;
}

/** `unit`, `unit × N`, `<token>`, or `<token> + unit × N`, in points. */
function points(declaration: string): number {
  const value = declaration.trim();
  if (value === 'var(--sys-space-unit)') return 4;
  const times = /^calc\(var\(--sys-space-unit\) \* ([\d.]+)\)$/.exec(value);
  if (times) return Number(times[1]) * 4;
  const token = /^var\((--[\w-]+)\)$/.exec(value);
  if (token) return tokenPoints(token[1] ?? '');
  const sum =
    /^calc\(var\((--[\w-]+)\) \+ var\(--sys-space-unit\) \* ([\d.]+)\)$/.exec(
      value,
    );
  if (sum) return tokenPoints(sum[1] ?? '') + Number(sum[2]) * 4;
  throw new Error(`not a size this spec reads: "${value}"`);
}

/** The medal's own rule for a size: `large` is the root's. */
const sizeRule = (size: UiMedalControlSize): string =>
  ownRule(
    size === 'large' ? '.ui-medal' : `.ui-medal[data-control-size='${size}']`,
  );

/** The gauge's ring rule for a size: `regular` is the style's. */
const gaugeRule = (size: UiMedalControlSize): string => {
  const ring = ".ui-gauge[data-gauge-style='circularCapacity']";
  return ownRule(
    size === 'regular' ? ring : `${ring}[data-control-size='${size}']`,
    flatten(gaugeCss),
    'gauge.css',
  );
};

@Component({
  imports: [UiMedal],
  template: `
    <ui-medal
      [uiState]="state()"
      [uiIcon]="icon()"
      [uiSrc]="src()"
      [uiMonogram]="monogram()"
      [uiLevel]="level()"
      [uiTitle]="title()"
      [uiCaption]="caption()"
      [uiValue]="value()"
      [uiValueText]="valueText()"
      [uiControlSize]="size()"
      [uiStacked]="stacked()"
      [uiLabel]="label()"
      data-testid="static"
    >
      @if (isNew()) {
        <span uiMedalMarker data-testid="marker">Ново</span>
      }
    </ui-medal>
    <button
      uiMedal
      uiState="earned"
      uiIcon="loyalty.badge.visits"
      uiLevel="II"
      uiControlSize="regular"
      uiLabel="Посещения, ниво II"
      data-testid="button"
      (click)="opened = opened + 1"
    ></button>
  `,
})
class Host {
  readonly state = signal<UiMedalState>('earned');
  readonly icon = signal<'loyalty.badge.service' | null>(
    'loyalty.badge.service',
  );
  readonly src = signal<string | null>(null);
  readonly monogram = signal<string | null>(null);
  readonly level = signal<string | null>('II');
  readonly title = signal<string | null>('Фейд');
  readonly caption = signal<string | null>('24/25 до III');
  readonly value = signal<number | null>(0.96);
  readonly valueText = signal<string | null>('24 от 25 до ниво III');
  readonly size = signal<UiMedalControlSize>('large');
  readonly stacked = signal(false);
  readonly label = signal(
    'Фейд, ниво II спечелено на 3 юни, 24 от 25 до ниво III, ново',
  );
  readonly isNew = signal(true);
  opened = 0;
}

function render(setup?: (host: Host) => void) {
  TestBed.configureTestingModule({
    imports: [Host],
    errorOnUnknownElements: true,
    errorOnUnknownProperties: true,
  });
  const fixture = TestBed.createComponent(Host);
  setup?.(fixture.componentInstance);
  fixture.detectChanges();
  const root = fixture.nativeElement as HTMLElement;
  const medal = root.querySelector('[data-testid="static"]') as HTMLElement;
  const button = root.querySelector(
    '[data-testid="button"]',
  ) as HTMLButtonElement;
  const part = (name: string, host: HTMLElement = medal) =>
    host.querySelector<HTMLElement>(`.ui-medal__${name}`);
  const ring = (host: HTMLElement = medal) =>
    host.querySelector<HTMLElement>('ui-gauge.ui-medal__ring');
  return {
    fixture,
    host: fixture.componentInstance,
    medal,
    button,
    part,
    ring,
  };
}

/** A medal on a ground: a card of a tone, a list group, or the bare sheet. */
@Component({
  imports: [UiCard, UiListGroup, UiMedal],
  template: `
    @switch (ground()) {
      @case ('list') {
        <ul uiListGroup>
          <li>
            <ui-medal
              uiState="inProgress"
              uiIcon="loyalty.badge.visits"
              [uiValue]="0.5"
              uiLabel="Посещения"
            />
          </li>
        </ul>
      }
      @case ('sheet') {
        <ui-medal
          uiState="inProgress"
          uiIcon="loyalty.badge.visits"
          [uiValue]="0.5"
          uiLabel="Посещения"
        />
      }
      @default {
        <ui-card [uiTone]="tone()">
          <div>
            <ui-medal
              uiState="inProgress"
              uiIcon="loyalty.badge.visits"
              [uiValue]="0.5"
              uiLabel="Посещения"
            />
          </div>
        </ui-card>
      }
    }
  `,
})
class GroundHost {
  readonly ground = signal<'card' | 'list' | 'sheet'>('card');
  readonly tone = signal<UiCardTone>('elevated');
}

function renderOn(setup: (host: GroundHost) => void) {
  TestBed.configureTestingModule({
    imports: [GroundHost],
    errorOnUnknownElements: true,
    errorOnUnknownProperties: true,
  });
  const fixture = TestBed.createComponent(GroundHost);
  setup(fixture.componentInstance);
  fixture.detectChanges();
  return (fixture.nativeElement as HTMLElement).querySelector(
    'ui-medal',
  ) as HTMLElement;
}

afterEach(() => vi.restoreAllMocks());

describe('UiMedal', () => {
  it('is an image named by one sentence, its drawing hidden behind it', () => {
    const { medal, part, ring } = render();
    expect(medal.classList.contains('ui-medal')).toBe(true);
    expect(medal.getAttribute('role')).toBe('img');
    expect(medal.getAttribute('aria-label')).toBe(
      'Фейд, ниво II спечелено на 3 юни, 24 от 25 до ниво III, ново',
    );
    // The ring, the disc and the rim numeral are ONE drawing; the marker's
    // word is in the sentence.
    expect(part('figure')?.getAttribute('aria-hidden')).toBe('true');
    expect(ring()?.getAttribute('aria-hidden')).toBe('true');
    for (const name of ['disc', 'level']) {
      expect(part(name)?.closest('[aria-hidden="true"]')).toBe(part('figure'));
    }
    expect(part('marker')?.getAttribute('aria-hidden')).toBe('true');
    expect(medal.hasAttribute('data-interactive')).toBe(false);
  });

  it('is a native button in its button form — the one hover/press grammar, named by the same sentence', () => {
    const { button, fixture } = render();
    expect(button.getAttribute('role')).toBeNull();
    expect(button.getAttribute('type')).toBe('button');
    expect(button.hasAttribute('data-interactive')).toBe(true);
    expect(button.getAttribute('aria-label')).toBe('Посещения, ниво II');
    button.click();
    expect(fixture.componentInstance.opened).toBe(1);
  });

  it('stamps each of the four states at each of the three sizes', () => {
    const { medal, fixture, host } = render((h) => h.level.set(null));
    for (const state of STATES) {
      for (const size of SIZES) {
        host.state.set(state);
        host.size.set(size);
        fixture.detectChanges();
        expect(medal.dataset['state']).toBe(state);
        expect(medal.dataset['controlSize']).toBe(size);
      }
    }
  });

  describe('the ring', () => {
    it('is the gauge’s circular style at the medal’s own size, drawn before the disc it wraps', () => {
      const { part, ring, fixture, host } = render();
      for (const size of SIZES) {
        host.size.set(size);
        fixture.detectChanges();
        expect(ring()?.getAttribute('data-gauge-style')).toBe(
          'circularCapacity',
        );
        // The size names the disc, for the medal and for its ring alike.
        expect(ring()?.getAttribute('data-control-size')).toBe(size);
      }
      // One cell: the ring first, the disc over it, then the chip on both.
      expect([...(part('figure')?.children ?? [])]).toEqual([
        ring(),
        part('disc'),
        part('level'),
      ]);
      // It is a ring and nothing else: no centre, no words.
      expect(ring()?.querySelectorAll('circle')).toHaveLength(2);
      expect(ring()?.textContent?.trim()).toBe('');
    });

    it('draws the way to the next level, on an earned medal and on one in progress', () => {
      const { ring, fixture, host } = render();
      expect(ring()?.getAttribute('aria-valuemin')).toBe('0');
      expect(ring()?.getAttribute('aria-valuemax')).toBe('1');
      expect(ring()?.getAttribute('aria-valuenow')).toBe('0.96');
      expect(ring()?.getAttribute('aria-valuetext')).toBe(
        '24 от 25 до ниво III',
      );
      expect(ring()?.style.getPropertyValue('--ui-gauge-value')).toBe('0.96');
      expect(ring()?.hasAttribute('data-extent')).toBe(false);
      expect(ring()?.hasAttribute('data-complete')).toBe(false);
      host.level.set(null);
      host.state.set('inProgress');
      host.value.set(2 / 3);
      fixture.detectChanges();
      expect(Number(ring()?.getAttribute('aria-valuenow'))).toBeCloseTo(2 / 3);
      expect(ring()?.hasAttribute('data-extent')).toBe(false);
    });

    it('keeps the value between nothing and all, and draws the track alone without one', () => {
      const { ring, fixture, host } = render();
      host.value.set(1.4);
      fixture.detectChanges();
      expect(ring()?.getAttribute('aria-valuenow')).toBe('1');
      host.value.set(-2);
      fixture.detectChanges();
      expect(ring()?.getAttribute('aria-valuenow')).toBe('0');
      host.value.set(Number.NaN);
      fixture.detectChanges();
      expect(ring()?.getAttribute('aria-valuenow')).toBe('0');
      // No value is no arc; the ring's box and its track stay. The words
      // are not what draws it.
      host.value.set(null);
      host.valueText.set(null);
      fixture.detectChanges();
      expect(ring()).not.toBeNull();
      expect(ring()?.getAttribute('aria-valuenow')).toBe('0');
      expect(ring()?.hasAttribute('data-empty')).toBe(true);
      expect(ring()?.hasAttribute('data-extent')).toBe(false);
    });

    it('dashes the track of a medal not started, and draws no arc whatever the value says', () => {
      const { ring } = render((h) => {
        h.state.set('notStarted');
        h.level.set(null);
        h.value.set(0.5);
      });
      expect(ring()?.getAttribute('data-extent')).toBe('dashed');
      expect(ring()?.getAttribute('aria-valuenow')).toBe('0');
      expect(ring()?.hasAttribute('data-empty')).toBe(true);
    });

    it('is FULL on a complete medal, whatever the value says', () => {
      const { ring, fixture, host } = render((h) => {
        h.state.set('complete');
        h.level.set('V');
        h.value.set(null);
      });
      expect(ring()?.getAttribute('aria-valuenow')).toBe('1');
      expect(ring()?.hasAttribute('data-complete')).toBe(true);
      expect(ring()?.hasAttribute('data-extent')).toBe(false);
      host.value.set(0.2);
      fixture.detectChanges();
      expect(ring()?.hasAttribute('data-complete')).toBe(true);
    });

    it('keeps the ring’s box in every state, so a row of medals shares one line', () => {
      const { part, ring, fixture, host } = render((h) => h.level.set(null));
      for (const state of STATES) {
        host.state.set(state);
        fixture.detectChanges();
        expect(ring()?.parentElement).toBe(part('figure'));
      }
      const figure = ownRule('.ui-medal__figure');
      const box = 'calc(var(--ui-medal-disc) + 2 * var(--ui-medal-rim))';
      expect(declared(figure, 'inline-size')).toBe(box);
      expect(declared(figure, 'block-size')).toBe(box);
      expect(figure).toContain('flex: none;');
      // The disc shares the ring's cell, and the chip hangs on it.
      expect(figure).toContain('place-items: center;');
      expect(ownRule('.ui-medal__figure > *')).toBe('grid-area: 1 / 1;');
    });

    it.each([
      // size, disc, ring, stroke, gap, chip
      ['regular', 44, 52, 3, 1, 16],
      ['large', 52, 64, 4, 2, 18],
      ['extraLarge', 112, 128, 6, 2, 28],
    ] as const)(
      'is the gauge’s own geometry — %s: disc %i in a ring of %i',
      (size, disc, outer, stroke, gap, chip) => {
        const own = sizeRule(size);
        expect(points(declared(own, '--ui-medal-disc'))).toBe(disc);
        const rim = points(declared(own, '--ui-medal-rim'));
        expect(disc + 2 * rim).toBe(outer);
        expect(points(declared(own, '--ui-medal-chip'))).toBe(chip);
        // What the medal reserves is what the gauge draws.
        const gauge = gaugeRule(size);
        expect(points(declared(gauge, '--ui-gauge-diameter'))).toBe(outer);
        expect(points(declared(gauge, '--ui-gauge-stroke'))).toBe(stroke);
        expect(rim - stroke).toBe(gap);
      },
    );

    it('hands the gauge the medal’s tint, and nothing else of its drawing', () => {
      expect(ownRule('.ui-medal__ring')).toBe(
        '--ui-gauge-tint: var(--ui-medal-tint);',
      );
      // The stroke, the track and the dashes are the gauge's.
      expect(flat).not.toMatch(/--ui-gauge-(?:stroke|track|rim|diameter)/);
      expect(flat).not.toContain('dashed');
    });

    it('keeps no meter under the disc, drawn or reserved', () => {
      const { medal, fixture, host } = render((h) => h.level.set(null));
      for (const state of STATES) {
        host.state.set(state);
        fixture.detectChanges();
        expect(medal.querySelector('.ui-medal__meter')).toBeNull();
        expect(medal.querySelector('[data-reserved]')).toBeNull();
        expect(medal.querySelectorAll('ui-gauge')).toHaveLength(1);
      }
      expect(css).not.toContain('ui-medal__meter');
      expect(css).not.toContain('--ui-medal-meter');
    });
  });

  describe('the numeral rule', () => {
    it('draws the highest earned level on the rim of an earned medal', () => {
      const { part } = render();
      expect(part('level')?.textContent).toBe('II');
    });

    it('draws the top numeral on a complete medal, and none on a one-off', () => {
      const { part, fixture, host } = render((h) => {
        h.state.set('complete');
        h.level.set('V');
      });
      expect(part('level')?.textContent).toBe('V');
      host.level.set(null);
      fixture.detectChanges();
      expect(part('level')).toBeNull();
    });

    it('draws no numeral on a medal with no level won, and says so in development', () => {
      const warn = vi
        .spyOn(console, 'warn')
        .mockImplementation(() => undefined);
      const { part, fixture, host } = render((h) => h.state.set('inProgress'));
      expect(part('level')).toBeNull();
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0]?.[0])).toContain('uiLevel');
      host.state.set('notStarted');
      fixture.detectChanges();
      expect(part('level')).toBeNull();
    });

    it('says nothing of a level on a medal that won it', () => {
      const warn = vi
        .spyOn(console, 'warn')
        .mockImplementation(() => undefined);
      const { fixture, host } = render();
      host.state.set('complete');
      fixture.detectChanges();
      expect(warn).not.toHaveBeenCalled();
    });

    it('keeps the target in words, in the caption', () => {
      const { part } = render();
      expect(part('caption')?.textContent).toBe('24/25 до III');
      expect(part('title')?.textContent).toBe('Фейд');
    });

    it('sets the chip at 6 o’clock ON the ring, half over its box, above the disc', () => {
      const { part } = render();
      expect(part('level')?.parentElement).toBe(part('figure'));
      const chip = ownRule('.ui-medal__level');
      // A grid item of the figure's cell: centred in either direction of
      // text, its middle on the box's bottom edge.
      expect(chip).toContain('place-self: end center;');
      expect(chip).toContain('translate: 0 50%;');
      expect(chip).not.toMatch(/inset-inline|inset-block/);
      // Over the disc, whose foot it covers.
      expect(chip).toContain('position: relative;');
      expect(chip).toContain('z-index: 1;');
      expect(declared(chip, 'block-size')).toBe('var(--ui-medal-chip)');
      expect(declared(chip, 'min-inline-size')).toBe('var(--ui-medal-chip)');
    });

    it('cuts the chip out of the ring by a ring of the ground', () => {
      const chip = ownRule('.ui-medal__level');
      const ground = 'var(--ui-medal-stack-ring, var(--sys-color-surface))';
      expect(declared(chip, 'background')).toBe(ground);
      expect(declared(chip, 'box-shadow')).toBe(
        `inset 0 0 0 var(--sys-stroke-mark) var(--sys-color-separator), 0 0 0 var(--sys-stroke-emphasis) ${ground}`,
      );
      // Ink, never the tint: a numeral is a word.
      expect(declared(chip, 'color')).toBe('var(--sys-color-foreground)');
    });

    it('sets the numeral in the caption at 600, and in the subheadline at 700 on the portrait rung', () => {
      const chip = ownRule('.ui-medal__level');
      expect(declared(chip, 'font')).toBe('var(--sys-font-caption)');
      expect(declared(chip, 'font-weight')).toBe('600');
      const hero = ownRule(
        ".ui-medal[data-control-size='extraLarge'] .ui-medal__level",
      );
      expect(declared(hero, 'font')).toBe('var(--sys-font-subheadline)');
      expect(declared(hero, 'font-weight')).toBe('700');
      // A `font` shorthand resets the figures: each re-asserts them after it.
      for (const rule of [chip, hero]) {
        expect(
          rule.indexOf('font-variant-numeric: tabular-nums;'),
        ).toBeGreaterThan(rule.indexOf('font: var('));
        expect(declared(rule, 'line-height')).toBe('1');
      }
    });
  });

  describe('the face', () => {
    it('draws the art first, then a monogram, then the emblem', () => {
      const { part, fixture, host } = render((h) => {
        h.src.set('/media/fade.jpg');
        h.monogram.set('Ф');
      });
      const art = part('art') as HTMLImageElement;
      expect(art.getAttribute('src')).toBe('/media/fade.jpg');
      expect(art.getAttribute('alt')).toBe('');
      expect(part('monogram')).toBeNull();
      expect(part('glyph')).toBeNull();
      host.src.set(null);
      fixture.detectChanges();
      expect(part('art')).toBeNull();
      expect(part('monogram')?.textContent).toBe('Ф');
      expect(part('glyph')).toBeNull();
      host.monogram.set(null);
      fixture.detectChanges();
      expect(part('glyph')?.getAttribute('data-name')).toBe(
        'loyalty.badge.service',
      );
    });

    it('draws the medal alone when there is nothing to say under it', () => {
      const { medal, part, fixture, host } = render();
      host.title.set(null);
      host.caption.set(null);
      fixture.detectChanges();
      expect(part('title')).toBeNull();
      expect(part('caption')).toBeNull();
      expect(part('disc')).not.toBeNull();
      // The band is there and holds nothing: it takes no room.
      expect([...medal.children].map((el) => el.classList[0])).toEqual([
        'ui-medal__marker',
        'ui-medal__figure',
      ]);
    });
  });

  describe('one baseline in a grid', () => {
    it('is a tile with a title or a caption, and the medal alone is not', () => {
      const { medal, fixture, host } = render((h) => {
        h.state.set('notStarted');
        h.level.set(null);
        h.title.set(null);
      });
      expect(medal.hasAttribute('data-tile')).toBe(true);
      host.caption.set(null);
      fixture.detectChanges();
      expect(medal.hasAttribute('data-tile')).toBe(false);
    });

    it('keeps the chip’s room under the ring of every tile, won or not; the medal alone is its ring’s box', () => {
      const room = '.ui-medal[data-tile] > .ui-medal__figure';
      expect(ownRule(room)).toBe(
        'margin-block-end: calc(var(--ui-medal-chip) / 2 + var(--sys-space-tight));',
      );
      // Nothing else gives the figure room under it.
      const others = [...flat.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter(
        ([, selector = '', body = '']) =>
          selector.includes('.ui-medal__figure') &&
          selector.trim() !== room &&
          /margin-block-end|margin:|padding/.test(body),
      );
      expect(others).toEqual([]);
      // jsdom lays nothing out, so the contract is the rule each figure matches.
      const { medal, part, fixture, host } = render((h) => h.level.set(null));
      for (const state of STATES) {
        host.state.set(state);
        fixture.detectChanges();
        expect(part('figure')?.matches(room)).toBe(true);
      }
      host.title.set(null);
      host.caption.set(null);
      fixture.detectChanges();
      expect(medal.hasAttribute('data-tile')).toBe(false);
      expect(part('figure')?.matches(room)).toBe(false);
    });

    it('holds the chip inside a bare button’s own box, evenly above and under the ring', () => {
      expect(ownRule('button.ui-medal:not([data-tile])')).toBe(
        'padding-block: calc(var(--ui-medal-chip) / 2 + var(--sys-space-tight));',
      );
      const { button } = render();
      expect(button.matches('button.ui-medal:not([data-tile])')).toBe(true);
      // A tile's button: a compact step over the ring and under the words,
      // a tight one beside the ring.
      const tile = ownRule('button.ui-medal');
      expect(declared(tile, '--ui-medal-gutter')).toBe(
        'var(--sys-space-tight)',
      );
      expect(declared(tile, 'padding')).toBe(
        'var(--sys-space-compact) var(--ui-medal-gutter)',
      );
    });

    it('gives the words the tile’s whole width: they run over the gutter beside the ring', () => {
      // In a column of 87 a title has 87, not 79: «Ранобудник» stays on one
      // line and «Подстриж-» on its first. An image has no gutter.
      for (const part of ['title', 'caption']) {
        expect(declared(ownRule(`.ui-medal__${part}`), 'max-inline-size')).toBe(
          'calc(100% + 2 * var(--ui-medal-gutter, 0px))',
        );
      }
      // Centred, so what runs over does so evenly on both sides.
      expect(declared(ownRule('.ui-medal'), 'justify-items')).toBe('center');
      expect(ownRule('.ui-medal')).not.toContain('--ui-medal-gutter');
    });

    it('aligns a row of tiles per row, not per tile: the title holds only the lines it needs', () => {
      // Wave D r3: every title held two lines, so a row where none wraps
      // («21.08», «14.07», «Години с нас») had a blank line in every tile.
      const title = ownRule('.ui-medal__title');
      expect(title).toContain('line-clamp: 2;');
      expect(title).not.toContain('min-block-size');
      // A medal is three tracks — ring, title, caption — and a tile takes
      // them from the row it sits in, so each is the row's tallest…
      const medal = ownRule('.ui-medal');
      expect(medal).toContain('display: inline-grid;');
      expect(ownRule('.ui-medal[data-tile]')).toBe(
        'grid-row: span 3; grid-template-rows: subgrid;',
      );
      // …the tracks touching (the room between them is each part's own)…
      expect(medal).toContain('row-gap: 0;');
      // …its parts centred across, each at the top of its track (a one-line
      // title never floats down a two-line track)…
      expect(medal).toContain('justify-items: center;');
      expect(medal).toContain('align-items: start;');
      // …and every part PLACED, in its own track of the medal's one
      // column: a tile without a title never lifts its caption into the
      // titles' line, and the marker, which shares the ring's track, never
      // opens a second column beside it.
      expect(declared(medal, 'grid-template-columns')).toBe('minmax(0, 1fr)');
      for (const [part, track] of [
        ['marker', 1],
        ['figure', 1],
        ['title', 2],
        ['caption', 3],
      ] as const) {
        expect(declared(ownRule(`.ui-medal__${part}`), 'grid-area')).toBe(
          `${track} / 1`,
        );
      }
    });

    it('takes the tracks from a rail or a grid, through the list item that wraps it', () => {
      // The wrapper (a component host, a div[role=listitem]) passes them on.
      expect(
        ownRule(':is(.ui-scroll-row, .ui-grid) > :has(> .ui-medal[data-tile])'),
      ).toBe(
        'display: grid; grid-row: span 3; grid-template-rows: subgrid; row-gap: 0;',
      );
      // A rail becomes one band of the three tracks, its columns the share
      // the row gives its items — one formula, published by scroll-row.css.
      const rail =
        '.ui-scroll-row:has(> .ui-medal[data-tile], > * > .ui-medal[data-tile])';
      expect(ownRule(rail)).toBe(
        'display: grid; grid-auto-flow: column; grid-template-rows: repeat(3, auto); row-gap: 0;',
      );
      const relative = rail.replace(
        '.ui-scroll-row',
        '.ui-scroll-row[data-relative]',
      );
      expect(ownRule(relative)).toBe(
        'grid-auto-columns: var(--ui-scroll-row-item);',
      );
      expect(ownRule(`${relative} > *`)).toBe('inline-size: auto;');
      const row = readFileSync(
        resolve(
          __dirname,
          '../../../../layout/src/lib/scroll-row/scroll-row.css',
        ),
        'utf8',
      ).replace(/\s+/g, ' ');
      expect(row).toMatch(
        /\.ui-scroll-row\[data-relative\] \{ --ui-scroll-row-item: calc\(/,
      );
      // A grid lays each tile over three of its rows as it is: auto rows.
      const grid = readFileSync(
        resolve(__dirname, '../../../../layout/src/lib/grid/grid.css'),
        'utf8',
      ).replace(/\s+/g, ' ');
      expect(grid).toMatch(
        /\.ui-grid \{ display: grid;[^}]*grid-auto-rows: max-content;/,
      );
    });

    it('keeps the parts in order: the marker’s band, the ring, the title, the caption', () => {
      const { medal } = render();
      expect([...medal.children].map((el) => el.classList[0])).toEqual([
        'ui-medal__marker',
        'ui-medal__figure',
        'ui-medal__title',
        'ui-medal__caption',
      ]);
    });

    it.each([
      // size, the title's role, the caption's
      ['regular', 'footnote', 'caption'],
      ['large', 'subheadline', 'footnote'],
      ['extraLarge', 'headline', 'callout'],
    ] as const)(
      'names a %s medal in the %s and captions it in the %s',
      (size, titleRole, captionRole) => {
        const scope =
          size === 'large' ? '' : `.ui-medal[data-control-size='${size}'] `;
        const title = ownRule(`${scope}.ui-medal__title`);
        const caption = ownRule(`${scope}.ui-medal__caption`);
        expect(declared(title, 'font')).toBe(`var(--sys-font-${titleRole})`);
        expect(declared(caption, 'font')).toBe(
          `var(--sys-font-${captionRole})`,
        );
        // A title is 600 (the headline role is 600 of its own).
        if (titleRole !== 'headline') {
          expect(declared(title, 'font-weight')).toBe('600');
        }
        // Every number is tabular, re-asserted after the shorthand.
        for (const rule of [title, caption]) {
          expect(
            rule.indexOf('font-variant-numeric: tabular-nums;'),
          ).toBeGreaterThan(rule.indexOf('font: var('));
        }
      },
    );

    it('sets the title in primary ink and the caption in the quiet one, half a tight step under it', () => {
      expect(declared(ownRule('.ui-medal'), 'color')).toBe(
        'var(--sys-color-foreground)',
      );
      expect(ownRule('.ui-medal__title')).not.toMatch(/(?:^|; )color:/);
      const caption = ownRule('.ui-medal__caption');
      expect(declared(caption, 'color')).toBe(
        'var(--sys-color-secondary-label)',
      );
      expect(declared(caption, 'margin-block-start')).toBe(
        'calc(var(--sys-space-tight) / 2)',
      );
    });
  });

  describe('the marker', () => {
    it('carries the consumer’s «Ново» in the medal’s one decoration slot — a count is caption words, never a mark', () => {
      const { part, fixture, host, medal } = render();
      // The band is the head of the ring's own track.
      expect(part('marker')?.parentElement).toBe(medal);
      expect(medal.firstElementChild).toBe(part('marker'));
      expect(
        part('marker')?.querySelector('[data-testid="marker"]')?.textContent,
      ).toBe('Ново');
      // A day's levels are counted once, in its caption («3 нива»): the
      // medal has no second slot.
      expect(part('count')).toBeNull();
      expect(medal.querySelector('[uimedalcount]')).toBeNull();
      host.isNew.set(false);
      fixture.detectChanges();
      expect(part('marker')?.children).toHaveLength(0);
      expect(part('marker')?.matches(':empty')).toBe(true);
    });

    it('stands the marker over the ring as a label — a tight step above its top edge, top-trailing — never on the glyph', () => {
      // Wave D r4: its bottom ON the edge read ≈ 1 pt apart, a floating
      // eyebrow; a label keeps the tight step (4).
      const band = ownRule('.ui-medal__marker');
      // In flow, inside the medal's own box: a state layer takes it in and
      // a rail never clips it.
      expect(band).not.toMatch(/position|inset|z-index/);
      // The head of the ring's track, as wide as the ring, the badge on its
      // trailing edge and on its foot, a tight step over the ring.
      expect(declared(band, 'align-self')).toBe('start');
      expect(declared(band, 'inline-size')).toBe(
        'calc(var(--ui-medal-disc) + 2 * var(--ui-medal-rim))',
      );
      expect(declared(band, 'block-size')).toBe(
        'var(--ui-medal-marker-clearance)',
      );
      expect(declared(band, 'justify-content')).toBe('flex-end');
      expect(declared(band, 'align-items')).toBe('flex-end');
      expect(declared(band, 'padding-block-end')).toBe(
        'var(--sys-space-tight)',
      );
      // Empty, it is nothing.
      expect(ownRule('.ui-medal__marker:empty')).toBe('display: none;');
    });

    it('sets the ring under the band: its own marker’s, or the one its row keeps', () => {
      const figure = ownRule('.ui-medal__figure');
      // On the foot of its track: beside a marked neighbour a ring stands
      // on the same line.
      expect(declared(figure, 'align-self')).toBe('end');
      expect(declared(figure, 'margin-block-start')).toBe(
        'var(--ui-medal-marker-room, 0px)',
      );
      const marked =
        '.ui-medal:has(> .ui-medal__marker:not(:empty)) > .ui-medal__figure';
      expect(ownRule(marked)).toBe(
        'margin-block-start: var(--ui-medal-marker-clearance);',
      );
      const { part, fixture, host } = render();
      expect(part('figure')?.matches(marked)).toBe(true);
      host.isNew.set(false);
      fixture.detectChanges();
      expect(part('figure')?.matches(marked)).toBe(false);
      // The medal itself pads nothing for it any more.
      expect(ownRule('.ui-medal')).not.toContain('--ui-medal-marker-room');
      expect(ownRule('button.ui-medal')).not.toContain(
        '--ui-medal-marker-room',
      );
    });

    it('keeps no count slot in the stylesheet', () => {
      expect(css).not.toContain('ui-medal__count');
    });

    it('reserves the band itself for a row that carries a marker — a rail, a grid, or a row marked data-medal-row', () => {
      // Wave D r3: the `:has()` was copied into two feature files, each
      // naming the DS-internal `.ui-medal__marker`. The DS writes it once.
      expect(
        ownRule(
          ':where(:is(.ui-scroll-row, .ui-grid, [data-medal-row]):has(.ui-medal__marker:not(:empty)))',
        ),
      ).toBe('--ui-medal-marker-room: var(--ui-medal-marker-clearance);');
      // The badge's box (22.3) and the tight step under it: 24 + 4.
      expect(ownRule(':root')).toBe(
        '--ui-medal-marker-clearance: calc(var(--sys-space-comfortable) + var(--sys-space-tight));',
      );
      // What the rule keys on: a row holding a projected marker, not one
      // whose markers are all empty.
      const { fixture, host, medal } = render();
      const row = document.createElement('div');
      row.setAttribute('data-medal-row', '');
      medal.replaceWith(row);
      row.append(medal);
      const reserves =
        ':is(.ui-scroll-row, .ui-grid, [data-medal-row]):has(.ui-medal__marker:not(:empty))';
      expect(row.matches(reserves)).toBe(true);
      host.isNew.set(false);
      fixture.detectChanges();
      expect(row.matches(reserves)).toBe(false);
    });

    it('pays for a marker in ITS row only: in a grid or a rail the row’s tiles share the ring’s track', () => {
      // Reserved over the whole grid, three rows of medals carried 56 pt of
      // air for one «Ново». The marked tile makes the shared track taller
      // and its neighbours stand on the track's foot, so the grid-wide room
      // is switched off for tiles.
      const perRow =
        ':is(.ui-scroll-row, .ui-grid) > .ui-medal[data-tile], :is(.ui-scroll-row, .ui-grid) > * > .ui-medal[data-tile]';
      expect(ownRule(perRow)).toBe('--ui-medal-marker-room: 0px;');
      // After the rule that reserves, and more specific than its zero.
      expect(flat.indexOf(`${perRow} {`)).toBeGreaterThan(
        flat.indexOf(
          '--ui-medal-marker-room: var(--ui-medal-marker-clearance)',
        ),
      );
      const { medal, fixture, host } = render();
      const grid = document.createElement('div');
      grid.className = 'ui-grid';
      const item = document.createElement('div');
      medal.replaceWith(grid);
      item.append(medal);
      grid.append(item);
      expect(medal.matches(perRow)).toBe(true);
      // The medal alone in a grid still takes the row's room: it shares no
      // track with its neighbours.
      host.title.set(null);
      host.caption.set(null);
      fixture.detectChanges();
      expect(medal.matches(perRow)).toBe(false);
    });
  });

  describe('the stack', () => {
    it('draws several medals as one item only when asked — form on the host, never a second face or a count', () => {
      const { fixture, host, medal, button, part } = render();
      expect(medal.hasAttribute('data-stacked')).toBe(false);
      expect(button.hasAttribute('data-stacked')).toBe(false);
      host.stacked.set(true);
      fixture.detectChanges();
      expect(medal.getAttribute('data-stacked')).toBe('');
      // The medal behind is the stylesheet's: one ring, one disc, one face,
      // one rim numeral in the DOM, and the sentence unchanged.
      expect(medal.querySelectorAll('.ui-medal__ring')).toHaveLength(1);
      expect(medal.querySelectorAll('.ui-medal__disc')).toHaveLength(1);
      expect(medal.querySelectorAll('.ui-medal__glyph')).toHaveLength(1);
      expect(part('level')?.textContent?.trim()).toBe('II');
      expect(medal.getAttribute('aria-label')).toBe(host.label());
    });

    it('puts a second medal behind the front one — a disc of the RING’s size, a compact step aside, cut out by the ground’s ring', () => {
      const stack = ownRule('.ui-medal[data-stacked]');
      // Behind the ring, never behind the ground under the medal.
      expect(stack).toContain('isolation: isolate;');
      // The ground under the front ring is the ring's own box, and the cut
      // round it: its track is translucent, it needs the ground.
      const ground = 'var(--ui-medal-stack-ring, var(--sys-color-surface))';
      const plate = ownRule('.ui-medal[data-stacked] .ui-medal__ring');
      expect(declared(plate, 'background')).toBe(ground);
      expect(declared(plate, 'box-shadow')).toBe(
        `0 0 0 var(--sys-stroke-emphasis) ${ground}`,
      );
      expect(declared(plate, 'border-radius')).toBe(
        'var(--control-radius-capsule)',
      );
      // The disc wears no cut of its own: at `regular` it would eat the ring.
      expect(flat).not.toMatch(
        /\.ui-medal\[data-stacked\] \.ui-medal__disc \{[^}]*box-shadow/,
      );
      const behind = ownRule('.ui-medal[data-stacked] .ui-medal__disc::before');
      expect(behind).toContain('position: absolute;');
      // The ring's box, said from the disc: a rim out on every side…
      expect(declared(behind, 'inset-block')).toBe(
        'calc(var(--ui-medal-rim) * -1)',
      );
      expect(declared(behind, 'inline-size')).toBe(
        'calc(100% + 2 * var(--ui-medal-rim))',
      );
      // …and a compact step to the trailing side: past the cut it shows a
      // crescent a stroke wider than the ring's own arc, a medal, not an arc.
      expect(declared(behind, 'inset-inline-start')).toBe(
        'calc(var(--sys-space-compact) - var(--ui-medal-rim))',
      );
      expect(behind).toContain('z-index: -1;');
      expect(behind).toContain('border-radius: inherit;');
    });

    it('wears the front disc’s own fill — a pile of earned medals — and, short of earned, the meter track’s ink', () => {
      const behind =
        /\.ui-medal\[data-stacked\] \.ui-medal__disc::before\s*\{([^}]*)\}/.exec(
          css,
        )?.[1] ?? '';
      expect(behind).toContain('background: inherit;');
      const unearned =
        /\.ui-medal\[data-stacked\]:not\(\[data-state='earned'\]\) \.ui-medal__disc::before\s*\{([^}]*)\}/.exec(
          css,
        )?.[1] ?? '';
      expect(unearned.replace(/\s+/g, ' ')).toContain(
        'box-shadow: inset 0 0 0 var(--sys-stroke-mark) var(--sys-color-secondary-label);',
      );
      // The fill is translucent: short of earned, the front disc lays it on
      // the ground's colour, so the disc behind never shows through it.
      const front =
        /\.ui-medal\[data-stacked\]:not\(\[data-state='earned'\]\) \.ui-medal__disc\s*\{([^}]*)\}/.exec(
          css,
        )?.[1] ?? '';
      expect(front.replace(/\s+/g, ' ')).toContain(
        'background: linear-gradient(var(--sys-color-fill), var(--sys-color-fill)) var(--ui-medal-stack-ring, var(--sys-color-surface));',
      );
    });

    it('draws a complete stack as a pile of medals won, as an earned one', () => {
      // The two rules above are keyed on «not earned»; a complete medal
      // takes its fill back, after them and as specific as they are.
      const front =
        ".ui-medal[data-stacked][data-state='complete'] .ui-medal__disc";
      expect(ownRule(front)).toBe('background: var(--ui-medal-tint);');
      expect(ownRule(`${front}::before`)).toBe('box-shadow: none;');
      const unearned =
        ".ui-medal[data-stacked]:not([data-state='earned']) .ui-medal__disc";
      expect(flat.indexOf(`${front} {`)).toBeGreaterThan(
        flat.indexOf(`${unearned} {`),
      );
      expect(flat.indexOf(`${front}::before {`)).toBeGreaterThan(
        flat.indexOf(`${unearned}::before {`),
      );
    });
  });

  describe('the ground', () => {
    it('names the elevated card’s and the stage’s colour itself, where a consumer can still say otherwise', () => {
      // Zero specificity, and set on the ground, not on the medal: a
      // consumer's own value, there or nearer the medal, wins.
      expect(
        ownRule(
          ":where(.ui-card[data-tone='elevated'], .ui-sheet-headline[data-media-stage])",
        ),
      ).toBe('--ui-medal-stack-ring: var(--sys-color-surface-elevated);');
      expect(flat).not.toMatch(/\.ui-medal[^{]*\{[^}]*--ui-medal-stack-ring:/);
    });

    it('stands quietly on an elevated card, a plain one and the sheet', () => {
      const warn = vi
        .spyOn(console, 'warn')
        .mockImplementation(() => undefined);
      for (const tone of ['elevated', 'plain'] as const) {
        const medal = renderOn((h) => h.tone.set(tone));
        expect(medal.closest('.ui-card')?.getAttribute('data-tone')).toBe(tone);
        TestBed.resetTestingModule();
      }
      renderOn((h) => h.ground.set('sheet'));
      expect(warn).not.toHaveBeenCalled();
    });

    it('warns in development on a muted card: the accent arc is 2.84:1 on grey', () => {
      const warn = vi
        .spyOn(console, 'warn')
        .mockImplementation(() => undefined);
      const medal = renderOn((h) => h.tone.set('muted'));
      expect(medal.closest('.ui-card')?.getAttribute('data-tone')).toBe(
        'muted',
      );
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0]?.[0])).toContain('[ui-medal]');
      expect(String(warn.mock.calls[0]?.[0])).toContain('muted card');
    });

    it('warns in development inside a list group', () => {
      const warn = vi
        .spyOn(console, 'warn')
        .mockImplementation(() => undefined);
      const medal = renderOn((h) => h.ground.set('list'));
      expect(medal.closest('.ui-list-group')).not.toBeNull();
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0]?.[0])).toContain('[ui-medal]');
      expect(String(warn.mock.calls[0]?.[0])).toContain('list group');
    });
  });

  describe('the stylesheet', () => {
    it('fills an earned disc with the accent — the meter family — and its glyph in the on-accent ink', () => {
      const root = /\.ui-medal\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
      expect(root).toContain('--ui-medal-tint: var(--sys-color-accent);');
      const earned =
        /\[data-state='earned'\] \.ui-medal__disc\s*\{([^}]*)\}/.exec(
          css,
        )?.[1] ?? '';
      expect(earned).toContain('background: var(--ui-medal-tint)');
      expect(earned).toContain('color: var(--sys-color-on-accent)');
    });

    it('draws a complete medal’s face as an earned one’s', () => {
      expect(ownRule(".ui-medal[data-state='complete'] .ui-medal__disc")).toBe(
        ownRule(".ui-medal[data-state='earned'] .ui-medal__disc"),
      );
    });

    it('tells the four states apart by form: a dashed ring, an arc, a filled disc, a full ring', () => {
      const filled = [
        ".ui-medal[data-state='earned'] .ui-medal__disc",
        ".ui-medal[data-state='complete'] .ui-medal__disc",
      ];
      const { part, ring, fixture, host } = render((h) => {
        h.level.set(null);
        h.value.set(0.5);
      });
      const form = (state: UiMedalState) => {
        host.state.set(state);
        fixture.detectChanges();
        return {
          dashed: ring()?.getAttribute('data-extent') === 'dashed',
          arc: !ring()?.hasAttribute('data-empty'),
          full: ring()?.hasAttribute('data-complete') ?? false,
          filled: filled.some((rule) => part('disc')?.matches(rule)),
        };
      };
      expect(form('notStarted')).toEqual({
        dashed: true,
        arc: false,
        full: false,
        filled: false,
      });
      expect(form('inProgress')).toEqual({
        dashed: false,
        arc: true,
        full: false,
        filled: false,
      });
      expect(form('earned')).toEqual({
        dashed: false,
        arc: true,
        full: false,
        filled: true,
      });
      expect(form('complete')).toEqual({
        dashed: false,
        arc: true,
        full: true,
        filled: true,
      });
      // The disc wears no ring of its own any more: the gauge draws it.
      expect(flat).not.toContain('.ui-medal__disc::after');
      // A silhouette is the quiet ink, never a padlock.
      expect(
        declared(
          ownRule(".ui-medal[data-state='notStarted'] .ui-medal__disc"),
          'color',
        ),
      ).toBe('var(--sys-color-secondary-label)');
    });

    it('paints the tint as a fill and an arc, never as ink', () => {
      const inked = [...flat.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
        .filter(([, , body = '']) =>
          /(?:^|; ?)\s*color: var\(--(?:ui-medal-tint|sys-color-accent)\)/.test(
            body,
          ),
        )
        .map(([, selector = '']) => selector.trim());
      expect(inked).toEqual([]);
    });

    it('breaks a long title or caption at a hyphenation point, not anywhere', () => {
      const rules = [
        /\.ui-medal__title\s*\{([^}]*)\}/.exec(css)?.[1] ?? '',
        /\.ui-medal__caption\s*\{([^}]*)\}/.exec(css)?.[1] ?? '',
      ];
      for (const rule of rules) {
        expect(rule).toContain('hyphens: auto;');
        expect(rule).toContain('overflow-wrap: break-word;');
      }
      expect(css).not.toContain('overflow-wrap: anywhere');
    });

    it('puts the emblem on the icon ladder — 24 in the large disc, 20 in the regular — and sizes the monogram by the disc', () => {
      expect(css).toMatch(
        /\.ui-medal__glyph\s*\{\s*font-size: var\(--ui-icon-large\);/,
      );
      expect(css).toMatch(
        /\.ui-medal\[data-control-size='regular'\] \.ui-medal__glyph\s*\{\s*font-size: var\(--ui-icon-medium\);/,
      );
      expect(css).toMatch(
        /\.ui-medal__monogram\s*\{\s*font-size: calc\(var\(--ui-medal-disc\) \* 0\.5\);/,
      );
      expect(css).not.toMatch(/\.ui-medal__glyph[^{]*\{[^}]*--ui-medal-disc/);
    });

    it('shares the portrait rung with the avatar: one token, read by both', () => {
      // A hero that swaps a face for a medal does not move. The rung was
      // the avatar's own literal (28 units) until the medal drew at it too.
      const avatar = flatten(
        readFileSync(
          resolve(__dirname, '../../../../controls/src/lib/avatar/avatar.css'),
          'utf8',
        ),
      );
      const portrait = ownRule(
        ".ui-avatar[data-control-size='extraLarge']",
        avatar,
        'avatar.css',
      );
      expect(declared(portrait, '--ui-avatar-disc')).toBe(
        'var(--control-size-extraLarge)',
      );
      expect(avatar).not.toContain('var(--sys-space-unit) * 28');
      expect(declared(sizeRule('extraLarge'), '--ui-medal-disc')).toBe(
        'var(--control-size-extraLarge)',
      );
      expect(tokenPoints('--control-size-extraLarge')).toBe(112);
    });

    it('draws the portrait rung’s emblem at the disc’s scale: the ladder ends at 24, a speck on 112', () => {
      const hero = ownRule(
        ".ui-medal[data-control-size='extraLarge'] .ui-medal__glyph",
      );
      expect(hero).toBe(
        'font-size: calc(var(--control-size-extraLarge) * 0.5);',
      );
      // The monogram's share, so an emblem and a letter are one size there.
      expect(tokenPoints('--control-size-extraLarge') * 0.5).toBe(56);
    });

    it('pins art of any ratio to the disc’s own box — never a grid row sized by the picture', () => {
      // jsdom lays nothing out, so the stylesheet is the contract: the art is
      // absolutely inset in the positioned disc, filling it on both axes and
      // cropped by `cover`, and the disc never clips (the stack's second
      // medal is drawn from it).
      const art = /\.ui-medal__art\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
      expect(art).toContain('position: absolute;');
      expect(art).toContain('inset: 0;');
      expect(art).toContain('inline-size: 100%;');
      expect(art).toContain('block-size: 100%;');
      expect(art).toContain('object-fit: cover;');
      expect(art).toContain('border-radius: inherit;');
      const disc = /\.ui-medal__disc\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
      expect(disc).toContain('position: relative;');
      expect(disc).not.toMatch(/overflow/);
      // The rim numeral stands over the art's foot.
      expect(ownRule('.ui-medal__level')).toContain('z-index: 1;');
    });

    it('lets the picture alone reach the disc’s edge: the fill under it stops a stroke short', () => {
      // The tint of a medal won drew an orange hairline round the
      // photograph, where the two edges meet.
      expect(ownRule('.ui-medal__disc:has(> .ui-medal__art)')).toBe(
        'padding: var(--sys-stroke-emphasis); background-clip: content-box;',
      );
      const { part, fixture, host } = render((h) =>
        h.src.set('/media/fade.jpg'),
      );
      expect(
        part('disc')?.matches('.ui-medal__disc:has(> .ui-medal__art)'),
      ).toBe(true);
      host.src.set(null);
      fixture.detectChanges();
      expect(
        part('disc')?.matches('.ui-medal__disc:has(> .ui-medal__art)'),
      ).toBe(false);
    });

    it('keeps full colour for art that is won — short of it the art is grey, a step up from not started', () => {
      // Wave D r5: an in-progress portrait kept its colour under the tint
      // ring and read as earned beside a hollow glyph medal. The contract is
      // the art rules each state's picture matches (jsdom paints nothing).
      const artRules = [...flat.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
        .map(
          ([, selector = '', body = '']) =>
            [selector.trim(), body.trim()] as const,
        )
        .filter(
          ([selector]) =>
            selector.includes('.ui-medal__art') && !selector.includes('::'),
        );
      const { part, fixture, host } = render((h) => {
        h.src.set('/media/beard.jpg');
        h.level.set(null);
      });
      const face = (state: UiMedalState) => {
        host.state.set(state);
        fixture.detectChanges();
        const art = part('art') as HTMLElement;
        return artRules
          .filter(
            ([selector]) =>
              selector !== '.ui-medal__art' && art.matches(selector),
          )
          .map(([, body]) => body)
          .join(' ');
      };
      const notStarted = face('notStarted');
      const inProgress = face('inProgress');
      const earned = face('earned');
      const complete = face('complete');
      expect(new Set([notStarted, inProgress, earned]).size).toBe(3);
      expect(notStarted).toBe('filter: grayscale(1); opacity: 0.45;');
      expect(inProgress).toBe('filter: grayscale(1); opacity: 0.75;');
      // A medal won, and it alone, draws the art as it is.
      expect(earned).toBe('');
      expect(complete).toBe('');
    });

    it('draws a portrait picture inside the disc, in every state', () => {
      const { part, fixture, host, medal } = render((h) => {
        h.src.set('/media/portrait-400x600.jpg');
        h.level.set(null);
      });
      for (const state of STATES) {
        host.state.set(state);
        fixture.detectChanges();
        const art = part('art');
        // The art is the disc's only picture, a direct child the inset
        // rule above pins to the disc's box.
        expect(art?.parentElement).toBe(part('disc'));
        expect(medal.dataset['state']).toBe(state);
      }
    });

    it('moves nothing on mount: the disc’s cross-fade belongs to a live change, and to those who allow motion', () => {
      // At rest the disc swaps: the first rule of the two that name it.
      const [rest, live, ...more] = [...flat.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
        .filter(([, selector = '']) =>
          selector.trim().endsWith('.ui-medal__disc'),
        )
        .filter(([, , body = '']) => body.includes('transition'))
        .map(([, , body = '']) => body.trim());
      expect(more).toEqual([]);
      expect(declared(rest ?? '', 'transition-property')).toBe(
        'background-color, color',
      );
      expect(declared(rest ?? '', 'transition-duration')).toBe('0s');
      // The beat is given inside the motion query, and nowhere else.
      expect(declared(live ?? '', 'transition-duration')).toBe(
        'var(--sys-motion-duration-deliberate)',
      );
      const motion = flat.slice(
        flat.indexOf('@media (prefers-reduced-motion: no-preference)'),
      );
      expect(motion).toContain(`.ui-medal__disc { ${live}`);
      expect(flat.match(/--sys-motion-duration/g)).toHaveLength(1);
      expect(flat).not.toMatch(/animation|@keyframes/);
    });
  });
});
