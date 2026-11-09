import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import {
  UiLineChart,
  type UiChartLinePoint,
  type UiLineChartCurve,
  type UiLineChartSeries,
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
      [uiScrubbable]="scrubbable()"
      [uiSeries]="series()"
      (uiScrubbed)="scrubbed.push($event)"
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
  readonly scrubbable = signal(false);
  readonly series = signal<readonly UiLineChartSeries[]>([]);
  readonly scrubbed: (number | null)[] = [];
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
    host.points.set(WEEK.map((p) => ({ ...p, value: (p.value ?? 0) + 10 })));
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

describe('UiLineChart — a running total that stops at today', () => {
  it('draws the line up to its last figure, the comparison on, and labels the last drawn point', () => {
    const { all } = render((host) => {
      host.points.set([
        { label: '1', value: 100, comparison: 80 },
        { label: '2', value: 300, comparison: 160 },
        { label: '3', value: null, comparison: 240 },
        { label: '4', value: null, comparison: 320 },
      ]);
      host.valueText.set(['100 €', '300 €', '', '']);
      host.average.set(null);
      host.averageText.set(null);
    });
    const markers = all('.ui-line-chart__marker');
    expect(markers).toHaveLength(2);
    const labels = all('.ui-line-chart__edge-label, text').map((t) =>
      t.textContent?.trim(),
    );
    expect(labels).toContain('300 €');
    const comparison = all('.ui-line-chart__comparison')[0];
    expect(
      comparison?.getAttribute('d')?.split(/[ML]/).filter(Boolean),
    ).toHaveLength(4);
  });
});

describe('UiLineChart — tap and drag to read a point', () => {
  /** A pointer event at `x` px into a 250 px-wide drawing (the 250-wide viewBox at 1 : 1). */
  const pointer = (
    svg: Element,
    type: string,
    x: number,
    pointerType = 'touch',
  ): void => {
    const event = new MouseEvent(type, { bubbles: true, clientX: x });
    Object.defineProperties(event, {
      pointerId: { value: 1 },
      pointerType: { value: pointerType },
    });
    svg.dispatchEvent(event);
  };
  const scrubbable = () => {
    const view = render((h) => h.scrubbable.set(true));
    const svg = view.one('svg') as SVGSVGElement;
    const width = Number(svg.getAttribute('viewBox')?.split(' ')[2]);
    svg.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width, height: 100 }) as DOMRect;
    return { ...view, svg, width };
  };

  it('reads nothing unless asked to', () => {
    const { one, host } = render();
    const svg = one('svg') as SVGSVGElement;
    expect(svg.hasAttribute('data-scrubbable')).toBe(false);
    pointer(svg, 'pointerdown', 10);
    expect(host.scrubbed).toEqual([]);
  });

  it('marks the point nearest a finger, follows the drag and lets go on lift', () => {
    const { svg, fixture, host, one, all, width } = scrubbable();
    pointer(svg, 'pointerdown', 1);
    fixture.detectChanges();
    expect(host.scrubbed).toEqual([0]);
    expect(svg.hasAttribute('data-scrubbing')).toBe(true);
    expect(one('.ui-line-chart__scrub-line')).not.toBeNull();
    // The value dot and the comparison's: Monday has both.
    expect(all('.ui-line-chart__scrub-dot')).toHaveLength(2);

    pointer(svg, 'pointermove', width - 1);
    fixture.detectChanges();
    expect(host.scrubbed).toEqual([0, 3]);
    // Moving within the same point emits nothing new.
    pointer(svg, 'pointermove', width - 2);
    expect(host.scrubbed).toEqual([0, 3]);

    pointer(svg, 'pointerup', width - 2);
    fixture.detectChanges();
    expect(host.scrubbed).toEqual([0, 3, null]);
    expect(svg.hasAttribute('data-scrubbing')).toBe(false);
    expect(one('.ui-line-chart__scrub-line')).toBeNull();
  });

  it('reads on a mouse hover, but a finger only while it is down', () => {
    const { svg, host } = scrubbable();
    pointer(svg, 'pointermove', 1);
    expect(host.scrubbed).toEqual([]);
    pointer(svg, 'pointermove', 1, 'mouse');
    expect(host.scrubbed).toEqual([0]);
    pointer(svg, 'pointerleave', 1, 'mouse');
    expect(host.scrubbed).toEqual([0, null]);
  });

  it('draws one dot on a point with no comparison', () => {
    const { svg, fixture, host, all, width } = scrubbable();
    // Drag right until Tuesday — the second point — which has no comparison.
    pointer(svg, 'pointerdown', 0);
    for (let x = 0; x < width && host.scrubbed.at(-1) !== 1; x += 1) {
      pointer(svg, 'pointermove', x);
    }
    expect(host.scrubbed.at(-1)).toBe(1);
    fixture.detectChanges();
    expect(all('.ui-line-chart__scrub-dot')).toHaveLength(1);
  });
});

describe('UiLineChart — members compared (uiSeries)', () => {
  const POINTS: readonly UiChartLinePoint[] = WEEK.map((p) => ({
    label: p.label,
    value: null,
    comparison: null,
  }));
  const MEMBERS: readonly UiLineChartSeries[] = [
    { values: [100, 300, 450, 500], tone: 0 },
    { values: [50, 80, null, null], tone: 1 },
  ];

  it('draws one line per member in its identity tone, a dot at each one’s last point, and no accent line', () => {
    const { all } = render((h) => {
      h.points.set(POINTS);
      h.series.set(MEMBERS);
      h.average.set(null);
      h.averageText.set(null);
    });
    const lines = all('.ui-line-chart__series');
    expect(lines.map((line) => line.getAttribute('data-tone'))).toEqual([
      '0',
      '1',
    ]);
    // The second member stops after its second point.
    expect(
      lines[1]?.getAttribute('d')?.split(/[ML]/).filter(Boolean),
    ).toHaveLength(2);
    expect(all('.ui-line-chart__series-end')).toHaveLength(2);
    expect(all('.ui-line-chart__path')).toHaveLength(0);
    expect(all('.ui-line-chart__marker')).toHaveLength(0);
  });

  it('scales every member onto one axis — the higher one sets the top', () => {
    const { all } = render((h) => {
      h.points.set(POINTS);
      h.series.set(MEMBERS);
      h.average.set(null);
      h.averageText.set(null);
    });
    const ends = all('.ui-line-chart__series-end').map((dot) =>
      Number(dot.getAttribute('cy')),
    );
    // 500 sits at the plot's top edge (PAD), 80 well under it.
    expect(ends[0]).toBe(6);
    expect(ends[1]).toBeGreaterThan(ends[0] as number);
  });

  it('marks each member under the finger, only where it has a value', () => {
    const { one, all, fixture, host } = render((h) => {
      h.points.set(POINTS);
      h.series.set(MEMBERS);
      h.scrubbable.set(true);
    });
    const svg = one('svg') as SVGSVGElement;
    const width = Number(svg.getAttribute('viewBox')?.split(' ')[2]);
    svg.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width, height: 100 }) as DOMRect;
    const down = new MouseEvent('pointerdown', { bubbles: true, clientX: 0 });
    Object.defineProperties(down, {
      pointerId: { value: 1 },
      pointerType: { value: 'touch' },
    });
    svg.dispatchEvent(down);
    fixture.detectChanges();
    expect(host.scrubbed).toEqual([0]);
    expect(
      all('.ui-line-chart__series-dot').map((dot) =>
        dot.getAttribute('data-tone'),
      ),
    ).toEqual(['0', '1']);
    const move = new MouseEvent('pointermove', {
      bubbles: true,
      clientX: width - 1,
    });
    Object.defineProperties(move, {
      pointerId: { value: 1 },
      pointerType: { value: 'touch' },
    });
    svg.dispatchEvent(move);
    fixture.detectChanges();
    // The last point: the second member has no value there.
    expect(all('.ui-line-chart__series-dot')).toHaveLength(1);
  });
});
