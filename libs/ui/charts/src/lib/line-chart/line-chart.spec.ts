import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import {
  UiLineChart,
  type UiChartLinePoint,
  type UiLineChartCurve,
} from './line-chart';

const WEEK: readonly UiChartLinePoint[] = [
  { label: 'пн', value: 100, comparison: 80 },
  { label: 'вт', value: 200, comparison: null },
  { label: 'ср', value: 150, comparison: 120 },
  { label: 'чт', value: 50, comparison: 60 },
];

@Component({
  imports: [UiLineChart],
  template: `
    <ui-line-chart
      [uiPoints]="points()"
      [uiAverage]="average()"
      [uiValueText]="valueText()"
      [uiAverageText]="averageText()"
      [uiCurve]="curve()"
      [uiArea]="area()"
      uiLabel="Оборот по дни, най-висок вторник"
      data-testid="chart"
    />
  `,
})
class Host {
  readonly points = signal<readonly UiChartLinePoint[]>(WEEK);
  readonly average = signal<number | null>(125);
  readonly valueText = signal<readonly string[]>([
    '100 €',
    '200 €',
    '150 €',
    '50 €',
  ]);
  readonly averageText = signal<string | null>('ср. 125 €');
  readonly curve = signal<UiLineChartCurve>('linear');
  readonly area = signal(false);
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
  const chart = fixture.nativeElement.querySelector(
    '[data-testid="chart"]',
  ) as HTMLElement;
  const one = (selector: string) => chart.querySelector(selector);
  const all = (selector: string) =>
    Array.from(chart.querySelectorAll(selector));
  return { fixture, host: fixture.componentInstance, chart, one, all };
}

describe('UiLineChart', () => {
  it('is a named image over a 5 : 2 box, with a hidden table of every point', () => {
    const { one, all } = render();
    const svg = one('svg');
    expect(svg?.getAttribute('role')).toBe('img');
    expect(svg?.getAttribute('aria-label')).toBe(
      'Оборот по дни, най-висок вторник',
    );
    expect(svg?.getAttribute('viewBox')).toBe('0 0 320 128');
    const table = one('table');
    // The recipe sits on a wrapper: a table would stretch past its 1px.
    expect(table?.hasAttribute('data-visually-hidden')).toBe(false);
    expect(table?.parentElement?.hasAttribute('data-visually-hidden')).toBe(
      true,
    );
    expect(table?.querySelector('caption')?.textContent?.trim()).toBe(
      'Оборот по дни, най-висок вторник',
    );
    expect(all('tbody th').map((th) => th.textContent)).toEqual([
      'пн',
      'вт',
      'ср',
      'чт',
    ]);
    expect(all('tbody td').map((td) => td.textContent)).toEqual([
      '100 €',
      '200 €',
      '150 €',
      '50 €',
    ]);
  });

  it('draws the accent line through evenly spaced points on a zero-anchored scale', () => {
    const { one } = render();
    // The labels' column fits «ср. 125 €»: 9 glyphs × 7 + 6 = 69. Plot: x from 6
    // to 320 − 69 − 6 = 245 in three steps of 79.67; y: 0 → 122, 200 (the top) → 6.
    expect(one('.ui-line-chart__path')?.getAttribute('d')).toBe(
      'M6 64 L85.67 6 L165.33 35 L245 93',
    );
  });

  it('draws the comparison in the 32 % grey hook, breaking at a null', () => {
    const { one } = render();
    const comparison = one('.ui-line-chart__comparison');
    expect(comparison?.getAttribute('data-part')).toBe('comparison');
    expect(comparison?.getAttribute('d')).toBe(
      'M6 75.6 M165.33 52.4 L245 87.2',
    );
  });

  it('rules the average across the plot, dashed, and labels the last value and the average at the right edge', () => {
    const { one, all } = render();
    const average = one('.ui-line-chart__average');
    expect(average?.getAttribute('x1')).toBe('6');
    expect(average?.getAttribute('x2')).toBe('245');
    expect(average?.getAttribute('y1')).toBe('49.5');
    const labels = all('.ui-line-chart__edge-label');
    expect(labels.map((l) => l.textContent?.trim())).toEqual([
      '50 €',
      'ср. 125 €',
    ]);
    expect(labels.map((l) => l.getAttribute('x'))).toEqual(['257', '257']);
    expect(labels.map((l) => l.getAttribute('y'))).toEqual(['97', '53.5']);
  });

  it('widens the labels’ column for a longer label, never past two fifths of the box', () => {
    const { all, host, fixture } = render();
    // «средно 1 234,56 €»: 17 glyphs × 7 + 6 = 125, under the cap of 128.
    host.averageText.set('средно 1 234,56 €');
    fixture.detectChanges();
    expect(
      all('.ui-line-chart__edge-label').map((l) => l.getAttribute('x')),
    ).toEqual(['201', '201']);
    // A label past the cap: the column stops at 320 × 0.4 = 128.
    host.averageText.set('средно за периода 12 345,67 €');
    fixture.detectChanges();
    expect(
      all('.ui-line-chart__edge-label').map((l) => l.getAttribute('x')),
    ).toEqual(['198', '198']);
  });

  it('keeps the two edge labels a caption line apart', () => {
    const { all } = render((host) => host.average.set(55));
    const [value, average] = all('.ui-line-chart__edge-label');
    expect(value?.getAttribute('y')).toBe('97');
    // 55 → y 90.1, its label at 94.1: within 14 of 97 and above it, pushed up to 83.
    expect(average?.getAttribute('y')).toBe('83');
  });

  it('marks the first and last points in a ringed disc, and takes no gutter without labels', () => {
    const { all, one, host, fixture } = render();
    const markers = all('.ui-line-chart__marker');
    expect(markers.map((m) => m.getAttribute('cx'))).toEqual(['6', '245']);
    expect(markers.map((m) => m.getAttribute('r'))).toEqual(['4', '4']);
    host.valueText.set([]);
    host.averageText.set(null);
    fixture.detectChanges();
    expect(all('.ui-line-chart__edge-label')).toEqual([]);
    // The old path is still leaving; the new one spans the whole width.
    expect(
      one('.ui-line-chart__path:not([data-leave])')?.getAttribute('d'),
    ).toBe('M6 64 L108.67 6 L211.33 35 L314 93');
  });

  it('cross-fades a changed path after the first frame and drops the old one when its fade ends', async () => {
    const { all, host, fixture, chart } = render();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(chart.hasAttribute('data-settled')).toBe(true);
    host.points.set(WEEK.map((p) => ({ ...p, value: p.value + 10 })));
    fixture.detectChanges();
    const paths = all('.ui-line-chart__path');
    expect(paths).toHaveLength(2);
    expect(paths[0]?.hasAttribute('data-leave')).toBe(true);
    expect(paths[1]?.hasAttribute('data-enter')).toBe(true);
    paths[0]?.dispatchEvent(new Event('animationend', { bubbles: true }));
    fixture.detectChanges();
    expect(all('.ui-line-chart__path')).toHaveLength(1);
    expect(all('.ui-line-chart__path')[0]?.hasAttribute('data-leave')).toBe(
      false,
    );
  });

  it('draws one marker and no table rows for a single point, and nothing for none', () => {
    const { all, one, host, fixture } = render((h) => {
      h.points.set([{ label: 'пн', value: 10, comparison: null }]);
      h.valueText.set(['10 €']);
      h.average.set(null);
      h.averageText.set(null);
    });
    expect(all('.ui-line-chart__marker')).toHaveLength(1);
    expect(one('.ui-line-chart__path')?.getAttribute('d')).toBe('M6 6');
    host.points.set([]);
    host.valueText.set([]);
    fixture.detectChanges();
    // Only the old path remains, leaving; nothing new is drawn.
    expect(one('.ui-line-chart__path:not([data-leave])')).toBeNull();
    expect(one('table')).toBeNull();
  });

  it('draws no area and no gradient by default', () => {
    const { one } = render();
    expect(one('.ui-line-chart__area')).toBeNull();
    expect(one('linearGradient')).toBeNull();
  });

  it('smooths both lines into monotone curves through the same points', () => {
    const { one } = render((host) => host.curve.set('smooth'));
    // A d3 curveMonotoneX port, run apart, over the straight line's points.
    expect(one('.ui-line-chart__path')?.getAttribute('d')).toBe(
      'M6 64 C32.56 35 59.11 6 85.67 6 C112.22 6 138.78 20.5 165.33 35 C191.89 49.5 218.44 71.25 245 93',
    );
    // The comparison's runs: a lone point, then two points drawn straight.
    expect(one('.ui-line-chart__comparison')?.getAttribute('d')).toBe(
      'M6 75.6 M165.33 52.4 L245 87.2',
    );
    // The markers stay on the first and last points.
    const markers = Array.from(
      one('svg')?.querySelectorAll('.ui-line-chart__marker') ?? [],
    );
    expect(markers.map((m) => m.getAttribute('cy'))).toEqual(['64', '93']);
  });

  it('fills under the line down to the zero baseline with its own gradient, straight or smooth', () => {
    const { one, all, host, fixture } = render((h) => h.area.set(true));
    const area = one('.ui-line-chart__area');
    // The baseline is y(0): 128 − 6 = 122.
    expect(area?.getAttribute('d')).toBe(
      'M6 64 L85.67 6 L165.33 35 L245 93 L245 122 L6 122 Z',
    );
    const gradient = one('linearGradient');
    const id = gradient?.getAttribute('id') ?? '';
    expect(id).toMatch(/^ui-line-chart-area-\d+$/);
    expect(area?.getAttribute('fill')).toBe(`url(#${id})`);
    expect(
      [gradient?.getAttribute('x1'), gradient?.getAttribute('y1')].join(),
    ).toBe('0,0');
    expect(
      [gradient?.getAttribute('x2'), gradient?.getAttribute('y2')].join(),
    ).toBe('0,1');
    expect(all('stop').map((stop) => stop.getAttribute('offset'))).toEqual([
      '0',
      '1',
    ]);
    // The area sits under every line.
    expect(one('svg > path')?.classList.contains('ui-line-chart__area')).toBe(
      true,
    );
    host.curve.set('smooth');
    fixture.detectChanges();
    expect(
      one('.ui-line-chart__area:not([data-leave])')?.getAttribute('d'),
    ).toBe(
      'M6 64 C32.56 35 59.11 6 85.67 6 C112.22 6 138.78 20.5 165.33 35 C191.89 49.5 218.44 71.25 245 93 L245 122 L6 122 Z',
    );
  });

  it('gives every chart its own gradient id', () => {
    const first = render((h) => h.area.set(true));
    const firstId = first.one('linearGradient')?.getAttribute('id');
    TestBed.resetTestingModule();
    const second = render((h) => h.area.set(true));
    expect(second.one('linearGradient')?.getAttribute('id')).not.toBe(firstId);
  });

  it('draws no area for a single point', () => {
    const { one } = render((h) => {
      h.area.set(true);
      h.points.set([{ label: 'пн', value: 10, comparison: null }]);
    });
    expect(one('.ui-line-chart__area')).toBeNull();
  });
});
