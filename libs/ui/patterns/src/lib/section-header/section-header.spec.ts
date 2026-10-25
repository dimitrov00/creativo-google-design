import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { UiIconName } from '@creativo/ui/icons';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from 'vitest';
import {
  UiSectionHeader,
  type UiSectionHeaderProminence,
} from './section-header';

/** The landing trio — the default, which the sheet headings must not move. */
@Component({
  imports: [UiSectionHeader],
  template: `
    <ui-section-header data-testid="trio" uiIcon="client.visits">
      <p uiEyebrow>Our craft</p>
      <h2 uiTitle>Color that reads as light</h2>
      <p uiLede>Built on a consultation, not a swatch book.</p>
    </ui-section-header>
  `,
})
class TrioHost {}

/** A sheet heading: every slot the two prominences take. */
@Component({
  imports: [UiSectionHeader],
  template: `
    <ui-section-header
      data-testid="heading"
      [uiHeaderProminence]="prominence()"
      [uiIcon]="icon()"
      [uiPinned]="pinned()"
    >
      <h3 uiTitle id="heading-title">Посещения</h3>
      <span uiSectionDetail>9 посещения</span>
      @if (action()) {
        <button uiSectionAction type="button">24</button>
      }
    </ui-section-header>
  `,
})
class HeadingHost {
  readonly prominence = signal<UiSectionHeaderProminence | null>('increased');
  readonly icon = signal<UiIconName | null>('client.visits');
  readonly pinned = signal(false);
  readonly action = signal(true);
}

/**
 * The action as `uiButton` stamps it. The patterns lib sits under the
 * controls, so the host writes the button's DOM contract (its class and
 * its two attributes), which is all the heading and its stylesheet read.
 */
@Component({
  imports: [UiSectionHeader],
  template: `
    <ui-section-header
      data-testid="heading"
      [uiHeaderProminence]="prominence()"
    >
      <h3 uiTitle>Посещения</h3>
      @if (loaded()) {
        <button
          uiSectionAction
          type="button"
          class="ui-button"
          [attr.data-button-style]="style()"
          [attr.data-control-size]="size()"
        >
          24
        </button>
      } @else {
        <span uiSectionAction data-testid="placeholder"></span>
      }
    </ui-section-header>
  `,
})
class ActionHost {
  readonly prominence = signal<UiSectionHeaderProminence | null>('increased');
  readonly style = signal<'plain' | 'bordered'>('plain');
  readonly size = signal<'small' | 'regular' | 'large'>('small');
  readonly loaded = signal(true);
}

async function mount<T>(type: new () => T): Promise<ComponentFixture<T>> {
  await TestBed.configureTestingModule({
    imports: [type],
    errorOnUnknownElements: true,
    errorOnUnknownProperties: true,
  }).compileComponents();
  const fixture = TestBed.createComponent(type);
  fixture.detectChanges();
  return fixture;
}

describe('UiSectionHeader', () => {
  it('renders the landing trio exactly as before by default — no prominence, no glyph, no pin', async () => {
    const fixture = await mount(TrioHost);
    const host: HTMLElement = fixture.nativeElement.querySelector(
      '[data-testid="trio"]',
    );
    expect(host.classList.contains('ui-section-header')).toBe(true);
    expect(host.getAttribute('data-alignment')).toBe('leading');
    expect(host.getAttribute('data-eyebrow-tone')).toBe('accent');
    expect(host.hasAttribute('data-on-media')).toBe(false);
    expect(host.hasAttribute('data-header-prominence')).toBe(false);
    expect(host.hasAttribute('data-pinned')).toBe(false);
    // The glyph is `increased`'s alone: a trio never draws one.
    expect(host.querySelector('ui-icon')).toBeNull();
    expect(Array.from(host.children).map((child) => child.tagName)).toEqual([
      'P',
      'H2',
      'P',
    ]);
  });

  describe('sheet headings', () => {
    let fixture: ComponentFixture<HeadingHost>;
    const heading = (): HTMLElement =>
      fixture.nativeElement.querySelector('[data-testid="heading"]');

    beforeEach(async () => {
      fixture = await mount(HeadingHost);
    });

    it('places the glyph, the title, the detail and the one action in order (increased)', () => {
      const host = heading();
      expect(host.getAttribute('data-header-prominence')).toBe('increased');
      const children = Array.from(host.children);
      expect(children.map((child) => child.tagName)).toEqual([
        'UI-ICON',
        'H3',
        'SPAN',
        'BUTTON',
      ]);
      const glyph = children[0] as HTMLElement;
      expect(glyph.classList.contains('ui-section-header__glyph')).toBe(true);
      expect(glyph.getAttribute('data-name')).toBe('client.visits');
      expect(glyph.getAttribute('data-scale')).toBe('medium');
      // Decoration: the title says it in words.
      expect(glyph.getAttribute('aria-hidden')).toBe('true');
    });

    it('draws no glyph when an increased heading is given none', () => {
      fixture.componentInstance.icon.set(null);
      fixture.detectChanges();
      expect(heading().querySelector('ui-icon')).toBeNull();
      expect(heading().firstElementChild?.tagName).toBe('H3');
    });

    it('keeps standard to one quiet line: title and detail, never a glyph', () => {
      fixture.componentInstance.prominence.set('standard');
      fixture.componentInstance.action.set(false);
      fixture.detectChanges();
      const host = heading();
      expect(host.getAttribute('data-header-prominence')).toBe('standard');
      expect(host.querySelector('ui-icon')).toBeNull();
      expect(Array.from(host.children).map((child) => child.tagName)).toEqual([
        'H3',
        'SPAN',
      ]);
    });

    it('stamps data-pinned for a pinned standard heading, and only for one', () => {
      fixture.componentInstance.pinned.set(true);
      fixture.detectChanges();
      // `increased` never pins: a module heading scrolls with its module.
      expect(heading().hasAttribute('data-pinned')).toBe(false);

      fixture.componentInstance.prominence.set('standard');
      fixture.detectChanges();
      expect(heading().getAttribute('data-pinned')).toBe('');

      fixture.componentInstance.pinned.set(false);
      fixture.detectChanges();
      expect(heading().hasAttribute('data-pinned')).toBe(false);
    });
  });

  /*
   * THE ACTION'S CONTRACT (revision 3, §3.2): a plain action is the small
   * rung. A taller one still renders; the heading says so, once, in
   * development.
   */
  describe('the action’s rung', () => {
    let warn: MockInstance<typeof console.warn>;

    beforeEach(() => {
      warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    });
    afterEach(() => warn.mockRestore());

    /** Mounts the host as set up, and renders once more for good measure. */
    async function render(
      setup: (host: ActionHost) => void = () => undefined,
    ): Promise<ComponentFixture<ActionHost>> {
      await TestBed.configureTestingModule({
        imports: [ActionHost],
        errorOnUnknownElements: true,
        errorOnUnknownProperties: true,
      }).compileComponents();
      const fixture = TestBed.createComponent(ActionHost);
      setup(fixture.componentInstance);
      fixture.detectChanges();
      await fixture.whenStable();
      return fixture;
    }

    it('says nothing about a small plain action', async () => {
      await render();
      expect(warn).not.toHaveBeenCalled();
    });

    it.each(['regular', 'large'] as const)(
      'warns once about a %s plain action, naming the rung',
      async (size) => {
        const fixture = await render((host) => host.size.set(size));
        expect(warn).toHaveBeenCalledTimes(1);
        const [message] = warn.mock.calls[0] as [string];
        expect(message).toContain('[ui-section-header]');
        expect(message).toContain('uiControlSize="small"');
        expect(message).toContain(`"${size}"`);

        // Once: a heading that re-renders does not repeat itself.
        fixture.componentInstance.style.set('bordered');
        fixture.detectChanges();
        fixture.componentInstance.style.set('plain');
        fixture.detectChanges();
        await fixture.whenStable();
        expect(warn).toHaveBeenCalledTimes(1);
      },
    );

    it('leaves another style’s rung to that style: a bordered action has no padding to hug', async () => {
      await render((host) => {
        host.style.set('bordered');
        host.size.set('regular');
      });
      expect(warn).not.toHaveBeenCalled();
    });

    it('never speaks for the landing trio', async () => {
      await render((host) => {
        host.prominence.set(null);
        host.size.set('large');
      });
      expect(warn).not.toHaveBeenCalled();
    });

    it('sees an action that arrives after its placeholder', async () => {
      const fixture = await render((host) => {
        host.loaded.set(false);
        host.size.set('regular');
      });
      expect(
        fixture.nativeElement.querySelector('[data-testid="placeholder"]'),
      ).not.toBeNull();
      expect(warn).not.toHaveBeenCalled();

      fixture.componentInstance.loaded.set(true);
      fixture.detectChanges();
      await fixture.whenStable();
      expect(warn).toHaveBeenCalledTimes(1);
    });
  });
});

/*
 * THE TYPE AND THE PIN, READ FROM THE STYLESHEET. jsdom lays nothing out,
 * so the roles are held where they are written.
 */
describe('section-header.css · sheet headings', () => {
  const css = readFileSync(resolve(__dirname, 'section-header.css'), 'utf8')
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
    if (!match) throw new Error(`no rule «${selector}» in section-header.css`);
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

  /** Every rule of the sheet headings, as «selector { declarations }». */
  const sheetRules = (): readonly string[] =>
    css.match(/[^{};]*\[data-header-prominence[^{]*\{[^}]*\}/g) ?? [];

  const tokens = readFileSync(
    resolve(__dirname, '../../../../tokens/tokens.css'),
    'utf8',
  );
  /** A control rung in points: the multiple of the 4 pt unit the token holds. */
  const rungOf = (size: string): number =>
    4 *
    Number(
      // eslint-disable-next-line security/detect-non-literal-regexp -- a size name from this spec, over the DS's own tokens.
      new RegExp(
        `--control-size-${size}: calc\\(var\\(--sys-space-unit\\) \\* (\\d+)\\);`,
      ).exec(tokens)?.[1],
    );

  const ACTION =
    '.ui-section-header[data-header-prominence] > [uisectionaction]';

  it('sets an increased title in the title3 role, untracked, with a secondary glyph', () => {
    const title = rule(
      ".ui-section-header[data-header-prominence='increased'] > [uititle]",
    );
    // One rung over the 18/600 headline of the card under it (§2.0): a
    // heading outranks what it heads.
    expect(title.get('font')).toBe('var(--sys-font-title3)');
    expect(tokens).toMatch(/--sys-font-title3: 600 1\.25rem\/1\.2 /);
    expect(tokens).toMatch(/--sys-font-headline: 600 1\.125rem\/1\.3 /);
    expect(title.get('color')).toBe('var(--sys-color-foreground)');
    expect(title.get('font-variant-numeric')).toBe('tabular-nums');
    expect(
      rule('.ui-section-header[data-header-prominence] > [uititle]').get(
        'letter-spacing',
      ),
    ).toBe('normal');
    expect(
      rule(
        ".ui-section-header[data-header-prominence='increased'] > .ui-section-header__glyph",
      ).get('color'),
    ).toBe('var(--sys-color-secondary-label)');
  });

  it('stands every increased heading on the small rung, with an action or without', () => {
    // Revision 3, §3.2: one rhythm, and nothing has to overhang to keep it.
    // The row is 36 whether it holds «24 ›» or a title alone…
    expect(
      rule(".ui-section-header[data-header-prominence='increased']").get(
        'min-block-size',
      ),
    ).toBe('var(--control-size-small)');
    expect(rungOf('small')).toBe(36);
    // …which is the small button's own height, so the action IS the row…
    const button = readFileSync(
      resolve(__dirname, '../../../../controls/src/lib/button/button.css'),
      'utf8',
    ).replace(/\s+/g, ' ');
    expect(button).toMatch(
      /\.ui-button\[data-control-size='small'\] \{[^}]*min-block-size: var\(--control-size-small\);/,
    );
    // …and the title's line (20 × 1.2 = 24) stands centred inside it.
    expect(
      rule('.ui-section-header[data-header-prominence]').get('align-items'),
    ).toBe('center');
    // Nothing else sizes a sheet heading's row, and no rule takes a taller
    // rung only when an action is there (the two rhythms of wave D).
    const sized = sheetRules().filter((sheetRule) =>
      /[{;]\s*(?:min-block-size|block-size|height|min-height)\s*:/.test(
        sheetRule,
      ),
    );
    expect(sized).toHaveLength(1);
    expect(sized[0]).toContain(
      ".ui-section-header[data-header-prominence='increased'] {",
    );
    expect(css).not.toContain(
      ".ui-section-header[data-header-prominence='increased']:has(",
    );
  });

  it('keeps the action inside the column: no margin of a sheet heading is negative, on either axis', () => {
    // F4 (owner): «Всички ›» hung 16 past the column and folded its 44 box
    // out of the row by −52, so hover, press and the ring overhung with it.
    const margins = sheetRules().flatMap((sheetRule) =>
      [...sheetRule.matchAll(/[{;]\s*(margin[a-z-]*)\s*:\s*([^;}]*)/g)].map(
        ([, property, value]) => `${property}: ${(value as string).trim()}`,
      ),
    );
    expect(margins.length).toBeGreaterThan(0);
    for (const margin of margins) {
      expect(margin).toMatch(/^margin[a-z-]*: 0$/);
    }
    expect(
      rule(`${ACTION}.ui-button[data-button-style='plain']`).get('margin'),
    ).toBe('0');
    // The rules of the overhang are gone, every rung of them.
    for (const retired of [
      `${ACTION}.ui-button[data-button-style='plain'][data-control-size='small']`,
      `${ACTION}.ui-button[data-button-style='plain'][data-control-size='large']`,
      `${ACTION}.ui-button[data-button-style='plain'][data-icon-only]`,
      ".ui-section-header[data-header-prominence='increased'] > [uisectionaction]",
    ]) {
      expect(() => rule(retired)).toThrow(/no rule/);
    }
    expect(css).not.toContain('calc(-1 * var(--control-size');
    expect(css).not.toContain('calc(-1 * var(--sys-space-regular)');
  });

  it('lets the trailing glyph’s side bearing be a plain action’s trailing padding', () => {
    // The capsule ends on the edge the cards end on, and the words and the
    // chevron stand where they stood: the glyph's box was on that edge
    // already. The leading padding stays the small button's own (compact).
    const hugged = rule(
      `${ACTION}.ui-button[data-button-style='plain']:has(> .ui-icon:last-child)`,
    );
    expect([...hugged.entries()]).toEqual([['padding-inline-end', '0']]);
    // A label without a glyph keeps both paddings: nothing else is zeroed.
    expect(css.match(/padding-inline[a-z-]*\s*:\s*0\b/g)).toHaveLength(1);
    const button = readFileSync(
      resolve(__dirname, '../../../../controls/src/lib/button/button.css'),
      'utf8',
    ).replace(/\s+/g, ' ');
    expect(button).toMatch(
      /\.ui-button\[data-control-size='small'\] \{[^}]*padding-inline: var\(--sys-space-compact\);/,
    );
  });

  it('makes the 44 floor a target that paints nothing, anchored on the action itself', () => {
    const slop = rule(`${ACTION}.ui-button::before`);
    expect(slop.get('content')).toBe("''");
    expect(slop.get('position')).toBe('absolute');
    // (36 − 44) / 2 = −4 either side on the block axis; the column's edge
    // on the inline one.
    expect(slop.get('inset')).toBe(
      'calc((var(--control-size-small) - var(--control-size-regular)) / 2) 0',
    );
    expect((rungOf('small') - rungOf('regular')) / 2).toBe(-4);
    expect(
      rungOf('small') - 2 * ((rungOf('small') - rungOf('regular')) / 2),
    ).toBe(44);
    // A target, never paint.
    expect([...slop.keys()].sort()).toEqual(['content', 'inset', 'position']);

    // EVERY button in the slot anchors its own slop — a bordered action's
    // would otherwise hang from whatever positioned box is up the tree —
    // and paints above the card that follows, so its focus ring (2 + 2
    // round the box, into the compact rung under the row) is never cut.
    const anchor = rule(`${ACTION}.ui-button`);
    expect(anchor.get('position')).toBe('relative');
    expect(anchor.get('z-index')).toBe('1');
    expect(tokens).toMatch(/--sys-focus-ring-width: 2px;/);
    expect(tokens).toMatch(/--sys-focus-ring-offset: 2px;/);
    // The button draws no `::before` of its own for the slop to fight.
    const button = readFileSync(
      resolve(__dirname, '../../../../controls/src/lib/button/button.css'),
      'utf8',
    ).replace(/\/\*[\s\S]*?\*\//g, '');
    expect(button).not.toContain('::before');
  });

  it('sets standard in the footnote role on the group edge, and pins it under the chrome', () => {
    const line = rule(
      ".ui-section-header[data-header-prominence='standard'] > [uititle], .ui-section-header[data-header-prominence='standard'] > [uisectiondetail]",
    );
    expect(line.get('font')).toBe('var(--sys-font-footnote)');
    expect(line.get('color')).toBe('var(--sys-color-secondary-label)');
    expect(
      rule(".ui-section-header[data-header-prominence='standard']").get(
        'padding-inline',
      ),
    ).toBe('var(--ui-section-header-inset, 0)');
    const pinned = rule(
      ".ui-section-header[data-header-prominence='standard'][data-pinned]",
    );
    expect(pinned.get('position')).toBe('sticky');
    expect(pinned.get('inset-block-start')).toBe(
      'var(--modal-sheet-chrome-height, 0)',
    );
    expect(pinned.get('z-index')).toBe('1');
    // A real band: the compact rung either side of the footnote line
    // (16.2 + 2 × 8 ≥ 28), never the tight one that cut the rows 4 pt
    // under the label — and one more compact rung under it for the ramp.
    // The cover paints both, so the head has no fill of its own to hide
    // the ramp.
    expect(pinned.get('padding-block')).toBe(
      'var(--sys-space-compact) calc(var(--sys-space-compact) * 2)',
    );
    expect(pinned.has('background')).toBe(false);
  });

  it('paints the surface from a pinned head up to the scroller, over its own section only', () => {
    const cover = rule(
      ".ui-section-header[data-header-prominence='standard'][data-pinned]::before",
    );
    expect(cover.get('content')).toBe("''");
    expect(cover.get('position')).toBe('absolute');
    // Under the head's own words, inside its layer: the chrome stays above.
    expect(cover.get('z-index')).toBe('-1');
    expect(cover.get('inset-block')).toBe(
      'calc(-1 * var(--modal-sheet-chrome-height, 0px)) 0',
    );
    expect(cover.get('inset-inline')).toBe(
      'calc(-1 * var(--ui-sheet-inset, 0px))',
    );
    // Solid to the band's bottom rung, then the chrome's smootherstep over
    // that rung: the rows fade in under the label, never a raw cut.
    const ramp = cover.get('background') ?? '';
    expect(ramp.startsWith('linear-gradient(to bottom, ')).toBe(true);
    expect(ramp).toContain(
      'var(--sys-color-surface) calc(100% - var(--sys-space-compact)),',
    );
    const alphas = [
      ...ramp.matchAll(
        /color-mix\(in srgb, var\(--sys-color-surface\) (\d+)%, transparent\)/g,
      ),
    ].map(([, alpha]) => Number(alpha));
    expect(alphas).toEqual([98, 90, 73, 50, 27, 10, 2]);
    expect(ramp.endsWith('transparent 100%)')).toBe(true);
    // …the same stops the sheet's own chrome fade ramps through.
    const chrome = readFileSync(
      resolve(
        __dirname,
        '../../../../controls/src/lib/modal-sheet/modal-sheet.css',
      ),
      'utf8',
    );
    const chromeAlphas = [
      ...chrome.matchAll(
        /color-mix\(in srgb, var\(--sys-color-surface\) (\d+)%, transparent\)/g,
      ),
    ].map(([, alpha]) => Number(alpha));
    expect(chromeAlphas.slice(0, 7)).toEqual(alphas);
    // The section clips its top edge alone: an in-flow head hides nothing.
    expect(
      rule(
        ":where(:has(> .ui-section-header[data-header-prominence='standard'][data-pinned]))",
      ).get('clip-path'),
    ).toBe('inset(0 -100vmax -100vmax)');
  });

  it('never uppercases a sheet heading', () => {
    expect(sheetRules().length).toBeGreaterThan(0);
    for (const sheetRule of sheetRules()) {
      expect(sheetRule).not.toContain('text-transform');
    }
  });
});

/*
 * THE ACCENT LAW ON THE EYEBROW (revision 3, §1.3): words are ink, the
 * orange is a thing in front of them.
 */
describe('section-header.css · the eyebrow', () => {
  const css = readFileSync(resolve(__dirname, 'section-header.css'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\s+/g, ' ');

  /** One rule's declarations, in order, duplicates kept. */
  function declarations(
    selector: string,
  ): readonly (readonly [string, string])[] {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // eslint-disable-next-line security/detect-non-literal-regexp -- an escaped selector from this spec, over the DS's own stylesheet.
    const match = new RegExp(
      `(?:^|[{};])\\s*${escaped}\\s*\\{([^{}]*)\\}`,
    ).exec(css);
    if (!match) throw new Error(`no rule «${selector}» in section-header.css`);
    return (match[1] as string)
      .split(';')
      .map((declaration) => declaration.trim())
      .filter(Boolean)
      .map((declaration) => {
        const colon = declaration.indexOf(':');
        return [
          declaration.slice(0, colon).trim(),
          declaration.slice(colon + 1).trim(),
        ] as const;
      });
  }
  /**
   * The LAST declaration of `property` in the rule — the one the cascade
   * keeps. A reverse scan, not `Array.prototype.findLast`: that is ES2023
   * and the workspace lib is `es2022` (`tsconfig.base.json`).
   */
  function valueOf(selector: string, property: string): string | undefined {
    const found = declarations(selector);
    for (let index = found.length - 1; index >= 0; index -= 1) {
      const declaration = found.at(index);
      if (declaration?.[0] === property) return declaration[1];
    }
    return undefined;
  }

  it('sets the eyebrow’s words in primary ink, uppercase and tracked', () => {
    const eyebrow = '.ui-section-header > [uieyebrow]';
    expect(valueOf(eyebrow, 'color')).toBe('var(--sys-color-foreground)');
    expect(valueOf(eyebrow, 'font')).toBe('var(--sys-font-eyebrow)');
    expect(valueOf(eyebrow, 'letter-spacing')).toBe(
      'var(--sys-tracking-eyebrow)',
    );
    expect(valueOf(eyebrow, 'text-transform')).toBe('uppercase');
  });

  it('leads the accent eyebrow with the status dot in the one accent', () => {
    const dot =
      ".ui-section-header[data-eyebrow-tone='accent'] > [uieyebrow]::before";
    expect(valueOf(dot, 'content')).toBe("''");
    expect(valueOf(dot, 'display')).toBe('inline-block');
    expect(valueOf(dot, 'inline-size')).toBe('var(--sys-size-dot)');
    expect(valueOf(dot, 'block-size')).toBe('var(--sys-size-dot)');
    expect(valueOf(dot, 'border-radius')).toBe('var(--control-radius-capsule)');
    // A shape takes the accent as its fill; nothing here takes it as ink.
    expect(valueOf(dot, 'background')).toBe('var(--sys-color-accent)');
    expect(declarations(dot).some(([name]) => name === 'color')).toBe(false);
    expect(valueOf(dot, 'margin-inline-end')).toBe('var(--sys-space-compact)');
    // On the capitals' middle, with the baseline as the fallback of a
    // browser that has no `cap` unit: the fallback is declared FIRST.
    expect(
      declarations(dot)
        .filter(([name]) => name === 'vertical-align')
        .map(([, value]) => value),
    ).toEqual(['baseline', 'calc((1cap - var(--sys-size-dot)) / 2)']);
  });

  it('keeps a status qualifier quiet: secondary ink and no dot', () => {
    expect(
      valueOf(
        ".ui-section-header[data-eyebrow-tone='secondary'] > [uieyebrow]",
        'color',
      ),
    ).toBe('var(--sys-color-secondary-label)');
    // The dot is the accent tone's alone: one `::before` on the eyebrow.
    expect(css.match(/\[uieyebrow\]::before/g)).toHaveLength(1);
    expect(css).not.toContain('[uieyebrow]::after');
  });

  it('keeps the media ramp over footage, where the theme’s ink would sink', () => {
    expect(
      valueOf('.ui-section-header[data-on-media] > [uieyebrow]', 'color'),
    ).toBe('var(--sys-color-on-media-subtle)');
    // …declared after the two tones, at their specificity, so it wins.
    expect(
      css.indexOf('.ui-section-header[data-on-media] > [uieyebrow] {'),
    ).toBeGreaterThan(
      css.indexOf(
        ".ui-section-header[data-eyebrow-tone='secondary'] > [uieyebrow] {",
      ),
    );
  });

  it('reads neither label cut of the accent, and sets the accent as no word’s colour', () => {
    expect(css).not.toContain('--sys-color-accent-label');
    expect(css).not.toContain('--sys-color-promo-label');
    expect(css).not.toMatch(
      /[{;]\s*color\s*:\s*var\(--sys-color-(?:accent|promo)\)/,
    );
  });
});
