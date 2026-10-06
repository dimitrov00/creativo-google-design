import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { UiMark } from '../mark-scale/mark-scale';
import { UiGauge, type UiGaugeControlSize, type UiGaugeStyle } from './gauge';

const css = readFileSync(resolve(__dirname, 'gauge.css'), 'utf8');

/** One rule's body, comments dropped and whitespace folded, by its exact selector. */
function ruleBody(selector: string): string {
  const flat = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, ' ');
  const at = flat.indexOf(`${selector} {`);
  if (at < 0) throw new Error(`gauge.css has no "${selector}" rule`);
  return flat.slice(at + selector.length + 2, flat.indexOf('}', at));
}

/** The body of the ONE rule whose whole selector is `selector` (a grouped rule never answers for a member). */
function ownRuleBody(selector: string): string {
  const flat = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, ' ');
  const found = [...flat.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter(
    ([, candidate]) => candidate?.trim() === selector,
  );
  if (found.length !== 1) {
    throw new Error(`gauge.css has ${found.length} "${selector}" rules`);
  }
  return found[0]?.[2] ?? '';
}

/** A theme file's `#rrggbb` token, as the page resolves it. */
function themeHex(theme: 'light' | 'dark', token: string): string {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- one of the DS's two theme files, named by this spec.
  const file = readFileSync(
    resolve(__dirname, `../../../../tokens/theme-${theme}.css`),
    'utf8',
  );
  // eslint-disable-next-line security/detect-non-literal-regexp -- a token name from this spec, over the DS's own theme file.
  const hex = new RegExp(`${token}:\\s*(#[0-9a-f]{6})`, 'i').exec(file)?.[1];
  if (!hex) throw new Error(`theme-${theme}.css sets no ${token}`);
  return hex;
}

const tokens = readFileSync(
  resolve(__dirname, '../../../../tokens/tokens.css'),
  'utf8',
);

/** A size token in POINTS at the default density: `calc(var(--sys-space-unit) * N)` is N × 4. */
function tokenPoints(token: string): number {
  // eslint-disable-next-line security/detect-non-literal-regexp -- a token name from this spec, over the DS's own tokens file.
  const units = new RegExp(
    `${token}:\\s*calc\\(var\\(--sys-space-unit\\) \\* ([\\d.]+)\\)`,
  ).exec(tokens)?.[1];
  if (!units) throw new Error(`tokens.css sets no ${token} in space units`);
  return Number(units) * 4;
}

/** A declaration of the gauge's own, `calc(<token> + unit × N)` or `unit × N` or `unit`, in points. */
function points(declaration: string): number {
  const value = declaration.trim();
  if (value === 'var(--sys-space-unit)') return 4;
  const times = /^calc\(var\(--sys-space-unit\) \* ([\d.]+)\)$/.exec(value);
  if (times) return Number(times[1]) * 4;
  const sum =
    /^calc\( var\((--[\w-]+)\) \+ var\(--sys-space-unit\) \* ([\d.]+) \)$/.exec(
      value,
    );
  if (sum) return tokenPoints(sum[1] ?? '') + Number(sum[2]) * 4;
  throw new Error(`not a size this spec reads: "${value}"`);
}

/** One custom property of a rule's body. */
function declared(body: string, property: string): string {
  // eslint-disable-next-line security/detect-non-literal-regexp -- a property name from this spec, over the gauge's own stylesheet.
  const value = new RegExp(`${property}: ([^;]+);`).exec(body)?.[1];
  if (!value) throw new Error(`no ${property} in "${body}"`);
  return value;
}

/** WCAG 2.x contrast of two `#rrggbb` colours (axe's knee, 0.03928). */
function contrast(a: string, b: string): number {
  const luminance = (hex: string) => {
    const [r, g, bl] = [1, 3, 5].map((i) => {
      const c = parseInt(hex.slice(i, i + 2), 16) / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    }) as [number, number, number];
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [
    number,
    number,
  ];
  return (hi + 0.05) / (lo + 0.05);
}

@Component({
  imports: [UiGauge],
  template: `
    <ui-gauge
      [uiValue]="value()"
      [uiMin]="min()"
      [uiMax]="max()"
      [uiGaugeStyle]="style()"
      [uiControlSize]="size()"
      [uiMarks]="marks()"
      [uiColumns]="columns()"
      [uiRewardIcon]="reward()"
      [uiLabel]="'Точки'"
      [uiValueText]="'308 точки, стигат за 2 от 3 награди'"
      data-testid="gauge"
    />
  `,
})
class Host {
  readonly value = signal(308);
  readonly min = signal(0);
  readonly max = signal(400);
  readonly style = signal<UiGaugeStyle>('linearCapacity');
  readonly size = signal<UiGaugeControlSize>('regular');
  readonly marks = signal<readonly UiMark[]>([
    { value: 120, label: '120 т.' },
    { value: 250, label: '250 т.' },
    { value: 400, label: '400 т.' },
  ]);
  readonly columns = signal<number | null>(null);
  readonly reward = signal<'loyalty.reward' | null>(null);
}

/** The ring as its composers mount it: the centre projected, the extent stamped. */
@Component({
  imports: [UiGauge],
  template: `
    <ui-gauge
      uiGaugeStyle="circularCapacity"
      [uiValue]="value()"
      [uiMin]="min()"
      [uiMax]="max()"
      [uiControlSize]="size()"
      [uiMarks]="marks()"
      [attr.data-extent]="extent()"
      [uiLabel]="'Статус'"
      [uiValueText]="'Злато, 13 посещения за 12 месеца, още 7 до Платина'"
      data-testid="ring"
    >
      @if (figure(); as figure) {
        <span uiCurrentValueLabel data-testid="figure">{{ figure }}</span>
      }
      <span data-testid="stray">не се рисува</span>
    </ui-gauge>
  `,
})
class RingHost {
  readonly value = signal(13);
  readonly min = signal(10);
  readonly max = signal(20);
  readonly size = signal<UiGaugeControlSize>('large');
  readonly marks = signal<readonly UiMark[]>([]);
  readonly extent = signal<'dashed' | null>(null);
  readonly figure = signal<string | null>('7');
}

function renderRing(setup?: (host: RingHost) => void) {
  TestBed.configureTestingModule({
    imports: [RingHost],
    errorOnUnknownElements: true,
    errorOnUnknownProperties: true,
  });
  const fixture = TestBed.createComponent(RingHost);
  setup?.(fixture.componentInstance);
  fixture.detectChanges();
  const ring = fixture.nativeElement.querySelector(
    '[data-testid="ring"]',
  ) as HTMLElement;
  const all = (selector: string) => [
    ...ring.querySelectorAll<Element>(selector),
  ];
  return { fixture, host: fixture.componentInstance, ring, all };
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
  const gauge = fixture.nativeElement.querySelector(
    '[data-testid="gauge"]',
  ) as HTMLElement;
  const all = (selector: string) => [
    ...gauge.querySelectorAll<HTMLElement>(selector),
  ];
  return { fixture, host: fixture.componentInstance, gauge, all };
}

const stampCard = (host: Host) => {
  host.style.set('discreteCapacity');
  host.min.set(0);
  host.max.set(10);
  host.value.set(4);
  host.columns.set(5);
  host.reward.set('loyalty.reward');
  host.marks.set([]);
};

const tierTrack = (host: Host) => {
  host.style.set('steps');
  host.min.set(0);
  host.max.set(20);
  host.value.set(14);
  host.marks.set([
    { value: 0, label: 'Бронз', short: 'I' },
    { value: 4, label: 'Сребро', short: 'II' },
    { value: 10, label: 'Злато', short: 'III', detail: ['3.06'] },
    {
      value: 20,
      label: 'Платина',
      short: 'IV',
      detail: ['още 6', '+50 т.', 'extra'],
    },
  ]);
};

afterEach(() => vi.restoreAllMocks());

describe('UiGauge', () => {
  describe('the meter a reader hears', () => {
    it('is a meter — never a progress bar — with its bounds, the value clamped, a name and the owner’s reading', () => {
      const { gauge, fixture, host } = render();
      expect(gauge.getAttribute('role')).toBe('meter');
      expect(gauge.getAttribute('aria-label')).toBe('Точки');
      expect(gauge.getAttribute('aria-valuetext')).toBe(
        '308 точки, стигат за 2 от 3 награди',
      );
      expect(gauge.getAttribute('aria-valuemin')).toBe('0');
      expect(gauge.getAttribute('aria-valuemax')).toBe('400');
      expect(gauge.getAttribute('aria-valuenow')).toBe('308');
      host.value.set(450);
      fixture.detectChanges();
      expect(gauge.getAttribute('aria-valuenow')).toBe('400');
      expect(gauge.hasAttribute('data-complete')).toBe(true);
      host.value.set(-5);
      fixture.detectChanges();
      expect(gauge.getAttribute('aria-valuenow')).toBe('0');
      expect(gauge.hasAttribute('data-empty')).toBe(true);
    });

    it('keeps every drawn part away from a reader', () => {
      const { gauge } = render();
      expect(
        gauge.querySelector('.ui-gauge__track')?.getAttribute('aria-hidden'),
      ).toBe('true');
      expect(
        gauge.querySelector('ui-mark-scale')?.getAttribute('aria-hidden'),
      ).toBe('true');
      // Only spans (and custom elements): it must sit inside a button.
      expect(gauge.querySelector('div, p')).toBeNull();
    });
  });

  describe('linearCapacity', () => {
    it('fills to the value’s share of the range', () => {
      const { gauge, fixture, host } = render();
      expect(gauge.dataset['gaugeStyle']).toBe('linearCapacity');
      expect(gauge.style.getPropertyValue('--ui-gauge-value')).toBe('0.77');
      host.min.set(100);
      host.max.set(300);
      host.value.set(150);
      fixture.detectChanges();
      expect(gauge.style.getPropertyValue('--ui-gauge-value')).toBe('0.25');
    });

    it('cuts a notch at every threshold inside the bar, and names the labelled ones under it', () => {
      const { all } = render();
      expect(
        all('.ui-gauge__notch').map((n) =>
          n.style.getPropertyValue('--ui-gauge-mark'),
        ),
      ).toEqual(['0.3', '0.625']);
      expect(
        all('.ui-mark-scale__label').map((label) => label.textContent),
      ).toEqual(['120 т.', '250 т.', '400 т.']);
    });

    it('draws notches without words when the marks carry none, and no words at the small size', () => {
      const { all, fixture, host } = render((h) =>
        h.marks.set([
          { value: 120, label: null },
          { value: 250, label: null },
        ]),
      );
      expect(all('.ui-gauge__notch')).toHaveLength(2);
      expect(all('ui-mark-scale')).toHaveLength(0);
      host.marks.set([{ value: 120, label: '120 т.' }]);
      host.size.set('small');
      fixture.detectChanges();
      expect(all('.ui-gauge__notch')).toHaveLength(1);
      expect(all('ui-mark-scale')).toHaveLength(0);
    });
  });

  describe('discreteCapacity', () => {
    it('stamps whole slots, the reward last, laid out in rows of the owner’s columns', () => {
      const { gauge, all } = render(stampCard);
      expect(gauge.dataset['gaugeStyle']).toBe('discreteCapacity');
      expect(gauge.style.getPropertyValue('--ui-gauge-slots')).toBe('10');
      expect(gauge.style.getPropertyValue('--ui-gauge-columns')).toBe('5');
      const slots = all('.ui-gauge__slot');
      expect(slots).toHaveLength(10);
      expect(slots.filter((s) => s.hasAttribute('data-filled'))).toHaveLength(
        4,
      );
      expect(slots.map((s) => s.hasAttribute('data-reward'))).toEqual([
        ...Array(9).fill(false),
        true,
      ]);
      expect(
        slots[9]
          ?.querySelector('ui-icon.ui-gauge__reward')
          ?.getAttribute('data-name'),
      ).toBe('loyalty.reward');
    });

    it('fills only whole slots', () => {
      const { all } = render((h) => {
        stampCard(h);
        h.value.set(6.9);
      });
      expect(all('.ui-gauge__slot[data-filled]')).toHaveLength(6);
    });

    it('rings the reward alone at the small size, as dots', () => {
      const { gauge, all } = render((h) => {
        stampCard(h);
        h.size.set('small');
      });
      expect(gauge.dataset['controlSize']).toBe('small');
      expect(all('.ui-gauge__slot[data-reward]')).toHaveLength(1);
      expect(all('.ui-gauge__reward')).toHaveLength(0);
    });

    it('captions the slot a labelled mark fills', () => {
      const { all } = render((h) => {
        stampCard(h);
        h.marks.set([{ value: 10, label: 'Безплатно' }]);
      });
      const slots = all('.ui-gauge__slot');
      expect(
        slots[9]?.querySelector('.ui-gauge__slot-caption')?.textContent,
      ).toBe('Безплатно');
      expect(all('.ui-gauge__slot-caption')).toHaveLength(1);
    });

    it('draws a bar past twelve slots, and says why in development', () => {
      const warn = vi
        .spyOn(console, 'warn')
        .mockImplementation(() => undefined);
      const { gauge, all } = render((h) => {
        stampCard(h);
        h.max.set(20);
      });
      expect(gauge.dataset['gaugeStyle']).toBe('linearCapacity');
      expect(all('.ui-gauge__slot')).toHaveLength(0);
      expect(all('.ui-gauge__track')).toHaveLength(1);
      expect(warn).toHaveBeenCalledTimes(1);
    });

    it('lands only the stamps a live rise adds — none on the first frame', () => {
      const { all, fixture, host } = render(stampCard);
      expect(all('.ui-gauge__slot[data-punched]')).toHaveLength(0);
      host.value.set(6);
      fixture.detectChanges();
      const slots = all('.ui-gauge__slot');
      expect(
        slots
          .map((s, i) => (s.hasAttribute('data-punched') ? i : -1))
          .filter((i) => i >= 0),
      ).toEqual([4, 5]);
    });

    describe('the large card (2026-10-06: the wallet’s stamps, 44 across the card)', () => {
      const large = (host: Host) => {
        stampCard(host);
        host.size.set('large');
      };

      it('is a size the card has: no warning, the rung stamped on the host', () => {
        const warn = vi
          .spyOn(console, 'warn')
          .mockImplementation(() => undefined);
        const { gauge } = render(large);
        expect(gauge.dataset['controlSize']).toBe('large');
        expect(gauge.dataset['gaugeStyle']).toBe('discreteCapacity');
        expect(warn).not.toHaveBeenCalled();
      });

      it('checks every stamp, numbers every empty slot, and keeps the reward’s glyph', () => {
        const { all } = render(large);
        const slots = all('.ui-gauge__slot');
        expect(slots).toHaveLength(10);
        // 4 of 10: the first four are checked, 5 … 9 numbered, the tenth the reward.
        expect(
          slots.map((s) => s.querySelector('.ui-gauge__check') !== null),
        ).toEqual([
          true,
          true,
          true,
          true,
          false,
          false,
          false,
          false,
          false,
          false,
        ]);
        expect(
          slots.map(
            (s) => s.querySelector('.ui-gauge__numeral')?.textContent ?? null,
          ),
        ).toEqual([null, null, null, null, '5', '6', '7', '8', '9', null]);
        expect(
          slots[9]
            ?.querySelector('.ui-gauge__reward')
            ?.getAttribute('data-name'),
        ).toBe('loyalty.reward');
        // The check is a mark on the tint, never a word (the steps' own rule).
        expect(
          slots[0]
            ?.querySelector('.ui-gauge__check')
            ?.getAttribute('data-name'),
        ).toBe('checklist.done');
      });

      it('keeps the reward’s glyph when the card is complete, and prints no numeral or check on it', () => {
        const { all, host, fixture } = render(large);
        host.value.set(10);
        fixture.detectChanges();
        const slots = all('.ui-gauge__slot');
        expect(all('.ui-gauge__slot[data-filled]')).toHaveLength(10);
        expect(all('.ui-gauge__check')).toHaveLength(9);
        expect(all('.ui-gauge__numeral')).toHaveLength(0);
        expect(slots[9]?.querySelector('.ui-gauge__reward')).not.toBeNull();
      });

      it('numbers every slot when no reward is named', () => {
        const { all } = render((h) => {
          large(h);
          h.reward.set(null);
        });
        expect(all('.ui-gauge__numeral').map((n) => n.textContent)).toEqual([
          '5',
          '6',
          '7',
          '8',
          '9',
          '10',
        ]);
      });

      it('captions a labelled slot at the large rung too', () => {
        const { all } = render((h) => {
          large(h);
          h.marks.set([{ value: 10, label: 'Безплатно' }]);
        });
        expect(all('.ui-gauge__slot-caption')).toHaveLength(1);
      });

      it('leaves the regular and the small card as they were: no check, no numeral', () => {
        const { all, host, fixture } = render(stampCard);
        expect(all('.ui-gauge__check')).toHaveLength(0);
        expect(all('.ui-gauge__numeral')).toHaveLength(0);
        host.size.set('small');
        fixture.detectChanges();
        expect(all('.ui-gauge__check')).toHaveLength(0);
        expect(all('.ui-gauge__numeral')).toHaveLength(0);
      });
    });
  });

  describe('steps', () => {
    it('draws a node per mark in order, evenly — ranks, not distances', () => {
      const { gauge, all } = render(tierTrack);
      expect(gauge.dataset['gaugeStyle']).toBe('steps');
      expect(gauge.style.getPropertyValue('--ui-gauge-slots')).toBe('4');
      // The levels passed draw the check; the current one and those still
      // to come print their numerals.
      expect(all('.ui-gauge__node').map((n) => n.textContent)).toEqual([
        '',
        '',
        'III',
        'IV',
      ]);
      expect(
        all('.ui-gauge__node').map(
          (n) =>
            n
              .querySelector('ui-icon.ui-gauge__check')
              ?.getAttribute('data-name') ?? null,
        ),
      ).toEqual(['checklist.done', 'checklist.done', null, null]);
      expect(all('.ui-gauge__step-label').map((n) => n.textContent)).toEqual([
        'Бронз',
        'Сребро',
        'Злато',
        'Платина',
      ]);
    });

    it('fills the reached nodes, rings the current one and the next, leaves the rest', () => {
      const { all } = render(tierTrack);
      expect(all('.ui-gauge__step').map((s) => s.dataset['state'])).toEqual([
        'reached',
        'reached',
        'current',
        'next',
      ]);
    });

    it('checks every level passed, whatever it prints, and a completed ladder all the way to its last node', () => {
      const { all, fixture, host } = render(tierTrack);
      const drawn = () =>
        all('.ui-gauge__node').map((n) =>
          n.querySelector('.ui-gauge__check') ? '✓' : (n.textContent ?? ''),
        );
      host.value.set(20);
      fixture.detectChanges();
      // Every level earned: the last is the current one (still ringed), and
      // a finished track crowns with the check too (wave D r5).
      expect(all('.ui-gauge__step').map((s) => s.dataset['state'])).toEqual([
        'reached',
        'reached',
        'reached',
        'current',
      ]);
      expect(drawn()).toEqual(['✓', '✓', '✓', '✓']);
      // Nothing earned yet (under the first mark): no check anywhere.
      host.value.set(-1);
      fixture.detectChanges();
      expect(drawn()).toEqual(['I', 'II', 'III', 'IV']);
      expect(all('.ui-gauge__step').map((s) => s.dataset['state'])).toEqual([
        'next',
        'ahead',
        'ahead',
        'ahead',
      ]);
      // A blank track (a tier's nodes carry no numeral) checks its passed nodes too.
      host.value.set(14);
      host.marks.set(host.marks().map((mark) => ({ ...mark, short: null })));
      fixture.detectChanges();
      expect(drawn()).toEqual(['✓', '✓', '', '']);
    });

    it('lights earlier links whole and the link into the next node by the share covered', () => {
      const { all, fixture, host } = render(tierTrack);
      const links = () =>
        all('.ui-gauge__step').map((s) =>
          s.style.getPropertyValue('--ui-gauge-link'),
        );
      // (14 − 10) / (20 − 10)
      expect(links()).toEqual(['', '1', '1', '0.4']);
      host.value.set(5);
      fixture.detectChanges();
      // Сребро reached; (5 − 4) / (10 − 4) into Злато; nothing into Платина.
      expect(links()[2]).toBe(String(1 / 6));
      expect(links()[3]).toBe('0');
      expect(all('.ui-gauge__step').map((s) => s.dataset['state'])).toEqual([
        'reached',
        'current',
        'next',
        'ahead',
      ]);
    });

    it('writes at most two detail lines under a node', () => {
      const { all } = render(tierTrack);
      const details = (index: number) =>
        [
          ...(all('.ui-gauge__step')
            .at(index)
            ?.querySelectorAll('.ui-gauge__step-detail') ?? []),
        ].map((d) => d.textContent);
      expect(details(2)).toEqual(['3.06']);
      expect(details(3)).toEqual(['още 6', '+50 т.']);
    });

    it('draws bare nodes at the small size', () => {
      const { all } = render((h) => {
        tierTrack(h);
        h.size.set('small');
      });
      expect(all('.ui-gauge__node').map((n) => n.textContent)).toEqual([
        '',
        '',
        '',
        '',
      ]);
      // A 16 pt node has no room for the check: the fill alone says it.
      expect(all('.ui-gauge__check')).toHaveLength(0);
      expect(all('.ui-gauge__step-label')).toHaveLength(0);
      expect(all('.ui-gauge__step-detail')).toHaveLength(0);
    });
  });

  describe('circularCapacity', () => {
    it('is the same meter: a name, the owner’s reading, the bounds, the value clamped', () => {
      const { ring, fixture, host } = renderRing();
      expect(ring.dataset['gaugeStyle']).toBe('circularCapacity');
      expect(ring.getAttribute('role')).toBe('meter');
      expect(ring.getAttribute('aria-label')).toBe('Статус');
      expect(ring.getAttribute('aria-valuetext')).toBe(
        'Злато, 13 посещения за 12 месеца, още 7 до Платина',
      );
      expect(ring.getAttribute('aria-valuemin')).toBe('10');
      expect(ring.getAttribute('aria-valuemax')).toBe('20');
      expect(ring.getAttribute('aria-valuenow')).toBe('13');
      host.value.set(40);
      fixture.detectChanges();
      expect(ring.getAttribute('aria-valuenow')).toBe('20');
    });

    it('draws two circles — the track, then the arc over it — in one drawing a reader never meets', () => {
      const { ring, all } = renderRing();
      const drawings = all('svg');
      expect(drawings).toHaveLength(1);
      expect(drawings[0]?.getAttribute('class')).toBe('ui-gauge__ring');
      expect(drawings[0]?.getAttribute('aria-hidden')).toBe('true');
      expect(drawings[0]?.getAttribute('focusable')).toBe('false');
      // No viewBox: the geometry is the stylesheet's, in the page's points.
      expect(drawings[0]?.hasAttribute('viewBox')).toBe(false);
      expect(
        all('circle').map((circle) => circle.getAttribute('class')),
      ).toEqual(['ui-gauge__ring-track', 'ui-gauge__ring-arc']);
      for (const circle of all('circle')) {
        expect([circle.getAttribute('cx'), circle.getAttribute('cy')]).toEqual([
          '50%',
          '50%',
        ]);
        // The radius is the stylesheet's: none is written in the drawing.
        expect(circle.hasAttribute('r')).toBe(false);
      }
      // Nothing of the other styles is drawn, and it still sits in a button.
      expect(
        all('.ui-gauge__track, .ui-gauge__slots, .ui-gauge__steps'),
      ).toHaveLength(0);
      expect(ring.querySelector('div, p')).toBeNull();
    });

    it('fills by the value’s share of the range, from the last threshold to the next', () => {
      const { ring, fixture, host } = renderRing();
      // (13 − 10) / (20 − 10)
      expect(ring.style.getPropertyValue('--ui-gauge-value')).toBe('0.3');
      // «Фейд» at 23, II = 10 and III = 25: 87 %.
      host.min.set(10);
      host.max.set(25);
      host.value.set(23);
      fixture.detectChanges();
      expect(
        Number(ring.style.getPropertyValue('--ui-gauge-value')),
      ).toBeCloseTo(13 / 15, 10);
      // A ring has no slots and no columns.
      expect(ring.style.getPropertyValue('--ui-gauge-slots')).toBe('');
      expect(ring.style.getPropertyValue('--ui-gauge-columns')).toBe('');
    });

    it.each(['regular', 'large', 'extraLarge'] as const)(
      'stamps the %s size it was asked for',
      (size) => {
        const warn = vi
          .spyOn(console, 'warn')
          .mockImplementation(() => undefined);
        const { ring } = renderRing((h) => h.size.set(size));
        expect(ring.dataset['controlSize']).toBe(size);
        expect(warn).not.toHaveBeenCalled();
      },
    );

    it('has no small ring: it draws the regular one, and says why in development', () => {
      const warn = vi
        .spyOn(console, 'warn')
        .mockImplementation(() => undefined);
      const { ring } = renderRing((h) => h.size.set('small'));
      expect(ring.dataset['controlSize']).toBe('regular');
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0]?.[0])).toContain(
        'circularCapacity has no "small" size',
      );
    });

    it('keeps extraLarge to the ring and large to the ring and the card: a bar and the steps draw regular', () => {
      const warn = vi
        .spyOn(console, 'warn')
        .mockImplementation(() => undefined);
      const { gauge, all, fixture, host } = render((h) =>
        h.size.set('extraLarge'),
      );
      expect(gauge.dataset['controlSize']).toBe('regular');
      // …WHOLE: the words under the bar are the regular bar's.
      expect(all('ui-mark-scale')).toHaveLength(1);
      expect(warn).toHaveBeenCalledTimes(1);
      tierTrack(host);
      host.size.set('large');
      fixture.detectChanges();
      expect(gauge.dataset['controlSize']).toBe('regular');
      expect(all('.ui-gauge__step-label')).toHaveLength(4);
      expect(all('.ui-gauge__check')).toHaveLength(2);
      // The card HAS a large rung (the wallet's stamps, 2026-10-06)…
      stampCard(host);
      fixture.detectChanges();
      expect(gauge.dataset['controlSize']).toBe('large');
      expect(all('.ui-gauge__reward')).toHaveLength(1);
      // …and nothing past it.
      host.size.set('extraLarge');
      fixture.detectChanges();
      expect(gauge.dataset['controlSize']).toBe('regular');
      // Once per gauge, however often it is asked.
      expect(warn).toHaveBeenCalledTimes(1);
    });

    it('draws the track alone at zero — the arc stays in the drawing, so a rise can glide', () => {
      const { ring, all, fixture, host } = renderRing((h) => h.value.set(10));
      expect(ring.hasAttribute('data-empty')).toBe(true);
      expect(ring.style.getPropertyValue('--ui-gauge-value')).toBe('0');
      expect(all('.ui-gauge__ring-arc')).toHaveLength(1);
      host.value.set(11);
      fixture.detectChanges();
      expect(ring.hasAttribute('data-empty')).toBe(false);
      expect(ring.dataset['direction']).toBe('up');
    });

    it('is complete at the end of the range, and only there', () => {
      const { ring, fixture, host } = renderRing((h) => h.value.set(19.9));
      expect(ring.hasAttribute('data-complete')).toBe(false);
      host.value.set(20);
      fixture.detectChanges();
      expect(ring.hasAttribute('data-complete')).toBe(true);
      expect(ring.style.getPropertyValue('--ui-gauge-value')).toBe('1');
    });

    it('leaves the extent to its composer: `data-extent` is neither stamped nor cleared by the gauge', () => {
      const { ring, all, fixture, host } = renderRing();
      expect(ring.hasAttribute('data-extent')).toBe(false);
      host.extent.set('dashed');
      host.value.set(10);
      fixture.detectChanges();
      expect(ring.dataset['extent']).toBe('dashed');
      // The drawing is the same two circles: the stylesheet draws the form.
      expect(all('circle')).toHaveLength(2);
      host.value.set(14);
      fixture.detectChanges();
      expect(ring.dataset['extent']).toBe('dashed');
    });

    it.each([
      // size, dashes, the ring's diameter
      ['regular', 31, 52],
      ['large', 38, 64],
      ['extraLarge', 79, 128],
    ] as const)(
      'closes a dashed %s ring on a whole dash: the track is %i dashes of five units long',
      (size, dashes, diameter) => {
        const { all } = renderRing((h) => h.size.set(size));
        const track = all('.ui-gauge__ring-track')[0];
        expect(track?.getAttribute('pathLength')).toBe(String(dashes * 5));
        // The dashed line is the regular ring's three points on the box's
        // outer edge: its length in points, a dash within 2 % of five.
        const period = (Math.PI * (diameter - 3)) / dashes;
        expect(Math.abs(period - 5) / 5).toBeLessThan(0.02);
        // The arc is measured in points: it takes no path length.
        expect(all('.ui-gauge__ring-arc')[0]?.hasAttribute('pathLength')).toBe(
          false,
        );
      },
    );

    it('stands ONE figure in the centre, away from a reader, and projects nothing else', () => {
      const { ring, all, fixture, host } = renderRing();
      const centre = all('.ui-gauge__current');
      expect(centre).toHaveLength(1);
      expect(centre[0]?.tagName).toBe('SPAN');
      expect(centre[0]?.getAttribute('aria-hidden')).toBe('true');
      expect(centre[0]?.textContent?.trim()).toBe('7');
      expect(centre[0]?.querySelector('[data-testid="figure"]')).not.toBeNull();
      // What is not the centre's label is not drawn anywhere.
      expect(ring.querySelector('[data-testid="stray"]')).toBeNull();
      expect(ring.textContent?.trim()).toBe('7');
      // A ring round a disc has no figure: the centre is the composer's disc.
      host.figure.set(null);
      fixture.detectChanges();
      expect(ring.textContent?.trim()).toBe('');
    });

    it('draws no centre on a bar, a card or the steps', () => {
      TestBed.configureTestingModule({ imports: [UiGauge] });
      @Component({
        imports: [UiGauge],
        template: `
          <ui-gauge
            [uiValue]="0.4"
            uiLabel="Фейд"
            uiValueText="2 от 5"
            data-testid="bar"
          >
            <span uiCurrentValueLabel>2</span>
          </ui-gauge>
        `,
      })
      class BarHost {}
      const fixture = TestBed.createComponent(BarHost);
      fixture.detectChanges();
      const bar = fixture.nativeElement.querySelector(
        '[data-testid="bar"]',
      ) as HTMLElement;
      expect(bar.querySelector('.ui-gauge__current')).toBeNull();
      expect(bar.textContent?.trim()).toBe('');
    });

    it('takes no marks: no notch, no words, no node', () => {
      const { all } = renderRing((h) =>
        h.marks.set([
          { value: 12, label: '12' },
          { value: 15, label: '15', short: 'II' },
        ]),
      );
      expect(
        all(
          '.ui-gauge__notch, ui-mark-scale, .ui-gauge__step, .ui-gauge__slot',
        ),
      ).toHaveLength(0);
      expect(all('circle')).toHaveLength(2);
    });
  });

  describe('motion', () => {
    it('moves nothing on the first frame, and marks a live rise so it can glide', () => {
      const { gauge, fixture, host } = render();
      expect(gauge.hasAttribute('data-settled')).toBe(true);
      expect(gauge.hasAttribute('data-direction')).toBe(false);
      host.value.set(350);
      fixture.detectChanges();
      expect(gauge.dataset['direction']).toBe('up');
      host.value.set(100);
      fixture.detectChanges();
      // A fall swaps.
      expect(gauge.hasAttribute('data-direction')).toBe(false);
    });

    it('marks a completed card starting again', () => {
      const { gauge, fixture, host } = render((h) => {
        stampCard(h);
        h.value.set(10);
      });
      host.value.set(0);
      fixture.detectChanges();
      expect(gauge.dataset['direction']).toBe('reset');
    });
  });

  describe('the stylesheet', () => {
    it('tints with the accent every meter fills with, on the control fill', () => {
      const root = /\.ui-gauge\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
      expect(root).toContain('--ui-gauge-tint: var(--sys-color-accent);');
      // Colour is a shape, words are ink (revision 3): a numeral on the
      // tint's wash reads in the primary ink; its ring carries the colour.
      expect(root).toContain('--ui-gauge-ink: var(--sys-color-foreground);');
      expect(root).toContain('--ui-gauge-track: var(--sys-color-fill);');
      expect(root).toContain(
        '--ui-gauge-rim: var(--sys-color-secondary-label);',
      );
    });

    it('reads neither of the retired label inks — the one orange is a fill, a ring, a glyph', () => {
      const read = css.replace(/\/\*[\s\S]*?\*\//g, '');
      expect(read).not.toContain('--sys-color-accent-label');
      expect(read).not.toContain('--sys-color-promo-label');
    });

    it.each(['light', 'dark'] as const)(
      'draws what is still ahead in an ink ≥ 3:1 on the surface and the muted card — %s',
      (theme) => {
        // The fill alone was 1.06–1.08:1 (1.21 in dark): 23/24 read as full.
        const rim = themeHex(theme, '--sys-color-secondary-label');
        for (const ground of [
          '--sys-color-surface',
          '--sys-color-surface-secondary',
        ]) {
          expect(contrast(rim, themeHex(theme, ground))).toBeGreaterThanOrEqual(
            3,
          );
        }
      },
    );

    it('rings the track, the empty slot and a node not yet earned in that one ink', () => {
      const ring =
        'box-shadow: inset 0 0 0 var(--sys-stroke-mark) var(--ui-gauge-rim)';
      expect(ruleBody('.ui-gauge__track')).toContain(ring);
      expect(
        ruleBody(
          ".ui-gauge__step:is([data-state='next'], [data-state='ahead']) .ui-gauge__node",
        ),
      ).toContain(ring);
      // The empty slot's ring is the same ink, spelt as the token.
      expect(ruleBody('.ui-gauge__disc')).toContain(
        'box-shadow: inset 0 0 0 var(--sys-stroke-mark) var(--sys-color-secondary-label)',
      );
    });

    describe('the step states, strongest first (wave D r4: r3’s wash drew earned levels fainter than the next)', () => {
      const reached =
        ".ui-gauge__step:is([data-state='reached'], [data-state='current']) .ui-gauge__node";
      const currentNumeral =
        ".ui-gauge__step[data-state='current'] .ui-gauge__node[data-numeral]";
      const notYet =
        ".ui-gauge__step:is([data-state='next'], [data-state='ahead']) .ui-gauge__node";
      const next = ".ui-gauge__step[data-state='next'] .ui-gauge__node";
      const current = ".ui-gauge__step[data-state='current'] .ui-gauge__node";

      /** `top` at `alpha` over an opaque `under`, as the browser flattens a wash. */
      function over(top: string, alpha: number, under: string): string {
        const channel = (hex: string, i: number) =>
          parseInt(hex.slice(i, i + 2), 16);
        return `#${[1, 3, 5]
          .map((i) =>
            Math.round(
              channel(top, i) * alpha + channel(under, i) * (1 - alpha),
            )
              .toString(16)
              .padStart(2, '0'),
          )
          .join('')}`;
      }

      /** Every rule (comments dropped) as `[selector, body]`. */
      function rules(): [string, string][] {
        const flat = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, ' ');
        return [...flat.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(
          ([, selector, body]) => [selector?.trim() ?? '', body ?? ''],
        );
      }

      /** The selectors of the rules whose body names `value`. */
      function selectorsUsing(value: string): string[] {
        return rules()
          .filter(([, body]) => body.includes(value))
          .map(([selector]) => selector);
      }

      it('fills every reached node — the current one too — with the solid tint, as the lit links', () => {
        expect(ruleBody(reached)).toBe(
          ' background-color: var(--ui-gauge-tint); ',
        );
        // Only the CURRENT node's numeral takes the wash; a level passed never does.
        const numeral = ruleBody(currentNumeral);
        expect(numeral).toContain(
          'background-color: color-mix( in srgb, var(--ui-gauge-tint) var(--sys-alpha-tint), transparent );',
        );
        expect(numeral).toContain('color: var(--ui-gauge-ink);');
        expect(selectorsUsing('var(--sys-alpha-tint)')).toEqual([
          currentNumeral,
        ]);
      });

      it('sets no word on the solid tint: a level passed draws the check in the on-accent ink, on the icon ladder', () => {
        expect(ruleBody('.ui-gauge__check')).toBe(
          ' font-size: var(--ui-icon-small); color: var(--sys-color-on-accent); ',
        );
        // The on-accent white inks marks only — a filled slot's reward glyph
        // and the check — never type.
        expect(selectorsUsing('var(--sys-color-on-accent)')).toEqual([
          '.ui-gauge__slot[data-filled] .ui-gauge__disc',
          '.ui-gauge__check',
        ]);
      });

      it.each(['light', 'dark'] as const)(
        'draws a reached node ≥ 3:1 on the page and the card, and its check ≥ 3:1 on the tint — %s',
        (theme) => {
          const accent = themeHex(theme, '--sys-color-accent');
          for (const ground of [
            '--sys-color-background',
            '--sys-color-surface',
          ]) {
            expect(
              contrast(accent, themeHex(theme, ground)),
            ).toBeGreaterThanOrEqual(3);
          }
          // On the light muted card the fill's edge is 2.84:1: there the
          // check (a graphic) carries the state by form.
          expect(
            contrast(themeHex(theme, '--sys-color-on-accent'), accent),
          ).toBeGreaterThanOrEqual(3);
          // …and it is a MARK: the same white as type failed AA (axe, r3).
          expect(
            contrast(themeHex(theme, '--sys-color-on-accent'), accent),
          ).toBeLessThan(4.5);
        },
      );

      it('rings only the current node in the tint; what is not yet earned wears the extent’s ink, the next numeral the primary', () => {
        // Accent strokes mark what is earned: of the node rules, only the
        // current one strokes with the tint (its border); no node's ring
        // (box-shadow) is ever the tint.
        const nodeRules = rules().filter(([selector]) =>
          selector.includes('.ui-gauge__node'),
        );
        expect(
          nodeRules
            .filter(([, body]) =>
              /(^|[ ;])border:[^;]*var\(--ui-gauge-tint\)/.test(body),
            )
            .map(([selector]) => selector),
        ).toEqual([current]);
        expect(
          nodeRules.filter(([, body]) =>
            /box-shadow:[^;]*var\(--ui-gauge-tint\)/.test(body),
          ),
        ).toEqual([]);
        // Not yet earned: the rim at the mark stroke, never the tint, and
        // never a ring as heavy as the current one's (a dark 2 pt ring
        // beside it read as a second «you are here»).
        expect(ruleBody(notYet)).toBe(
          ' box-shadow: inset 0 0 0 var(--sys-stroke-mark) var(--ui-gauge-rim); ',
        );
        // The next node only lifts its numeral to the primary ink…
        expect(ruleBody(next)).toBe(' color: var(--sys-color-foreground); ');
        // …while one still ahead keeps the node's own secondary ink made for a fill.
        expect(ruleBody('.ui-gauge__node')).toContain(
          'color: var(--sys-color-secondary-label-on-fill);',
        );
      });

      it('never ends a finished track on the in-progress face: no node of a complete ladder is lighter than a reached one', () => {
        // Wave D r5: «Всички нива» ✓✓✓✓ then V on the wash, and an ended
        // season cut to ✓✓ then III — the crowning level the faintest
        // filled node, a muddy disc in dark. Where the current node is the
        // last, nothing is under way: it is drawn passed, inside its ring.
        const { all, fixture, host } = render(tierTrack);
        const faces = () =>
          all('.ui-gauge__step').map((step) => {
            const node = step.querySelector('.ui-gauge__node') as HTMLElement;
            return {
              state: step.dataset['state'],
              check: !!node.querySelector('ui-icon.ui-gauge__check'),
              numeral: node.hasAttribute('data-numeral'),
              // The wash's own selector: only a node that matches it is washed.
              washed: node.matches(currentNumeral),
              solid: node.matches(reached),
            };
          });
        for (const [label, setup] of [
          // Every level reached.
          ['complete', () => host.value.set(20)],
          // An ended scope, cut to the levels it reached (achievements.presenter).
          ['ended', () => host.marks.set(host.marks().slice(0, 3))],
        ] as const) {
          setup();
          fixture.detectChanges();
          const drawnFaces = faces();
          expect([label, drawnFaces.at(-1)?.state]).toEqual([label, 'current']);
          for (const face of drawnFaces) {
            // Every node is the solid tint with the check: none is washed,
            // none prints the in-progress numeral.
            expect([label, face]).toEqual([
              label,
              {
                state: face.state,
                check: true,
                numeral: false,
                washed: false,
                solid: true,
              },
            ]);
          }
        }
        // A ladder still under way keeps its «you are here» numeral on the wash.
        host.marks.set([
          { value: 0, label: 'Бронз', short: 'I' },
          { value: 4, label: 'Сребро', short: 'II' },
          { value: 10, label: 'Злато', short: 'III' },
          { value: 20, label: 'Платина', short: 'IV' },
        ]);
        host.value.set(14);
        fixture.detectChanges();
        expect(faces()[2]).toEqual({
          state: 'current',
          check: false,
          numeral: true,
          washed: true,
          solid: true,
        });
      });

      it('marks the nodes that print a numeral, and only those', () => {
        const { all, fixture, host } = render(tierTrack);
        // Levels passed print none (the check stands for them).
        expect(
          all('.ui-gauge__node').map((node) =>
            node.hasAttribute('data-numeral'),
          ),
        ).toEqual([false, false, true, true]);
        // The small track's bare nodes keep the solid tint.
        host.size.set('small');
        fixture.detectChanges();
        expect(
          all('.ui-gauge__node').some((node) =>
            node.hasAttribute('data-numeral'),
          ),
        ).toBe(false);
      });

      it.each(['light', 'dark'] as const)(
        'reads the current numeral at AA on its wash over the page, the card and the muted card — %s',
        (theme) => {
          const alpha =
            Number(/--sys-alpha-tint:\s*([\d.]+)%;/.exec(tokens)?.[1]) / 100;
          expect(alpha).toBeGreaterThan(0);
          const accent = themeHex(theme, '--sys-color-accent');
          // The primary ink (§1.3 T1): the law asks 4.6 of it on every wash.
          const ink = themeHex(theme, '--sys-color-foreground');
          for (const ground of [
            '--sys-color-background',
            '--sys-color-surface',
            '--sys-color-surface-secondary',
          ]) {
            expect(
              contrast(ink, over(accent, alpha, themeHex(theme, ground))),
            ).toBeGreaterThanOrEqual(4.6);
          }
        },
      );

      it('draws the current node’s ring inside its own box, so an end node never hangs past the column', () => {
        const ring = ruleBody(current);
        expect(ring).toContain(
          'border: var(--sys-stroke-emphasis) solid var(--ui-gauge-tint);',
        );
        expect(ring).toContain('padding: var(--ui-gauge-ring-gap);');
        // The gap is the real ground: the fill stops short of the ring.
        expect(ring).toContain('background-clip: content-box;');
        expect(ruleBody('.ui-gauge__node')).toContain(
          'box-sizing: border-box;',
        );
        expect(ruleBody('.ui-gauge__steps')).toContain(
          '--ui-gauge-ring-gap: var(--sys-stroke-emphasis);',
        );
        // Nothing is drawn outside a node's box, so no room is kept for it.
        const flat = css.replace(/\/\*[\s\S]*?\*\//g, '');
        expect(flat).not.toMatch(/outline/);
        expect(ruleBody('.ui-gauge__steps')).not.toContain('padding');
        // The fills never reset the clip (a `background` shorthand would).
        expect(ruleBody(reached)).not.toMatch(/(^|[ ;])background:/);
        expect(ruleBody(currentNumeral)).not.toMatch(/(^|[ ;])background:/);
      });
    });

    it('never draws a meter full before it is: a tight rung of track stays while value < max', () => {
      const notFull = ruleBody(
        '.ui-gauge:not([data-complete]) .ui-gauge__fill',
      );
      expect(notFull).toContain(
        'max( calc((1 - var(--ui-gauge-value, 0)) * 100%), var(--sys-space-tight) )',
      );
    });

    describe('the reward never drops its glyph (wave D r4: at 330 an ≈ 18 pt slot hid it)', () => {
      const reward =
        ".ui-gauge[data-control-size='regular'] .ui-gauge__slot[data-reward] .ui-gauge__disc";

      it('draws the glyph on the icon ladder, never a share of the slot', () => {
        // `66cqi` once minted 14.5 in a 22 pt slot.
        expect(ruleBody('.ui-gauge__reward')).toBe(
          ' font-size: var(--ui-icon-small); ',
        );
        // Nothing hides it any more: no container condition, no container.
        expect(css).not.toMatch(/@container/);
        expect(ruleBody('.ui-gauge__disc')).not.toContain('container-type');
      });

      it('keeps the reward disc alone on the 20 rung, centred on the row, however narrow the slots', () => {
        const body = ruleBody(reward);
        expect(body).toContain(
          'inline-size: max(100%, var(--ui-icon-medium));',
        );
        expect(body).toContain(
          'margin-block: min(0px, calc((100% - var(--ui-icon-medium)) / 2));',
        );
        // The small card keeps its own reward (half again a dot) and no margins.
        expect(
          ruleBody(
            ".ui-gauge[data-control-size='small'] .ui-gauge__slot[data-reward] .ui-gauge__disc",
          ),
        ).toBe(' inline-size: calc(var(--sys-size-dot) * 1.5); ');
      });

      it('renders the glyph in the reward slot alone at the regular size — the 330 half tile included', () => {
        // Geometry is the browser's (jsdom lays nothing out): at 330 the
        // live glance measures slots ≈ 18 and the reward 20 with its glyph
        // (wave D r4 fix capture). Here: the glyph is never conditional.
        const { all } = render(stampCard);
        const slots = all('.ui-gauge__slot');
        expect(slots[9]?.querySelector('.ui-gauge__reward')).not.toBeNull();
        expect(
          slots.slice(0, 9).some((s) => s.querySelector('.ui-gauge__reward')),
        ).toBe(false);
      });
    });

    it('sets the first and last step nodes on the content edges, the words clamped there', () => {
      const steps = ruleBody('.ui-gauge__steps');
      expect(steps).toContain('display: flex;');
      expect(steps).toContain('justify-content: space-between;');
      expect(steps).toContain('container-type: inline-size;');
      expect(steps).toContain(
        '--ui-gauge-pitch: calc( (100cqi - var(--ui-gauge-node)) / max(var(--ui-gauge-slots, 1) - 1, 1) );',
      );
      const step = ruleBody('.ui-gauge__step');
      expect(step).toContain('inline-size: var(--ui-gauge-node);');
      expect(step).toContain('flex: none;');
      expect(ruleBody('.ui-gauge__step:first-child')).toContain(
        'align-items: flex-start;',
      );
      expect(ruleBody('.ui-gauge__step:last-child')).toContain(
        'align-items: flex-end;',
      );
      // The link into a node runs from the previous node's edge, a pitch back.
      expect(
        ruleBody(
          '.ui-gauge__step:not(:first-child)::before, .ui-gauge__step:not(:first-child)::after',
        ),
      ).toContain(
        'inset-inline-start: calc( var(--ui-gauge-node) + var(--ui-gauge-link-gap) - var(--ui-gauge-pitch) );',
      );
      expect(
        ruleBody('.ui-gauge__step-label, .ui-gauge__step-detail'),
      ).toContain(
        'max-inline-size: var(--ui-gauge-words, var(--ui-gauge-pitch));',
      );
    });

    it('shrinks a narrow card’s gaps with its slots — a third of one — and keeps the full card’s 8 pt', () => {
      const slots = (/\.ui-gauge__slots\s*\{([^}]*)\}/.exec(css)?.[1] ?? '')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\s+/g, ' ');
      expect(slots).toContain(
        'minmax(var(--sys-size-dot), calc(var(--sys-space-unit) * 6))',
      );
      expect(slots).toContain(
        'column-gap: min( var(--sys-space-compact), calc(100% / (4 * var(--ui-gauge-columns, var(--ui-gauge-slots, 1)) - 1)) );',
      );
    });

    describe('the large card (2026-10-06: 24 pt dots at a 32 pitch sat in the leading third of the wallet’s 355 card)', () => {
      it('stamps at the regular control’s 44, spread edge to edge, in rows a regular rung apart', () => {
        const slots = ruleBody(
          ".ui-gauge[data-control-size='large'] .ui-gauge__slots",
        );
        expect(slots).toContain(
          'grid-template-columns: repeat( var(--ui-gauge-columns, var(--ui-gauge-slots, 1)), minmax(0, var(--control-size-regular)) );',
        );
        expect(slots).toContain('justify-content: space-between;');
        expect(slots).toContain(
          'gap: var(--sys-space-regular) var(--sys-space-tight);',
        );
        // A 44 stamp is the ticket's disc: the regular control, 11 units.
        expect(tokenPoints('--control-size-regular')).toBe(44);
      });

      it('draws the check and the reward’s glyph at the 24 rung, the ordinal in the secondary ink', () => {
        expect(
          ruleBody(
            ".ui-gauge[data-control-size='large'] .ui-gauge__slot .ui-gauge__check, .ui-gauge[data-control-size='large'] .ui-gauge__reward",
          ),
        ).toBe(' font-size: var(--ui-icon-large); ');
        const numeral = ruleBody('.ui-gauge__numeral');
        expect(numeral).toContain('font: var(--sys-font-callout);');
        expect(numeral).toContain('font-variant-numeric: tabular-nums;');
        expect(numeral).toContain('color: var(--sys-color-secondary-label);');
        // The check stays the on-accent mark the steps draw: no second ink.
        expect(ruleBody('.ui-gauge__check')).toContain(
          'color: var(--sys-color-on-accent);',
        );
      });
    });

    it('never cuts a step’s caption inside the word: the ends reach a whole pitch inward, and no caption breaks anywhere', () => {
      // 2026-10-06: at 330 the status card's «Платина» (50 pt) broke as
      // «Платин / а» in the half-pitch box (49) the ends were clamped to.
      expect(ruleBody('.ui-gauge__step:first-child')).not.toContain(
        '--ui-gauge-words',
      );
      expect(ruleBody('.ui-gauge__step:last-child')).not.toContain(
        '--ui-gauge-words',
      );
      expect(ruleBody('.ui-gauge__step-label')).toContain(
        'overflow-wrap: normal;',
      );
      expect(ruleBody('.ui-gauge__step-label')).not.toContain('anywhere');
      // A word wider than the cap widens its box instead of spilling past
      // it (the ends are anchored on the content edge, so the last caption
      // hangs INWARD over its link, never into the card's padding: at 167
      // «Платина», 51, hung 3 pt past the edge in a 48 box).
      expect(ruleBody('.ui-gauge__step-label')).toContain(
        'min-inline-size: min-content;',
      );
      // The cap is the pitch for every step; the hook stays for an owner.
      expect(
        ruleBody('.ui-gauge__step-label, .ui-gauge__step-detail'),
      ).toContain(
        'max-inline-size: var(--ui-gauge-words, var(--ui-gauge-pitch));',
      );
    });

    describe('the ring (revision 3, §3.7)', () => {
      const ring = ".ui-gauge[data-gauge-style='circularCapacity']";
      const sized = (size: string) => `${ring}[data-control-size='${size}']`;
      const dashedTrack =
        ".ui-gauge[data-extent='dashed'] .ui-gauge__ring-track";

      it.each([
        // size, the rule, the disc it names, outer, stroke, gap
        ['regular', ring, '--control-size-regular', 44, 52, 3, 1],
        ['large', sized('large'), '--control-size-large', 52, 64, 4, 2],
        [
          'extraLarge',
          sized('extraLarge'),
          '--control-size-extraLarge',
          112,
          128,
          6,
          2,
        ],
      ] as const)(
        'names the disc it wraps — %s: the disc and a rim each side',
        (_size, selector, discToken, disc, outer, stroke, gap) => {
          const body = ruleBody(selector);
          // The box is said FROM the disc's own token, so the two never part.
          expect(declared(body, '--ui-gauge-diameter')).toContain(
            `var(${discToken})`,
          );
          expect(tokenPoints(discToken)).toBe(disc);
          expect(points(declared(body, '--ui-gauge-diameter'))).toBe(outer);
          expect(points(declared(body, '--ui-gauge-stroke'))).toBe(stroke);
          expect((outer - disc) / 2 - stroke).toBe(gap);
        },
      );

      it('weighs the stroke as an arc, never a border: 4.5 % of the diameter or more', () => {
        // At 2 / 3 / 5 (3.8 %, 4.7 %, 3.9 %) the arc read as the thin rim the
        // rejected build wore (DV-H).
        for (const [selector, floor] of [
          [ring, 0.055],
          [sized('large'), 0.06],
          [sized('extraLarge'), 0.045],
        ] as const) {
          const body = ruleBody(selector);
          const share =
            points(declared(body, '--ui-gauge-stroke')) /
            points(declared(body, '--ui-gauge-diameter'));
          expect(share).toBeGreaterThanOrEqual(floor);
          expect(share).toBeLessThan(0.08);
        }
      });

      it('is a box of its diameter that nothing stretches or squeezes', () => {
        const body = ruleBody(ring);
        expect(body).toContain('display: inline-grid;');
        expect(body).toContain('flex: none;');
        expect(body).toContain('inline-size: var(--ui-gauge-diameter);');
        expect(body).toContain('block-size: var(--ui-gauge-diameter);');
        // One cell, so the drawing and the centre share the box.
        expect(body).toContain(
          'grid-template: minmax(0, 1fr) / minmax(0, 1fr);',
        );
        expect(body).toContain('place-items: center;');
        // It paints in source order: a composer's disc or rim chip, written
        // after the ring, stands over it. So it is never positioned, never
        // a layer.
        expect(body).not.toMatch(
          /(^|[ ;])(position|z-index|isolation|opacity|transform):/,
        );
        // The sizes change the two properties and nothing else.
        for (const size of ['large', 'extraLarge']) {
          expect(
            ruleBody(sized(size))
              .split(';')
              .map((declaration) => declaration.split(':')[0]?.trim())
              .filter(Boolean),
          ).toEqual(['--ui-gauge-diameter', '--ui-gauge-stroke']);
        }
      });

      it('lays the drawing out in the page’s points, from 12 o’clock', () => {
        const drawing = ruleBody('.ui-gauge__ring');
        // Never a percentage: an svg with no definite height is 150 tall and
        // drew the ring under its own box.
        expect(drawing).toContain('inline-size: var(--ui-gauge-diameter);');
        expect(drawing).toContain('block-size: var(--ui-gauge-diameter);');
        expect(drawing).not.toContain('%');
        expect(drawing).toContain('rotate: -90deg;');
        expect(drawing).toContain('grid-area: 1 / 1;');
        const circles = ruleBody('.ui-gauge__ring-track, .ui-gauge__ring-arc');
        expect(circles).toContain(
          'r: calc((var(--ui-gauge-diameter) - var(--ui-gauge-stroke)) / 2);',
        );
        expect(circles).toContain('stroke-width: var(--ui-gauge-stroke);');
        expect(circles).toContain('fill: none;');
      });

      it('draws a quiet track an owner may re-ink, and the arc in the tint with round caps', () => {
        expect(ownRuleBody('.ui-gauge__ring-track')).toBe(
          ' stroke: var(--ui-gauge-track-ring, var(--sys-color-separator)); ',
        );
        const arc = ownRuleBody('.ui-gauge__ring-arc');
        expect(arc).toContain('stroke: var(--ui-gauge-tint);');
        expect(arc).toContain('stroke-linecap: round;');
        expect(arc).toContain(
          '--ui-gauge-circumference: calc( 3.14159265 * (var(--ui-gauge-diameter) - var(--ui-gauge-stroke)) );',
        );
        expect(arc).toContain(
          'stroke-dasharray: calc( var(--ui-gauge-value, 0) * var(--ui-gauge-circumference) ) var(--ui-gauge-circumference);',
        );
      });

      it('never draws a ring full before it is: a stroke of track stays between the caps', () => {
        const notFull = ruleBody(
          '.ui-gauge:not([data-complete]) .ui-gauge__ring-arc',
        );
        expect(notFull).toContain(
          'stroke-dasharray: min( calc(var(--ui-gauge-value, 0) * var(--ui-gauge-circumference)), calc(var(--ui-gauge-circumference) - 2 * var(--ui-gauge-stroke)) ) var(--ui-gauge-circumference);',
        );
        // The caps reach half a stroke past either end: what the eye sees
        // left of the ring at 24/25 is at least a stroke wide, at every size.
        for (const [diameter, stroke] of [
          [52, 3],
          [64, 4],
          [64, 5],
          [128, 6],
        ] as const) {
          const circumference = Math.PI * (diameter - stroke);
          const arc = Math.min(
            0.99 * circumference,
            circumference - 2 * stroke,
          );
          expect(circumference - arc - stroke).toBeGreaterThanOrEqual(
            stroke - 1e-9,
          );
        }
      });

      it('draws no dot at 12 o’clock for a zero value — hidden, never removed', () => {
        expect(ruleBody('.ui-gauge[data-empty] .ui-gauge__ring-arc')).toBe(
          ' opacity: 0; ',
        );
      });

      it('draws a family not started as the track alone, dashed 2 on 3 off, in the extent’s ink', () => {
        const track = ruleBody(dashedTrack);
        expect(track).toContain('stroke: var(--ui-gauge-rim);');
        expect(track).toContain('stroke-dasharray: 2 3;');
        expect(track).not.toContain('var(--ui-gauge-tint)');
        expect(
          ruleBody(".ui-gauge[data-extent='dashed'] .ui-gauge__ring-arc"),
        ).toBe(' display: none; ');
      });

      it('keeps the dashed line the regular ring’s at every size, on the box’s outer edge', () => {
        // The extent's ink is ≥ 3:1: at the large ring's 4 and the hero's 6
        // the dashes drew a cog that outweighed every ring begun.
        const track = ruleBody(dashedTrack);
        expect(track).toContain(
          '--ui-gauge-dash-stroke: min( var(--ui-gauge-stroke), calc(var(--sys-space-unit) * 0.75) );',
        );
        expect(track).toContain('stroke-width: var(--ui-gauge-dash-stroke);');
        expect(track).toContain(
          'r: calc((var(--ui-gauge-diameter) - var(--ui-gauge-dash-stroke)) / 2);',
        );
        expect(points(declared(ruleBody(ring), '--ui-gauge-stroke'))).toBe(3);
      });

      it.each(['light', 'dark'] as const)(
        'draws the arc and the dashes ≥ 3:1 on the page and the card — %s',
        (theme) => {
          for (const ground of [
            '--sys-color-background',
            '--sys-color-surface',
          ]) {
            for (const ink of [
              '--sys-color-accent',
              '--sys-color-secondary-label',
            ]) {
              expect(
                contrast(themeHex(theme, ink), themeHex(theme, ground)),
              ).toBeGreaterThanOrEqual(3);
            }
          }
        },
      );

      it('sets the centre in ONE role — the headline, tabular, primary ink — whatever is projected', () => {
        const centre = ruleBody('.ui-gauge__current');
        expect(centre).toContain('font: var(--sys-font-headline);');
        expect(centre).toContain('color: var(--sys-color-foreground);');
        expect(centre).toContain('grid-area: 1 / 1;');
        // The shorthand resets the figures: tabular is said again AFTER it.
        expect(
          centre.indexOf('font-variant-numeric: tabular-nums;'),
        ).toBeGreaterThan(centre.indexOf('font: var(--sys-font-headline);'));
        // 18 / 600.
        expect(/--sys-font-headline:\s*600 1\.125rem\//.test(tokens)).toBe(
          true,
        );
        // A check stands on the icon ladder (24), never at the role's 18.
        expect(ruleBody('.ui-gauge__current > .ui-icon')).toBe(
          ' font-size: var(--ui-icon-large); ',
        );
      });

      it('glides the arc on a live rise only, behind the reduced-motion query', () => {
        const motion = css.indexOf(
          '@media (prefers-reduced-motion: no-preference)',
        );
        const glide = css.indexOf(
          ".ui-gauge[data-direction='up'] .ui-gauge__ring-arc",
        );
        expect(glide).toBeGreaterThan(motion);
        expect(
          ruleBody(".ui-gauge[data-direction='up'] .ui-gauge__ring-arc"),
        ).toBe(
          ' transition: stroke-dasharray var(--sys-motion-duration-deliberate) var(--sys-motion-ease-emphasized); ',
        );
        // Nothing draws itself on mount: no keyframes but the stamp's.
        expect(css.match(/@keyframes/g)).toHaveLength(1);
      });
    });

    it('keeps its motion behind the reduced-motion query', () => {
      const motion = css.indexOf(
        '@media (prefers-reduced-motion: no-preference)',
      );
      expect(motion).toBeGreaterThan(-1);
      expect(css.indexOf('transition')).toBeGreaterThan(motion);
      expect(css.indexOf('animation:')).toBeGreaterThan(motion);
    });
  });
});
