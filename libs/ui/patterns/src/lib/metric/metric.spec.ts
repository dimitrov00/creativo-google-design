import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  UiMetric,
  type UiMetricAlignment,
  type UiMetricControlSize,
  type UiMetricTrend,
} from './metric';

@Component({
  imports: [UiMetric],
  template: `
    <ui-metric
      [uiValue]="value()"
      [uiUnit]="unit()"
      [uiCaption]="caption()"
      [uiCaptionHidden]="captionHidden()"
      [uiIcon]="icon()"
      [uiDelta]="delta()"
      [uiTrend]="trend()"
      [uiCountFrom]="countFrom()"
      [uiLabel]="label()"
      [uiControlSize]="size()"
      [uiAlignment]="alignment()"
      data-testid="metric"
    >
      @if (accessory()) {
        <span uiMetricAccessory data-testid="accessory">meter</span>
      }
    </ui-metric>
  `,
})
class Host {
  readonly value = signal<string | null>('308');
  readonly unit = signal<string | null>('т.');
  readonly caption = signal<string | null>('за размяна');
  readonly captionHidden = signal(false);
  readonly icon = signal<'loyalty.points' | null>('loyalty.points');
  readonly delta = signal<string | null>(null);
  readonly trend = signal<UiMetricTrend | null>(null);
  readonly countFrom = signal<number | null>(null);
  readonly label = signal<string | null>(null);
  readonly size = signal<UiMetricControlSize>('regular');
  readonly alignment = signal<UiMetricAlignment>('leading');
  readonly accessory = signal(false);
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
  const metric = fixture.nativeElement.querySelector(
    '[data-testid="metric"]',
  ) as HTMLElement;
  const part = (name: string) =>
    metric.querySelector<HTMLElement>(`.ui-metric__${name}`);
  return { fixture, metric, part };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('UiMetric', () => {
  it('is a named group: glyph, value and unit on one line, the caption under it, drawn for the eye only', () => {
    const { metric, part } = render();
    expect(metric.getAttribute('role')).toBe('group');
    expect(metric.getAttribute('aria-label')).toBe('308 т. за размяна');
    expect(part('figure')?.getAttribute('aria-hidden')).toBe('true');
    expect(part('caption')?.getAttribute('aria-hidden')).toBe('true');
    expect(part('digits')?.textContent).toBe('308');
    expect(part('unit')?.textContent).toBe('т.');
    expect(part('caption')?.textContent).toBe('за размяна');
    expect(
      part('figure')?.querySelector('ui-icon')?.getAttribute('data-name'),
    ).toBe('loyalty.points');
    // Only spans: it must sit inside a button.
    expect(metric.querySelector('div, p, h1, h2, h3')).toBeNull();
  });

  it('draws the figure alone at rest — no stand-in holding its width', () => {
    const { part } = render();
    expect(part('digits')?.textContent).toBe('308');
    expect(part('ghost')).toBeNull();
  });

  it('takes the owner’s name over the one it would build', () => {
    const { metric, fixture } = render();
    fixture.componentInstance.label.set('Точки за размяна: 308');
    fixture.detectChanges();
    expect(metric.getAttribute('aria-label')).toBe('Точки за размяна: 308');
  });

  it('keeps a hidden caption in the name and off the screen', () => {
    const { metric, part } = render((host) => host.captionHidden.set(true));
    expect(part('caption')).toBeNull();
    expect(metric.getAttribute('aria-label')).toBe('308 т. за размяна');
  });

  it('draws a dash for no value — never a made-up zero — and asks for a name in words', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { metric, part, fixture } = render((host) => host.value.set(null));
    expect(part('digits')?.textContent).toBe('—');
    expect(metric.hasAttribute('data-empty')).toBe(true);
    expect(metric.getAttribute('aria-label')).toBe('за размяна');
    expect(warn).toHaveBeenCalledTimes(1);
    fixture.componentInstance.label.set('Точки: няма данни');
    fixture.detectChanges();
    expect(metric.getAttribute('aria-label')).toBe('Точки: няма данни');
  });

  it('stamps its size and alignment for the type roles', () => {
    const { metric, fixture, part } = render();
    expect(metric.dataset['controlSize']).toBe('regular');
    expect(metric.dataset['alignment']).toBe('leading');
    expect(part('glyph')?.getAttribute('data-scale')).toBe('medium');
    fixture.componentInstance.size.set('large');
    fixture.componentInstance.alignment.set('center');
    fixture.detectChanges();
    expect(metric.dataset['controlSize']).toBe('large');
    expect(metric.dataset['alignment']).toBe('center');
    expect(part('glyph')?.getAttribute('data-scale')).toBe('large');
  });

  it('has three rungs, each stamped for its type roles, the glyph on the icon ladder', () => {
    // The ladder ends at 24: the third rung keeps the second's glyph.
    const rungs: readonly [UiMetricControlSize, string][] = [
      ['regular', 'medium'],
      ['large', 'large'],
      ['extraLarge', 'large'],
    ];
    const { metric, fixture, part } = render();
    for (const [size, glyph] of rungs) {
      fixture.componentInstance.size.set(size);
      fixture.detectChanges();
      expect(metric.dataset['controlSize']).toBe(size);
      expect(part('glyph')?.getAttribute('data-scale')).toBe(glyph);
    }
  });

  it('draws the page’s figure on the third rung with the same parts and the same name', () => {
    const { metric, part } = render((host) => {
      host.size.set('extraLarge');
      host.icon.set(null);
      host.value.set('23');
      host.unit.set('от 25');
      host.caption.set('посещения с фейд');
    });
    expect(metric.dataset['controlSize']).toBe('extraLarge');
    expect(metric.getAttribute('role')).toBe('group');
    expect(metric.getAttribute('aria-label')).toBe('23 от 25 посещения с фейд');
    expect(part('glyph')).toBeNull();
    expect(part('digits')?.textContent).toBe('23');
    expect(part('unit')?.textContent).toBe('от 25');
    expect(part('caption')?.textContent).toBe('посещения с фейд');
    // Still phrasing content only: the rung adds no element.
    expect(metric.querySelector('div, p, h1, h2, h3')).toBeNull();
    expect(
      [...metric.querySelectorAll('[class^="ui-metric__"]')].map(
        (node) => node.className,
      ),
    ).toEqual([
      'ui-metric__figure',
      'ui-metric__value',
      'ui-metric__digits',
      'ui-metric__unit',
      'ui-metric__caption',
      'ui-metric__accessory',
    ]);
  });

  it('keeps the dash, the delta and the count-up’s stand-in on the third rung', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { metric, part, fixture } = render((host) => {
      host.size.set('extraLarge');
      host.value.set(null);
    });
    expect(part('digits')?.textContent).toBe('—');
    expect(metric.hasAttribute('data-empty')).toBe(true);
    fixture.componentInstance.value.set('24');
    fixture.componentInstance.delta.set('+1');
    fixture.componentInstance.trend.set('up');
    fixture.detectChanges();
    expect(part('digits')?.textContent).toBe('24');
    expect(part('delta')?.textContent).toBe('+1');
    expect(part('delta')?.hasAttribute('data-enter')).toBe(true);
  });

  it('projects a meter that belongs to the figure, left in the reading order', () => {
    const { fixture, part } = render();
    fixture.componentInstance.accessory.set(true);
    fixture.detectChanges();
    const accessory = part('accessory');
    expect(
      accessory?.querySelector('[data-testid="accessory"]'),
    ).not.toBeNull();
    expect(accessory?.getAttribute('aria-hidden')).toBeNull();
  });

  it('enters nothing on the first frame, even with a rising delta', () => {
    const { part, metric } = render((host) => {
      host.delta.set('+25');
      host.trend.set('up');
    });
    expect(metric.hasAttribute('data-settled')).toBe(true);
    expect(part('value')?.hasAttribute('data-enter')).toBe(false);
    expect(part('delta')?.textContent).toBe('+25');
    expect(part('delta')?.hasAttribute('data-enter')).toBe(false);
  });

  it('lets a live rise re-enter the value and raise its delta', () => {
    const { fixture, part } = render();
    const before = part('value');
    fixture.componentInstance.value.set('333');
    fixture.componentInstance.delta.set('+25');
    fixture.componentInstance.trend.set('up');
    fixture.detectChanges();
    // A new node for the new figure, so the enter can play on it.
    expect(part('value')).not.toBe(before);
    expect(part('value')?.hasAttribute('data-enter')).toBe(true);
    expect(part('delta')?.dataset['trend']).toBe('up');
    expect(part('delta')?.hasAttribute('data-enter')).toBe(true);
  });

  it('swaps a fall in place, silently, and keeps its delta on screen', () => {
    const { fixture, part, metric } = render();
    fixture.componentInstance.value.set('258');
    fixture.componentInstance.delta.set('−50');
    fixture.componentInstance.trend.set('down');
    fixture.detectChanges();
    expect(part('digits')?.textContent).toBe('258');
    expect(part('value')?.hasAttribute('data-enter')).toBe(false);
    expect(part('delta')?.textContent).toBe('−50');
    expect(part('delta')?.hasAttribute('data-enter')).toBe(false);
    expect(metric.dataset['trend']).toBe('down');
  });

  describe('the count-up (client self-view)', () => {
    function stubClock() {
      let progress: number | null = 0;
      const frames: FrameRequestCallback[] = [];
      const cancel = vi.fn();
      vi.stubGlobal(
        'requestAnimationFrame',
        (callback: FrameRequestCallback) => {
          frames.push(callback);
          return frames.length;
        },
      );
      vi.stubGlobal('cancelAnimationFrame', () => undefined);
      const animate = vi.fn(
        () =>
          ({
            effect: { getComputedTiming: () => ({ progress }) },
            finished: new Promise(() => undefined),
            cancel,
          }) as unknown as Animation,
      );
      HTMLElement.prototype.animate = animate as HTMLElement['animate'];
      return {
        animate,
        cancel,
        /** Runs every queued frame — the scheduler's own included. */
        step(next: number | null) {
          progress = next;
          for (const frame of frames.splice(0)) frame(0);
        },
      };
    }

    afterEach(() => {
      delete (HTMLElement.prototype as Partial<HTMLElement>).animate;
    });

    it('counts an integer up from the start on the platform clock, the name final from the first frame', () => {
      const clock = stubClock();
      const { fixture, part, metric } = render((host) => {
        host.value.set('340');
        host.countFrom.set(0);
      });
      expect(clock.animate).toHaveBeenCalledTimes(1);
      expect(part('digits')?.textContent).toBe('0');
      // The final figure holds the width unseen, so the frames never shove the unit.
      expect(part('ghost')?.textContent).toBe('340');
      expect(metric.getAttribute('aria-label')).toBe('340 т. за размяна');
      clock.step(0.5);
      fixture.detectChanges();
      expect(part('digits')?.textContent).toBe('170');
      clock.step(null);
      fixture.detectChanges();
      expect(part('digits')?.textContent).toBe('340');
      expect(part('ghost')).toBeNull();
    });

    it('jumps to the final figure at the first touch', () => {
      const clock = stubClock();
      const { fixture, part } = render((host) => {
        host.value.set('340');
        host.countFrom.set(0);
      });
      expect(part('digits')?.textContent).toBe('0');
      window.dispatchEvent(new Event('pointerdown'));
      fixture.detectChanges();
      expect(part('digits')?.textContent).toBe('340');
      expect(clock.cancel).toHaveBeenCalled();
    });

    it('counts a figure grouped with the locale’s no-break space', () => {
      const clock = stubClock();
      const { part } = render((host) => {
        host.value.set('12\u00a0450');
        host.countFrom.set(12000);
      });
      expect(clock.animate).toHaveBeenCalledTimes(1);
      // The first frame is the start, in the page's own locale.
      expect(part('digits')?.textContent).toBe(
        new Intl.NumberFormat(
          document.documentElement.lang || undefined,
        ).format(12000),
      );
    });

    it('never counts down', () => {
      const clock = stubClock();
      const { part } = render((host) => {
        host.value.set('340');
        host.countFrom.set(500);
      });
      expect(clock.animate).not.toHaveBeenCalled();
      expect(part('digits')?.textContent).toBe('340');
    });

    it('counts nothing but a whole number', () => {
      const clock = stubClock();
      const { part } = render((host) => {
        host.value.set('27,50');
        host.countFrom.set(0);
      });
      expect(clock.animate).not.toHaveBeenCalled();
      expect(part('digits')?.textContent).toBe('27,50');
    });

    it('shows the figure at once under reduced motion', () => {
      const clock = stubClock();
      vi.stubGlobal('matchMedia', (query: string) => ({
        matches: query.includes('reduce'),
      }));
      const { part } = render((host) => {
        host.value.set('340');
        host.countFrom.set(0);
      });
      expect(clock.animate).not.toHaveBeenCalled();
      expect(part('digits')?.textContent).toBe('340');
    });
  });
});

/*
 * THE TYPE LADDER, READ FROM THE STYLESHEET. jsdom lays nothing out, so the
 * roles, the inks and the seams are held where they are written.
 */
describe('metric.css · the three rungs', () => {
  const css = readFileSync(resolve(__dirname, 'metric.css'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\s+/g, ' ');

  const tokens = readFileSync(
    resolve(__dirname, '../../../../tokens/tokens.css'),
    'utf8',
  ).replace(/\s+/g, ' ');

  /** Every innermost rule: its selector (whitespace folded) and its declarations. */
  const sheet = new Map<string, Map<string, string>>();
  for (const [, selector = '', body = ''] of css.matchAll(
    /([^{}]+)\{([^{}]*)\}/g,
  )) {
    const declarations = new Map<string, string>();
    for (const declaration of body.split(';')) {
      const colon = declaration.indexOf(':');
      if (colon < 0) continue;
      declarations.set(
        declaration.slice(0, colon).trim(),
        declaration.slice(colon + 1).trim(),
      );
    }
    sheet.set(selector.trim(), declarations);
  }

  /** The declarations of the rule whose selector is EXACTLY `selector`. */
  function rule(selector: string): Map<string, string> {
    const found = sheet.get(selector);
    if (!found) throw new Error(`no rule «${selector}» in metric.css`);
    return found;
  }

  /** A type role as the tokens hold it: «800 2.25rem/0.96». */
  function role(name: string): string {
    // eslint-disable-next-line security/detect-non-literal-regexp -- a role name from this spec, over the DS's own tokens.
    const found = new RegExp(
      `--sys-font-${name}: (\\d+ [\\d.]+rem/[\\d.]+) `,
    ).exec(tokens)?.[1];
    if (!found) throw new Error(`tokens.css holds no role «${name}»`);
    return found;
  }

  const XL = ".ui-metric[data-control-size='extraLarge']";
  const LARGE = ".ui-metric[data-control-size='large']";

  it('leaves the first two rungs as they were: title3 over caption, title over footnote', () => {
    const value = rule('.ui-metric__value');
    expect(value.get('font')).toBe('var(--sys-font-title3)');
    expect(value.get('color')).toBe('currentColor');
    expect(rule('.ui-metric__unit').get('font')).toBe(
      'var(--sys-font-subheadline)',
    );
    expect(rule('.ui-metric__caption').get('font')).toBe(
      'var(--sys-font-caption)',
    );
    expect(rule('.ui-metric').get('gap')).toBe(
      'calc(var(--sys-space-unit) / 2)',
    );
    expect(rule('.ui-metric__figure').get('gap')).toBe(
      'var(--sys-space-tight)',
    );
    expect(rule('.ui-metric__figure').get('white-space')).toBe('nowrap');

    const large = rule(`${LARGE} .ui-metric__value`);
    expect(large.get('font')).toBe('var(--sys-font-title)');
    expect(large.get('letter-spacing')).toBe('var(--sys-tracking-title)');
    expect(
      rule(`${LARGE} .ui-metric__unit, ${LARGE} .ui-metric__delta`).get('font'),
    ).toBe('var(--sys-font-callout)');
    expect(rule(`${LARGE} .ui-metric__caption`).get('font')).toBe(
      'var(--sys-font-footnote)',
    );
    // The roles behind them: 20/600 and 28/700.
    expect(role('title3')).toBe('600 1.25rem/1.2');
    expect(role('title')).toBe('700 1.75rem/1.08');
  });

  it('sets the third rung’s figure in largeTitle, 36/800, tracked and tabular', () => {
    const value = rule(`${XL} .ui-metric__value`);
    expect(value.get('font')).toBe('var(--sys-font-largeTitle)');
    expect(value.get('letter-spacing')).toBe('var(--sys-tracking-largeTitle)');
    // The shorthand resets the numerals: the rung says them again, after it.
    expect([...value.keys()]).toEqual([
      'font',
      'letter-spacing',
      'font-variant-numeric',
    ]);
    expect(value.get('font-variant-numeric')).toBe('tabular-nums');
    expect(role('largeTitle')).toBe('800 2.25rem/0.96');
  });

  it('sets the unit and the delta in title3, 20/600, and the caption in callout, 14', () => {
    const quiet = rule(`${XL} .ui-metric__unit, ${XL} .ui-metric__delta`);
    expect(quiet.get('font')).toBe('var(--sys-font-title3)');
    expect(quiet.get('font-variant-numeric')).toBe('tabular-nums');
    const caption = rule(`${XL} .ui-metric__caption`);
    expect(caption.get('font')).toBe('var(--sys-font-callout)');
    // The caption role's tracking belongs to the 11 pt caption only.
    expect(caption.get('letter-spacing')).toBe('normal');
    expect(caption.get('font-variant-numeric')).toBe('tabular-nums');
    expect(role('callout')).toBe('400 0.875rem/1.45');
  });

  it('paints nothing of its own on the third rung: the figure is the container’s ink, the rest the quiet ink', () => {
    const rung = [...sheet].filter(([selector]) => selector.includes(XL));
    expect(rung.length).toBeGreaterThan(0);
    for (const [, declarations] of rung) {
      expect(declarations.has('color')).toBe(false);
    }
    // What the rung inherits from the base rules.
    expect(rule('.ui-metric__value').get('color')).toBe('currentColor');
    for (const part of ['unit', 'delta', 'caption']) {
      expect(rule(`.ui-metric__${part}`).get('color')).toBe(
        'var(--sys-color-secondary-label)',
      );
    }
    // One orange, and never on a figure: the accent is a shape's.
    expect(css).not.toContain('--sys-color-accent');
    expect(css).not.toContain('--sys-color-promo');
  });

  it('opens the third rung’s seams on the space scale: a word space, and the tight step over the caption', () => {
    expect(rule(XL).get('gap')).toBe('var(--sys-space-tight)');
    expect(rule(`${XL} .ui-metric__figure`).get('gap')).toBe(
      '0 var(--sys-space-compact)',
    );
    // No literal length anywhere on the rung.
    for (const [selector, declarations] of sheet) {
      if (!selector.includes(XL)) continue;
      for (const value of declarations.values()) {
        expect(value).not.toMatch(/\d(px|rem|em)\b/);
        expect(value).not.toMatch(/#[0-9a-f]{3,8}\b/i);
      }
    }
  });

  it('breaks the third rung’s line between its parts, never inside one, and never out of the card', () => {
    const figure = rule(`${XL} .ui-metric__figure`);
    expect(figure.get('flex-wrap')).toBe('wrap');
    // Each part stays whole, and the line never outgrows its host.
    expect(rule('.ui-metric__figure').get('white-space')).toBe('nowrap');
    expect(rule('.ui-metric__figure').get('max-inline-size')).toBe('100%');
    expect(rule('.ui-metric').get('max-inline-size')).toBe('100%');
    // A broken line stays on the figure's axis.
    expect(
      rule(`${XL}[data-alignment='center'] .ui-metric__figure`).get(
        'justify-content',
      ),
    ).toBe('center');
    // The first two rungs keep their one line.
    expect(rule('.ui-metric__figure').has('flex-wrap')).toBe(false);
    expect(sheet.has(`${LARGE} .ui-metric__figure`)).toBe(false);
  });

  it('holds the digits’ width through a count-up on every rung', () => {
    expect(rule('.ui-metric__value').get('display')).toBe('inline-grid');
    expect(rule('.ui-metric__digits, .ui-metric__ghost').get('grid-area')).toBe(
      '1 / 1',
    );
    expect(rule('.ui-metric__ghost').get('visibility')).toBe('hidden');
    expect(sheet.has(`${XL} .ui-metric__digits`)).toBe(false);
    expect(sheet.has(`${XL} .ui-metric__ghost`)).toBe(false);
  });
});
