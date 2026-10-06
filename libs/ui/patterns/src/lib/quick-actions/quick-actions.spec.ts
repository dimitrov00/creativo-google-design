import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  UiQuickAction,
  UiQuickActions,
  type UiQuickActionProminence,
} from './quick-actions';

/**
 * The stylesheet as written, its comments out and its whitespace folded:
 * the CSS contract jsdom cannot lay out. The air inside a bracket is
 * folded away too, so a value reads the same however the formatter of the
 * day breaks its lines.
 */
const css = readFileSync(resolve(__dirname, 'quick-actions.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\s+/g, ' ')
  .replace(/\( /g, '(')
  .replace(/ \)/g, ')');

/** Every rule of a sheet, innermost first: its selector and what it declares. */
function rules(sheet: string): Map<string, string> {
  const found = new Map<string, string>();
  for (const [, selector, body] of sheet.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    found.set((selector ?? '').trim(), body ?? '');
  }
  return found;
}

/** The declarations of the rule whose selector is EXACTLY `selector`. */
function rule(selector: string, sheet = unconditional): string {
  const body = rules(sheet).get(selector);
  if (body === undefined) throw new Error(`no rule for «${selector}»`);
  return body;
}

/** What an at-rule holds, by its prelude: `@media (hover: hover)`. */
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

/** The sheet less its `@media` blocks: the rules that always hold. */
const unconditional = [
  '@media (hover: hover)',
  '@media (prefers-reduced-motion: reduce)',
].reduce(
  (sheet, prelude) => sheet.replace(`${prelude} {${block(prelude)}}`, ''),
  css,
);

const ALIVE = ":not(:disabled, [aria-disabled='true'])";

/** The accent wash: the one tint behind a toned mark. */
const WASH =
  'color-mix(in srgb, var(--sys-color-accent) var(--sys-alpha-tint), transparent)';

/** The promoted verb's rule: the verb itself, never a part of it. */
const PROMOTED = ".ui-quick-action[data-prominence='accent']";

/** The selectors of the rules whose `color` names `token`, in sheet order. */
function inkedIn(token: string): string[] {
  return [...rules(css)]
    .filter(([, body]) =>
      (/(?<![\w-])color\s*:\s*([^;}]+)/.exec(body)?.[1] ?? '').includes(token),
    )
    .map(([selector]) => selector);
}

/** Every custom property the sheet READS through `var()`, once per read. */
const read = [...css.matchAll(/var\(\s*(--[\w-]+)/g)].map((found) => found[1]);

/** How many times the sheet reads `property`. */
function reads(property: string): number {
  return read.filter((name) => name === property).length;
}

/** The selectors of the rules that READ `property`, in sheet order. */
function readers(property: string): string[] {
  return [...rules(css)]
    .filter(([, body]) =>
      [...body.matchAll(/var\(\s*(--[\w-]+)/g)].some(
        (found) => found[1] === property,
      ),
    )
    .map(([selector]) => selector);
}

/** The state layer of a live verb, under the pointer and under the thumb. */
const LAYER_HOVER = `.ui-quick-action${ALIVE}:hover .ui-quick-action__disc::after`;
const LAYER_PRESS = `.ui-quick-action${ALIVE}:active .ui-quick-action__disc::after`;

/** The selectors of the rules that DECLARE `property`, in sheet order. */
function declares(property: string): string[] {
  return [...rules(css)]
    .filter(([, body]) =>
      [...body.matchAll(/(?<![\w-])(--[\w-]+)\s*:/g)].some(
        (found) => found[1] === property,
      ),
    )
    .map(([selector]) => selector);
}

@Component({
  imports: [UiQuickActions, UiQuickAction],
  template: `
    <ui-quick-actions uiLabel="Връзка" [uiColumns]="columns()">
      <a
        uiQuickAction
        uiIcon="contact.phone"
        href="tel:+359881234567"
        aria-label="Обади се на Георги Петров, +359 88 123 4567"
        data-testid="call"
        >Обади се</a
      >
      <a
        uiQuickAction
        uiIcon="contact.sms"
        [uiProminence]="sms()"
        href="sms:+359881234567"
        data-testid="sms"
        >SMS</a
      >
      <a
        uiQuickAction
        uiIcon="contact.viber"
        href="viber://chat?number=%2B359881234567"
        >Viber</a
      >
      <button
        uiQuickAction
        uiIcon="visit.repeat"
        [uiProminence]="same()"
        data-testid="same"
        (click)="taps = taps + 1"
      >
        Повтори
        @if (count() !== null) {
          <span uiQuickActionBadge data-testid="count">{{ count() }}</span>
        }
      </button>
      @if (columns() === 5) {
        <button uiQuickAction uiIcon="appointment.book" data-testid="long">
          Добави в календара и напомни
        </button>
      }
    </ui-quick-actions>
  `,
})
class Host {
  readonly columns = signal(4);
  readonly same = signal<UiQuickActionProminence>('accent');
  readonly sms = signal<UiQuickActionProminence>('standard');
  readonly count = signal<number | null>(null);
  taps = 0;
}

function render(arrange?: (host: Host) => void) {
  TestBed.configureTestingModule({
    imports: [Host],
    errorOnUnknownElements: true,
    errorOnUnknownProperties: true,
  });
  const fixture = TestBed.createComponent(Host);
  arrange?.(fixture.componentInstance);
  fixture.detectChanges();
  const root = fixture.nativeElement as HTMLElement;
  const run = root.querySelector('ui-quick-actions') as HTMLElement;
  const verb = (id: string) =>
    root.querySelector(`[data-testid="${id}"]`) as HTMLElement;
  return { fixture, host: fixture.componentInstance, root, run, verb };
}

afterEach(() => vi.restoreAllMocks());

describe('UiQuickActions', () => {
  describe('the run', () => {
    it('is one named group, a column per present verb', () => {
      const { run } = render();
      expect(run.classList.contains('ui-quick-actions')).toBe(true);
      expect(run.getAttribute('role')).toBe('group');
      expect(run.getAttribute('aria-label')).toBe('Връзка');
      expect(run.style.getPropertyValue('--ui-quick-actions-columns')).toBe(
        '4',
      );
      expect(run.querySelectorAll('.ui-quick-action')).toHaveLength(4);
    });

    it('closes up or opens a column as verbs come and go, never a hole', () => {
      const { fixture, host, run } = render();
      host.columns.set(5);
      fixture.detectChanges();
      expect(run.style.getPropertyValue('--ui-quick-actions-columns')).toBe(
        '5',
      );
      expect(run.querySelectorAll('.ui-quick-action')).toHaveLength(5);
    });

    it('sets its columns at one pitch (88), centred, with no gap between them', () => {
      const face = rule('.ui-quick-actions');
      expect(face).toContain('display: grid');
      expect(face).toContain(
        'grid-template-columns: repeat(var(--ui-quick-actions-columns, 4), ' +
          'minmax(0, var(--ui-quick-actions-pitch, calc(var(--sys-space-unit) * 22))))',
      );
      expect(face).toContain('justify-content: center');
      // The pitch is the rhythm: a column never stretches, and nothing
      // parts two columns but the air the pitch leaves round a disc.
      expect(face).not.toContain('1fr');
      expect(face).not.toMatch(/(?:^|[ ;])(?:column-)?gap:/);
      // A run told to wrap parts its ROWS.
      expect(face).toContain('row-gap: var(--sys-space-regular)');
    });
  });

  describe('a verb', () => {
    it('is its glyph on a disc over its word', () => {
      const { verb } = render();
      const call = verb('call');
      expect(call.tagName).toBe('A');
      expect(call.classList.contains('ui-quick-action')).toBe(true);
      expect([...call.children].map((part) => part.className)).toEqual([
        'ui-quick-action__disc',
        'ui-quick-action__label',
      ]);
      const glyph = call.querySelector(
        '.ui-quick-action__disc > ui-icon.ui-quick-action__glyph',
      );
      expect(glyph?.getAttribute('data-name')).toBe('contact.phone');
      expect(glyph?.getAttribute('data-scale')).toBe('large');
      // The glyph is decoration: the word (and the owner's name) says it.
      expect(glyph?.getAttribute('aria-hidden')).toBe('true');
      expect(call.querySelector('.ui-quick-action__label')?.textContent).toBe(
        'Обади се',
      );
      // The consumer's accessible name begins with the visible word.
      expect(call.getAttribute('aria-label')?.startsWith('Обади се')).toBe(
        true,
      );
    });

    it('keeps a link a link and makes a button a plain button', () => {
      const { verb, host } = render();
      expect(verb('sms').getAttribute('type')).toBeNull();
      expect(verb('sms').getAttribute('href')).toBe('sms:+359881234567');
      const same = verb('same') as HTMLButtonElement;
      expect(same.getAttribute('type')).toBe('button');
      same.click();
      expect(host.taps).toBe(1);
    });

    it('is a column that paints nothing itself: no tile, no fill, no corner', () => {
      const { verb } = render();
      // The surface grammar would draw its layer and its ring round the
      // whole column: the verb does not wear it.
      expect(verb('call').hasAttribute('data-interactive')).toBe(false);
      expect(verb('same').hasAttribute('data-interactive')).toBe(false);

      const face = rule('.ui-quick-action');
      expect(face).toContain('flex-direction: column');
      expect(face).toContain('align-items: center');
      expect(face).toContain('gap: var(--sys-space-compact)');
      expect(face).toContain('padding: var(--sys-space-tight) 0');
      expect(face).toContain('background: none');
      expect(face).toContain('font: var(--sys-font-footnote)');
      expect(face).toContain('font-variant-numeric: tabular-nums');
      expect(face).not.toContain('border-radius');
      expect(face).not.toContain('min-block-size');

      // The tile face is gone from the sheet, whole.
      expect(css).not.toContain('--control-size-tile');
      expect(css).not.toContain('--control-radius-regular');
      expect(css).not.toContain('line-clamp');
      expect(css).not.toContain('text-wrap');
    });

    it('draws the disc on the large rung (52), round', () => {
      const disc = rule('.ui-quick-action__disc');
      expect(disc).toContain(
        'inline-size: var(--ui-quick-action-disc, var(--control-size-large))',
      );
      expect(disc).toContain(
        'block-size: var(--ui-quick-action-disc, var(--control-size-large))',
      );
      expect(disc).toContain('border-radius: var(--control-radius-capsule)');
      expect(disc).toContain('flex: none');
    });

    it('is TINTED by default: the accent wash, the glyph in the one orange', () => {
      expect(rule('.ui-quick-action__disc')).toContain(
        `background: var(--ui-quick-action-fill, ${WASH})`,
      );
      expect(rule('.ui-quick-action__glyph')).toContain(
        'color: var(--ui-quick-action-ink, var(--sys-color-accent))',
      );
      // The neutral fill is no longer what a disc wears unasked.
      expect(css).not.toContain('--sys-color-fill');
    });

    it('keeps the neutral fill within reach: two properties of the run', () => {
      // A run (or anything round it) that sets the two is neutral again:
      // nothing in the sheet declares them for a standard verb…
      expect(declares('--ui-quick-action-fill')).toEqual([PROMOTED]);
      expect(declares('--ui-quick-action-ink')).toEqual([PROMOTED]);
      // …and they are read by the disc's fill, by the glyph's ink and by
      // the state layer, so whatever a run says paints a disc and the
      // mark on it, and nothing else.
      expect(readers('--ui-quick-action-fill')).toEqual([
        '.ui-quick-action__disc',
      ]);
      expect(readers('--ui-quick-action-ink')).toEqual([
        '.ui-quick-action__glyph',
        LAYER_HOVER,
        LAYER_PRESS,
      ]);
      expect(rule('.ui-quick-action__disc')).toMatch(
        /background: var\(--ui-quick-action-fill,/,
      );
      expect(rule('.ui-quick-action__glyph')).toMatch(
        /(?<![\w-])color: var\(--ui-quick-action-ink,/,
      );
      // The sizes and the promoted pair are the consumer's alone.
      for (const property of [
        '--ui-quick-action-disc',
        '--ui-quick-actions-pitch',
        '--ui-quick-action-promoted-fill',
        '--ui-quick-action-promoted-ink',
      ]) {
        expect(declares(property)).toEqual([]);
      }
    });

    it('keeps its word on ONE line, in the primary ink, and ends a long one in an ellipsis', () => {
      const { fixture, host, verb } = render();
      host.columns.set(5);
      fixture.detectChanges();
      expect(
        verb('long')
          .querySelector('.ui-quick-action__label')
          ?.textContent?.trim(),
      ).toBe('Добави в календара и напомни');

      const label = rule('.ui-quick-action__label');
      expect(label).toContain('white-space: nowrap');
      expect(label).toContain('text-overflow: ellipsis');
      expect(label).toContain('overflow: hidden');
      expect(label).toContain('max-inline-size: 100%');
      expect(label).toContain('color: var(--sys-color-foreground)');
    });
  });

  describe('uiProminence', () => {
    it('is standard unless told, and stamps what it is', () => {
      const { fixture, host, verb } = render();
      expect(verb('call').dataset['prominence']).toBe('standard');
      expect(verb('same').dataset['prominence']).toBe('accent');
      host.same.set('standard');
      fixture.detectChanges();
      expect(verb('same').dataset['prominence']).toBe('standard');
    });

    it('promotes a verb to the SOLID disc, its glyph white', () => {
      const promoted = rule(PROMOTED);
      expect(promoted).toContain(
        '--ui-quick-action-fill: var(--ui-quick-action-promoted-fill, var(--sys-color-accent))',
      );
      expect(promoted).toContain(
        '--ui-quick-action-ink: var(--ui-quick-action-promoted-ink, var(--sys-color-on-accent))',
      );
      // It re-points the disc's own hooks and paints nothing itself: the
      // disc and the glyph keep ONE rule each, whatever the prominence.
      expect(promoted).not.toMatch(/(?<![\w-])(?:color|background)\s*:/);
      const selectors = [...rules(css).keys()];
      expect(
        selectors.filter((selector) =>
          selector.endsWith('.ui-quick-action__disc'),
        ),
      ).toEqual([
        '.ui-quick-action__disc',
        `.ui-quick-action${ALIVE}:active .ui-quick-action__disc`,
        '.ui-quick-action:focus-visible .ui-quick-action__disc',
      ]);
      expect(
        selectors.filter((selector) =>
          selector.endsWith('.ui-quick-action__glyph'),
        ),
      ).toEqual(['.ui-quick-action__glyph']);
    });

    it('lets a run draw its promoted verb otherwise: a pair of its own', () => {
      // What a run says for its standard discs never reaches the promoted
      // one (the verb re-declares the two); its own pair does.
      expect(reads('--ui-quick-action-promoted-fill')).toBe(1);
      expect(reads('--ui-quick-action-promoted-ink')).toBe(1);
    });

    it('inks a MARK in white and nothing else: the white reaches the glyph alone', () => {
      // No rule sets the on-accent white as a `color`: it arrives through
      // the glyph's hook, whose one reader is the glyph (a mark, 24 on a
      // 52 disc). The accent law's guard 7 has no rule of this sheet to
      // record; this case holds what the hook paints.
      expect(inkedIn('--sys-color-on-accent')).toEqual([]);
      expect(css.split('--sys-color-on-accent')).toHaveLength(2);
      // One `color` reads the hook, the glyph's; the other two readers
      // are the state layer's fills.
      expect(inkedIn('--ui-quick-action-ink')).toEqual([
        '.ui-quick-action__glyph',
      ]);
      expect(reads('--ui-quick-action-ink')).toBe(3);
      expect(rule('.ui-quick-action__label')).not.toContain(
        '--ui-quick-action',
      );
      expect(rule('.ui-quick-action')).not.toContain('--ui-quick-action');
    });

    it('never tints the word: colour is a shape, words are ink', () => {
      // The accent as INK is a glyph's alone (the accent law's guard reads
      // the selector's last part).
      expect(inkedIn('--sys-color-accent')).toEqual([
        '.ui-quick-action__glyph',
      ]);
      expect(rule('.ui-quick-action__label')).toContain(
        'color: var(--sys-color-foreground)',
      );
      expect(rule('.ui-quick-action')).toContain(
        'color: var(--sys-color-foreground)',
      );
      expect(css).not.toContain('--sys-color-accent-label');
      expect(css).not.toContain('--sys-color-promo');
      // The label's one rule is its own.
      expect(css.match(/\.ui-quick-action__label\s*\{/g)).toHaveLength(1);
    });

    it('lets a run promote one verb without a word', () => {
      const warn = vi
        .spyOn(console, 'warn')
        .mockImplementation(() => undefined);
      render();
      expect(warn).not.toHaveBeenCalled();
    });

    it('says so in development when a run promotes two, once', () => {
      const warn = vi
        .spyOn(console, 'warn')
        .mockImplementation(() => undefined);
      const { fixture, host } = render((h) => h.sms.set('accent'));
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0]?.[0])).toContain('[ui-quick-actions]');
      host.same.set('standard');
      fixture.detectChanges();
      host.same.set('accent');
      fixture.detectChanges();
      expect(warn).toHaveBeenCalledTimes(1);
    });
  });

  describe('the states', () => {
    const layer = LAYER_HOVER;
    const press = LAYER_PRESS;
    const scale = `.ui-quick-action${ALIVE}:active .ui-quick-action__disc`;
    /** The mark's ink at one rung of the theme's ladder. */
    const mixed = (rung: string): string =>
      'background: color-mix(in srgb, ' +
      `var(--ui-quick-action-ink, var(--sys-color-accent)) var(${rung}), ` +
      'transparent)';

    it('draws the state layer on the DISC, round as the disc', () => {
      const after = rule('.ui-quick-action__disc::after');
      expect(after).toContain("content: ''");
      expect(after).toContain('inset: 0');
      expect(after).toContain('border-radius: inherit');
      expect(after).toContain('pointer-events: none');
      expect(after).toContain('background: transparent');
      // The disc's ink is said, not inherited: an anchor's colour never
      // reaches what the disc holds.
      expect(rule('.ui-quick-action__disc')).toContain(
        'color: var(--sys-color-foreground)',
      );
    });

    it('mixes the MARK’s ink into the layer, so a disc deepens in its own hue', () => {
      const hover = block('@media (hover: hover)');
      // The rungs of the system's own state layers, the colour named: the
      // wash goes deeper into the orange, the solid disc lifts under its
      // white, a neutral disc goes a step greyer.
      expect(rule(layer, hover)).toContain(mixed('--sys-alpha-fill-hover'));
      expect(rule(press)).toContain(mixed('--sys-alpha-press'));
      // Never the primary ink over the wash (it turns the orange to mud),
      // so never the `currentColor` layers of the system.
      expect(css).not.toContain('--sys-state-layer-');
      expect(css).not.toContain('currentColor');
    });

    it('gates the hover on a pointer that hovers', () => {
      const hover = block('@media (hover: hover)');
      expect(rules(hover).has(layer)).toBe(true);
      // Nowhere else.
      expect(css.split(':hover')).toHaveLength(2);
    });

    it('shows the press to a thumb too: ungated, the disc scaled to the control step', () => {
      const hover = block('@media (hover: hover)');
      expect(hover).not.toContain(':active');
      expect(rules(unconditional).has(press)).toBe(true);
      expect(rule(press)).toContain(
        'transition-duration: var(--sys-motion-duration-instant)',
      );
      expect(rule(scale)).toContain(
        'transform: scale(var(--sys-press-scale-control))',
      );
    });

    it('holds the disc still for a person who asked for less motion', () => {
      const reduced = block('@media (prefers-reduced-motion: reduce)');
      // The press rule's own selector: a shorter one would lose to it.
      expect(rule(scale, reduced)).toContain('transform: none');
    });

    it('rings the disc, not the column', () => {
      expect(rule('.ui-quick-action:focus-visible')).toContain('outline: none');
      const ring = rule(
        '.ui-quick-action:focus-visible .ui-quick-action__disc',
      );
      expect(ring).toContain(
        'outline: var(--sys-focus-ring-width) solid var(--sys-color-ring)',
      );
      expect(ring).toContain('outline-offset: var(--sys-focus-ring-offset)');
    });
  });

  describe('a count on the disc', () => {
    it('takes a projected badge on the disc, never in the word', () => {
      const { verb } = render((h) => h.count.set(2));
      const same = verb('same');
      const slot = same.querySelector(
        '.ui-quick-action__disc > .ui-quick-action__badge',
      );
      expect(slot?.querySelector('[data-testid="count"]')?.textContent).toBe(
        '2',
      );
      expect(
        same.querySelector('.ui-quick-action__label')?.textContent?.trim(),
      ).toBe('Повтори');
      expect(
        same.querySelector('.ui-quick-action__label [data-testid="count"]'),
      ).toBeNull();
    });

    it('leaves the slot empty without one', () => {
      const { verb } = render();
      expect(
        verb('same').querySelector('.ui-quick-action__badge')?.children,
      ).toHaveLength(0);
      expect(
        verb('call').querySelector('.ui-quick-action__badge')?.children,
      ).toHaveLength(0);
    });

    it('sits on the rim at the top trailing corner, above the state layer', () => {
      const badge = rule('.ui-quick-action__badge');
      expect(badge).toContain('position: absolute');
      expect(badge).toContain(
        'inset-block-start: calc(var(--sys-space-tight) * -0.5)',
      );
      expect(badge).toContain(
        'inset-inline-end: calc(var(--sys-space-tight) * -0.5)',
      );
      expect(badge).toContain('z-index: 1');
      expect(badge).toContain('pointer-events: none');
      expect(rule('.ui-quick-action__disc')).toContain('isolation: isolate');
    });
  });
});
