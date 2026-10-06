import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { UiPassCard } from './pass-card';

const NAME =
  'Карта за лоялност: Георги Петров, Злато, 371 точки за размяна, клиент от март 2025 г.';

@Component({
  imports: [UiPassCard],
  template: `
    <ui-pass-card
      [uiFigure]="figure()"
      [uiUnit]="unit()"
      [uiHolder]="holder()"
      [uiDetail]="detail()"
      [uiState]="state()"
      [uiFrozen]="frozen()"
      [uiLabel]="label()"
      [uiTestId]="testId()"
      data-testid="pass"
    >
      @if (marked()) {
        <span uiPassMark data-testid="mark">creativo</span>
      }
      @if (tier(); as tier) {
        <span uiPassBadge data-testid="plate">{{ tier }}</span>
      }
    </ui-pass-card>
  `,
})
class Host {
  readonly figure = signal('371');
  readonly unit = signal<string | null>('точки');
  readonly holder = signal<string | null>('Георги Петров');
  readonly detail = signal<string | null>('Клиент от март 2025 г.');
  readonly state = signal<string | null>(null);
  readonly frozen = signal(false);
  readonly label = signal(NAME);
  readonly testId = signal<string | null>('pass');
  readonly marked = signal(true);
  readonly tier = signal<string | null>('Злато');
}

/** The attribute form: a bare `uiFrozen`, and nothing but the two required inputs. */
@Component({
  imports: [UiPassCard],
  template: `
    <ui-pass-card uiFigure="0" uiLabel="Карта за лоялност" uiFrozen />
  `,
})
class BareHost {}

async function render() {
  await TestBed.configureTestingModule({ imports: [Host] }).compileComponents();
  const fixture = TestBed.createComponent(Host);
  fixture.detectChanges();
  const root = fixture.nativeElement as HTMLElement;
  const card = root.querySelector<HTMLElement>('[data-testid="pass"]');
  if (!card) throw new Error('no pass');
  const part = (selector: string) => card.querySelector<HTMLElement>(selector);
  const text = (selector: string) => part(selector)?.textContent?.trim();
  return { fixture, host: fixture.componentInstance, card, part, text };
}

describe('UiPassCard', () => {
  it('is one group with one name, the consumer’s sentence', async () => {
    const { fixture, host, card } = await render();
    expect(card.tagName).toBe('UI-PASS-CARD');
    expect(card.classList.contains('ui-pass-card')).toBe(true);
    expect(card.getAttribute('role')).toBe('group');
    expect(card.getAttribute('aria-label')).toBe(NAME);
    // Static: nothing to press, nothing to focus.
    expect(card.hasAttribute('tabindex')).toBe(false);
    expect(card.querySelector('button, a, [tabindex]')).toBeNull();
    host.label.set('Карта за лоялност: Георги Петров, дължи 40 точки');
    fixture.detectChanges();
    expect(card.getAttribute('aria-label')).toBe(
      'Карта за лоялност: Георги Петров, дължи 40 точки',
    );
  });

  it('draws two parts, the field over the foot, and nothing beside them', async () => {
    const { card } = await render();
    expect([...card.children].map((child) => child.className)).toEqual([
      'ui-pass-card__field',
      'ui-pass-card__foot',
    ]);
  });

  it('prints the figure and its unit on the field, as given: the DS formats no number', async () => {
    const { fixture, host, part, text } = await render();
    const balance = part('.ui-pass-card__field > .ui-pass-card__balance');
    expect(balance).not.toBeNull();
    expect(
      [...(balance?.children ?? [])].map((child) => child.className),
    ).toEqual(['ui-pass-card__figure', 'ui-pass-card__unit']);
    expect(text('.ui-pass-card__figure')).toBe('371');
    expect(text('.ui-pass-card__unit')).toBe('точки');
    // Owing points: the sign is the consumer's, a typographic minus.
    host.figure.set('−40');
    fixture.detectChanges();
    expect(text('.ui-pass-card__figure')).toBe('−40');
    // A figure that is its own sentence carries no unit.
    host.unit.set(null);
    fixture.detectChanges();
    expect(part('.ui-pass-card__unit')).toBeNull();
    expect(text('.ui-pass-card__balance')).toBe('−40');
  });

  it('seats the mark at the top leading and ONE plate at the top trailing, both projected', async () => {
    const { part } = await render();
    const top = part('.ui-pass-card__field > .ui-pass-card__top');
    expect([...(top?.children ?? [])].map((child) => child.className)).toEqual([
      'ui-pass-card__mark',
      'ui-pass-card__badge',
    ]);
    expect(
      part('.ui-pass-card__mark > [data-testid="mark"]')?.textContent,
    ).toBe('creativo');
    expect(
      part('.ui-pass-card__badge > [data-testid="plate"]')?.textContent,
    ).toBe('Злато');
  });

  it('leaves a slot EMPTY when nothing is projected, so the stylesheet can drop it', async () => {
    const { fixture, host, part } = await render();
    host.tier.set(null);
    host.marked.set(false);
    fixture.detectChanges();
    // `:empty` allows a comment (the consumer's `@if` leaves its anchor)
    // and nothing else: no element, no text, not even whitespace.
    for (const slot of ['.ui-pass-card__badge', '.ui-pass-card__mark']) {
      const nodes = [...(part(slot)?.childNodes ?? [])];
      expect(part(slot)).not.toBeNull();
      expect(nodes.every((node) => node.nodeType === Node.COMMENT_NODE)).toBe(
        true,
      );
    }
    // The row stays: the figure keeps its place on a card without a plate.
    expect(part('.ui-pass-card__top')).not.toBeNull();
  });

  it('draws the motif as two discs, the first things in the field, under everything it prints', async () => {
    const { card, part } = await render();
    const discs = [...card.querySelectorAll('.ui-pass-card__motif')];
    expect(discs.map((disc) => disc.getAttribute('data-disc'))).toEqual([
      'major',
      'minor',
    ]);
    const field = part('.ui-pass-card__field');
    expect([...(field?.children ?? [])].slice(0, 2)).toEqual(discs);
    for (const disc of discs) {
      expect(disc.textContent).toBe('');
      expect(disc.parentElement).toBe(field);
    }
  });

  it('prints the holder over the quiet line on the foot, and the state after them', async () => {
    const { fixture, host, part, text } = await render();
    const foot = part('.ui-pass-card__foot');
    expect([...(foot?.children ?? [])].map((child) => child.className)).toEqual(
      ['ui-pass-card__lines'],
    );
    expect(
      [...(part('.ui-pass-card__lines')?.children ?? [])].map(
        (child) => child.className,
      ),
    ).toEqual(['ui-pass-card__holder', 'ui-pass-card__detail']);
    expect(text('.ui-pass-card__holder')).toBe('Георги Петров');
    expect(text('.ui-pass-card__detail')).toBe('Клиент от март 2025 г.');
    // The quiet line's words stand in a line of their own, and alone.
    expect(
      [...(part('.ui-pass-card__detail')?.childNodes ?? [])].map((node) =>
        node instanceof HTMLElement ? node.className : node.nodeType,
      ),
    ).toEqual(['ui-pass-card__detail-line']);
    // The state is there only when it says something…
    expect(part('.ui-pass-card__state')).toBeNull();
    host.state.set('40 т. изтичат на 31.12');
    fixture.detectChanges();
    // …and it follows the lines in the document, so when it wraps it lands
    // under the quiet line.
    expect([...(foot?.children ?? [])].map((child) => child.className)).toEqual(
      ['ui-pass-card__lines', 'ui-pass-card__state'],
    );
    expect(text('.ui-pass-card__state')).toBe('40 т. изтичат на 31.12');
  });

  it('keeps the foot when it has nothing to print: the card keeps its form', async () => {
    const { fixture, host, part } = await render();
    host.holder.set(null);
    fixture.detectChanges();
    expect(part('.ui-pass-card__holder')).toBeNull();
    expect(part('.ui-pass-card__detail')).not.toBeNull();
    host.detail.set(null);
    fixture.detectChanges();
    expect(part('.ui-pass-card__lines')).toBeNull();
    expect(part('.ui-pass-card__foot')).not.toBeNull();
    expect(part('.ui-pass-card__foot')?.children.length).toBe(0);
    // A state alone still stands on the foot.
    host.state.set('Замразено');
    fixture.detectChanges();
    expect(
      [...(part('.ui-pass-card__foot')?.children ?? [])].map(
        (child) => child.className,
      ),
    ).toEqual(['ui-pass-card__state']);
  });

  it('hides what the name already says from a reader, and leaves the state to be read', async () => {
    const { fixture, host, part } = await render();
    host.state.set('40 т. изтичат на 31.12');
    fixture.detectChanges();
    // The field whole: the mark, the plate, the figure, the discs.
    expect(part('.ui-pass-card__field')?.getAttribute('aria-hidden')).toBe(
      'true',
    );
    // The holder and the quiet line.
    expect(part('.ui-pass-card__lines')?.getAttribute('aria-hidden')).toBe(
      'true',
    );
    // The name does not carry the state, so nothing above it hides it.
    expect(part('.ui-pass-card__state')?.closest('[aria-hidden]')).toBeNull();
  });

  it('marks a frozen card on the host and changes nothing it prints', async () => {
    const { fixture, host, card, text } = await render();
    expect(card.hasAttribute('data-frozen')).toBe(false);
    const before = card.innerHTML;
    host.frozen.set(true);
    fixture.detectChanges();
    expect(card.getAttribute('data-frozen')).toBe('');
    // Values are never zeroed; the consumer's state line says «Замразено».
    expect(card.innerHTML).toBe(before);
    expect(text('.ui-pass-card__figure')).toBe('371');
    host.frozen.set(false);
    fixture.detectChanges();
    expect(card.hasAttribute('data-frozen')).toBe(false);
  });

  it('stamps the four parts for a test, and none without an id', async () => {
    const { fixture, host, card, part } = await render();
    host.state.set('дължи 40 точки');
    fixture.detectChanges();
    const stamped = (id: string) =>
      card.querySelector(`[data-testid="${id}"]`)?.className;
    expect(stamped('pass-figure')).toBe('ui-pass-card__figure');
    expect(stamped('pass-holder')).toBe('ui-pass-card__holder');
    expect(stamped('pass-detail')).toBe('ui-pass-card__detail');
    expect(stamped('pass-state')).toBe('ui-pass-card__state');
    host.testId.set('rewards-pass');
    fixture.detectChanges();
    expect(stamped('rewards-pass-figure')).toBe('ui-pass-card__figure');
    expect(stamped('pass-figure')).toBeUndefined();
    host.testId.set(null);
    fixture.detectChanges();
    for (const name of ['figure', 'holder', 'detail', 'state']) {
      expect(part(`.ui-pass-card__${name}`)?.hasAttribute('data-testid')).toBe(
        false,
      );
    }
  });

  it('takes `uiFrozen` as a bare attribute, and needs nothing but a figure and a name', async () => {
    await TestBed.configureTestingModule({
      imports: [BareHost],
    }).compileComponents();
    const fixture = TestBed.createComponent(BareHost);
    fixture.detectChanges();
    const card = (fixture.nativeElement as HTMLElement).querySelector(
      'ui-pass-card',
    );
    expect(card?.getAttribute('data-frozen')).toBe('');
    expect(card?.getAttribute('aria-label')).toBe('Карта за лоялност');
    expect(card?.querySelector('.ui-pass-card__figure')?.textContent).toBe('0');
    expect(card?.querySelector('.ui-pass-card__unit')).toBeNull();
    expect(card?.querySelector('.ui-pass-card__foot')?.children.length).toBe(0);
  });
});

/*
 * THE DRAWING, READ FROM THE STYLESHEET. jsdom lays nothing out, so the
 * surfaces, the type roles, the ratio and the accent law are held where
 * they are written.
 */
describe('pass-card.css', () => {
  const css = readFileSync(resolve(__dirname, 'pass-card.css'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\s+/g, ' ')
    .replace(/\(\s/g, '(')
    .replace(/\s\)/g, ')');

  const tokens = readFileSync(
    resolve(__dirname, '../../../../tokens/tokens.css'),
    'utf8',
  );

  /** What an at-rule holds, by its prelude: `@container (inline-size < 20rem)`. */
  function block(prelude: string): string {
    const start = css.indexOf(`${prelude} {`);
    if (start < 0) throw new Error(`no block for «${prelude}»`);
    const open = start + prelude.length + 1;
    let depth = 0;
    for (let at = open; at < css.length; at += 1) {
      const char = css.charAt(at);
      if (char === '{') depth += 1;
      if (char === '}') {
        depth -= 1;
        if (depth === 0) return css.slice(open + 1, at);
      }
    }
    throw new Error(`«${prelude}» never closes`);
  }

  const NARROW = '@container (inline-size < 20rem)';
  /** What the narrow card changes: the one `@container` block, whole. */
  const narrow = block(NARROW);
  /** The sheet less that block: the rules that always hold. */
  const unconditional = css.replace(`${NARROW} {${narrow}}`, '');

  /** Every rule that always holds: «selector» → its declarations. */
  const rules = new Map<string, Map<string, string>>();
  for (const [, selector = '', body = ''] of unconditional.matchAll(
    /([^{}]+)\{([^{}]*)\}/g,
  )) {
    const found = new Map<string, string>();
    for (const declaration of body.split(';')) {
      const colon = declaration.indexOf(':');
      if (colon < 0) continue;
      found.set(
        declaration.slice(0, colon).trim(),
        declaration.slice(colon + 1).trim(),
      );
    }
    const name = selector.trim();
    if (rules.has(name)) throw new Error(`«${name}» is declared twice`);
    rules.set(name, found);
  }

  function rule(selector: string): Map<string, string> {
    const found = rules.get(selector);
    if (!found) throw new Error(`no rule «${selector}» in pass-card.css`);
    return found;
  }

  const INK = 'var(--ui-pass-card-ink, var(--sys-color-on-accent))';

  it('lives in the components layer', () => {
    expect(css.startsWith('@layer sys-components {')).toBe(true);
  });

  it('is one radius over both parts, lifted, and measures itself', () => {
    const host = rule('.ui-pass-card');
    expect(host.get('border-radius')).toBe('var(--control-radius-prominent)');
    expect(host.get('overflow')).toBe('clip');
    expect(host.get('box-shadow')).toBe('var(--sys-elevation-raised)');
    expect(host.get('container-type')).toBe('inline-size');
    expect(host.get('inline-size')).toBe('100%');
  });

  it('paints NOTHING on the host: the field is the page’s one slab', () => {
    const host = rule('.ui-pass-card');
    expect(host.has('background')).toBe(false);
    expect(host.has('background-color')).toBe(false);
    // The accent is a background exactly once in the sheet, the field's.
    const painted = [...rules].filter(([, declarations]) =>
      (declarations.get('background') ?? '').includes('--sys-color-accent'),
    );
    expect(painted.map(([selector]) => selector)).toEqual([
      '.ui-pass-card__field',
    ]);
  });

  it('splits an ISO card 62 / 38, each part a FLOOR', () => {
    const field = rule('.ui-pass-card__field');
    const foot = rule('.ui-pass-card__foot');
    expect(field.get('min-block-size')).toBe('calc(100cqi / 1.586 * 0.62)');
    expect(foot.get('min-block-size')).toBe('calc(100cqi / 1.586 * 0.38)');
    // A floor, never a height: a second line grows the part it is in.
    expect(field.has('block-size')).toBe(false);
    expect(foot.has('block-size')).toBe(false);
    expect(css).not.toContain('aspect-ratio');
    // 355 wide: 224 tall, 139 over 85.
    const height = 355 / 1.586;
    expect(Math.round(height)).toBe(224);
    expect(Math.round(height * 0.62)).toBe(139);
    expect(Math.round(height * 0.38)).toBe(85);
    // 295 wide (the 330 pt sheet): 186 tall, 115 over 71.
    expect(Math.round((295 / 1.586) * 0.62)).toBe(115);
    expect(Math.round((295 / 1.586) * 0.38)).toBe(71);
  });

  it('pads the field `comfortable` and the foot `regular` by `comfortable`', () => {
    expect(rule('.ui-pass-card__field').get('padding')).toBe(
      'var(--sys-space-comfortable)',
    );
    expect(rule('.ui-pass-card__foot').get('padding')).toBe(
      'var(--sys-space-regular) var(--sys-space-comfortable)',
    );
  });

  it('reads every hook with its default at the use site, and declares none', () => {
    expect(rule('.ui-pass-card__field').get('background')).toBe(
      'var(--ui-pass-card-surface, var(--sys-color-accent))',
    );
    expect(rule('.ui-pass-card__foot').get('background')).toBe(
      'var(--ui-pass-card-foot, var(--sys-color-surface-elevated))',
    );
    expect(rule('.ui-pass-card__motif').get('background')).toBe(
      `var(--ui-pass-card-motif, color-mix(in srgb, ${INK} 10%, transparent))`,
    );
    // Set on the card or on anything above it: never declared here.
    expect(css).not.toMatch(/--ui-pass-card-[a-z]+\s*:/);
    // Exactly the four the spec publishes.
    expect([...new Set(css.match(/--ui-pass-card-[a-z]+/g))].sort()).toEqual([
      '--ui-pass-card-foot',
      '--ui-pass-card-ink',
      '--ui-pass-card-motif',
      '--ui-pass-card-surface',
    ]);
  });

  it('sets the figure in the largeTitle role and the unit in title3 at 700: display sizes, white', () => {
    const figure = rule('.ui-pass-card__figure');
    expect(figure.get('font')).toBe('var(--sys-font-largeTitle)');
    expect(figure.get('letter-spacing')).toBe('var(--sys-tracking-largeTitle)');
    expect(figure.get('color')).toBe(INK);
    expect(figure.get('font-variant-numeric')).toBe('tabular-nums');
    expect(figure.get('white-space')).toBe('nowrap');
    const unit = rule('.ui-pass-card__unit');
    expect(unit.get('font')).toBe('var(--sys-font-title3)');
    expect(unit.get('font-weight')).toBe('700');
    expect(unit.get('color')).toBe(INK);
    // The roles are what the law calls large text: 36/800, and 20 px bold.
    expect(tokens).toMatch(/--sys-font-largeTitle: 800 2\.25rem\/0\.96 /);
    expect(tokens).toMatch(/--sys-font-title3: 600 1\.25rem\/1\.2 /);
    // One baseline.
    expect(rule('.ui-pass-card__balance').get('align-items')).toBe('baseline');
  });

  it('puts white on the orange in three rules only: the figure, the unit, the mark', () => {
    // The accent law, rule 4, and its guard's recorded table (§1.5, 7).
    const white = [...rules]
      .filter(([, declarations]) =>
        (declarations.get('color') ?? '').includes('--sys-color-on-accent'),
      )
      .map(([selector]) => selector);
    expect(white).toEqual([
      '.ui-pass-card__mark',
      '.ui-pass-card__figure',
      '.ui-pass-card__unit',
    ]);
    // …and the field itself sets no ink a small word could inherit.
    expect(rule('.ui-pass-card__field').has('color')).toBe(false);
    expect(rule('.ui-pass-card__field').has('font')).toBe(false);
  });

  it('sets no font on the field but the two display roles', () => {
    const fonts = [...rules]
      .filter(([, declarations]) => declarations.has('font'))
      .map(([selector, declarations]) => [selector, declarations.get('font')]);
    expect(fonts).toEqual([
      ['.ui-pass-card__figure', 'var(--sys-font-largeTitle)'],
      ['.ui-pass-card__unit', 'var(--sys-font-title3)'],
      ['.ui-pass-card__holder', 'var(--sys-font-callout)'],
      ['.ui-pass-card__detail', 'var(--sys-font-footnote)'],
      ['.ui-pass-card__state', 'var(--sys-font-footnote)'],
    ]);
  });

  it('keeps the balance in the leading 60 % and the discs in the trailing 40 %', () => {
    expect(rule('.ui-pass-card__balance').get('max-inline-size')).toBe(
      'calc(60cqi - var(--sys-space-comfortable))',
    );
    // A balance too long for it wraps its unit; nothing is cut.
    expect(rule('.ui-pass-card__balance').get('flex-wrap')).toBe('wrap');
    const major = rule(".ui-pass-card__motif[data-disc='major']");
    const minor = rule(".ui-pass-card__motif[data-disc='minor']");
    for (const disc of [major, minor]) {
      const start = /^(\d+)cqi$/.exec(disc.get('inset-inline-start') ?? '');
      expect(start).not.toBeNull();
      expect(Number(start?.[1])).toBeGreaterThanOrEqual(60);
    }
    // 220 and 140 on the 355 card, in the card's own width: the radii.
    expect(major.get('clip-path')).toBe(
      'circle(calc(100cqi * 110 / 355) at calc(100cqi * 110 / 355) calc(100cqi * 110 / 355 - 30cqi))',
    );
    expect(minor.get('clip-path')).toBe(
      'circle(calc(100cqi * 70 / 355) at calc(100cqi * 70 / 355) calc(100cqi * 70 / 355))',
    );
    // No gradient anywhere.
    expect(css).not.toContain('gradient');
  });

  it('draws each disc as a box INSIDE the field: nothing of it lies over the foot or over what is above the card', () => {
    const motif = rule('.ui-pass-card__motif');
    expect(motif.get('position')).toBe('absolute');
    expect(motif.get('inset-inline-end')).toBe('0');
    expect(motif.get('pointer-events')).toBe('none');
    // A round element hung half outside has a box where it is clipped
    // away; a box with the circle cut into it has not.
    expect(motif.has('border-radius')).toBe(false);
    const major = rule(".ui-pass-card__motif[data-disc='major']");
    expect(major.get('inset-block-start')).toBe('0');
    // It ends where the disc does: 220 less the 30 % that rise past the top.
    expect(major.get('block-size')).toBe('calc(100cqi * 220 / 355 - 30cqi)');
    // …which is inside the least field there is (62 % of an ISO card).
    expect((220 / 355) * 100 - 30).toBeLessThan((100 / 1.586) * 0.62);
    const minor = rule(".ui-pass-card__motif[data-disc='minor']");
    expect(minor.get('inset-block')).toBe('21cqi 0');
    expect(21).toBeLessThan((100 / 1.586) * 0.62);
    // No inset of a disc is negative, and none is given in a fixed length.
    for (const disc of [motif, major, minor]) {
      for (const [property, value] of disc) {
        if (!property.startsWith('inset')) continue;
        for (const length of value.split(' ')) {
          expect(length).toMatch(/^(0|\d+cqi)$/);
        }
      }
    }
    expect(rule('.ui-pass-card__field').get('position')).toBe('relative');
  });

  it('mirrors the discs in a right-to-left card', () => {
    // The boxes follow the logical insets; the circles are cut from the
    // box's left edge, so their centres are measured back from the far one.
    expect(
      rule(".ui-pass-card__motif[data-disc='major']:dir(rtl)").get('clip-path'),
    ).toBe(
      'circle(calc(100cqi * 110 / 355) at calc(38cqi - 100cqi * 110 / 355) calc(100cqi * 110 / 355 - 30cqi))',
    );
    expect(
      rule(".ui-pass-card__motif[data-disc='minor']:dir(rtl)").get('clip-path'),
    ).toBe(
      'circle(calc(100cqi * 70 / 355) at calc(30cqi - 100cqi * 70 / 355) calc(100cqi * 70 / 355))',
    );
    // 38 and 30: what is left of the card past each disc's leading edge.
    expect(100 - 62).toBe(38);
    expect(100 - 70).toBe(30);
  });

  it('draws the mark 20 tall in the field’s ink', () => {
    expect(rule('.ui-pass-card__mark > .ui-logo').get('--ui-logo-size')).toBe(
      'calc(var(--sys-space-unit) * 5)',
    );
    expect(rule('.ui-pass-card__mark').get('color')).toBe(INK);
  });

  it('sets the foot in ordinary card ink: the holder 14/600, the quiet line secondary, the state 12/500 primary', () => {
    const holder = rule('.ui-pass-card__holder');
    expect(holder.get('font')).toBe('var(--sys-font-callout)');
    expect(holder.get('font-weight')).toBe('600');
    expect(holder.get('color')).toBe('var(--sys-color-foreground)');
    const detail = rule('.ui-pass-card__detail');
    expect(detail.get('font')).toBe('var(--sys-font-footnote)');
    expect(detail.get('font-weight')).toBeUndefined();
    expect(detail.get('color')).toBe('var(--sys-color-secondary-label)');
    const state = rule('.ui-pass-card__state');
    expect(state.get('font')).toBe('var(--sys-font-footnote)');
    expect(state.get('font-weight')).toBe('500');
    // Ink, never a tone: a debt is not painted red.
    expect(state.get('color')).toBe('var(--sys-color-foreground)');
    expect(css).not.toContain('--sys-color-destructive');
    expect(css).not.toContain('--sys-color-warning');
    expect(css).not.toContain('--sys-color-accent-label');
    expect(css).not.toContain('--sys-color-promo');
  });

  it('cuts no word: the holder wraps, the state steps under the lines', () => {
    expect(css).not.toContain('text-overflow');
    expect(css).not.toContain('line-clamp');
    const foot = rule('.ui-pass-card__foot');
    expect(foot.get('flex-wrap')).toBe('wrap');
    expect(foot.get('align-items')).toBe('baseline');
    expect(foot.get('justify-content')).toBe('space-between');
    for (const part of ['holder', 'detail-line', 'state']) {
      expect(rule(`.ui-pass-card__${part}`).get('overflow-wrap')).toBe(
        'anywhere',
      );
    }
    // Only the figure and its unit hold their line, and the unit may wrap
    // under the figure.
    const held = [...rules]
      .filter(([, declarations]) => declarations.has('white-space'))
      .map(([selector]) => selector);
    expect(held).toEqual(['.ui-pass-card__figure', '.ui-pass-card__unit']);
  });

  it('lets the HOLDER alone decide whether the state shares its line', () => {
    // The quiet line adds nothing to the width of the lines…
    const detail = rule('.ui-pass-card__detail');
    expect(detail.get('display')).toBe('block');
    expect(detail.get('inline-size')).toBe('0');
    // …and its words wrap at the foot's column: the card less its gutters.
    const line = rule('.ui-pass-card__detail-line');
    expect(line.get('display')).toBe('block');
    expect(line.get('inline-size')).toBe(
      'calc(100cqi - 2 * var(--sys-space-comfortable))',
    );
    expect(rule('.ui-pass-card__foot').get('padding')).toContain(
      ' var(--sys-space-comfortable)',
    );
  });

  it('stacks the foot in one column on a narrow card', () => {
    // One block, and the foot is all it holds.
    expect(css.split('@container')).toHaveLength(2);
    expect(narrow.trim().startsWith('.ui-pass-card__foot {')).toBe(true);
    expect(narrow.split('{')).toHaveLength(2);
    expect(narrow).toContain('flex-direction: column');
    expect(narrow).toContain('align-items: flex-start');
    // 295 (the 330 pt sheet's card) is under the line; 355 is over it.
    expect(295 / 16).toBeLessThan(20);
    expect(355 / 16).toBeGreaterThan(20);
  });

  it('desaturates the FIELD of a frozen card, and nothing else', () => {
    expect(
      rule('.ui-pass-card[data-frozen] .ui-pass-card__field').get('filter'),
    ).toBe('saturate(0.35)');
    expect(css.split('[data-frozen]')).toHaveLength(2);
    expect(css.split('filter:')).toHaveLength(2);
    expect(css).not.toContain('opacity');
  });

  it('does not move: no transition, no animation', () => {
    expect(css).not.toContain('transition');
    expect(css).not.toContain('animation');
    expect(css).not.toContain('@keyframes');
  });
});
