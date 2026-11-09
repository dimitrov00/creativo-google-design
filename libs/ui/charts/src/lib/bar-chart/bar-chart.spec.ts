import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { UiChartPart } from '../chart-part';
import {
  fitLabel,
  UiBarChart,
  type UiBarChartOrientation,
  type UiBarChartStacking,
  type UiChartBar,
} from './bar-chart';

const WEEK: readonly UiChartBar[] = [
  {
    label: 'пн',
    parts: [
      { part: UiChartPart.Worked, value: 300 },
      { part: UiChartPart.NoShow, value: 60 },
      { part: UiChartPart.Unsold, value: 90 },
    ],
  },
  {
    label: 'вт',
    parts: [
      { part: UiChartPart.Worked, value: 420 },
      { part: UiChartPart.NoShow, value: 0 },
      { part: UiChartPart.Unsold, value: 60 },
    ],
  },
  {
    label: 'ср',
    parts: [
      { part: UiChartPart.Worked, value: 120 },
      { part: UiChartPart.NoShow, value: 30 },
      { part: UiChartPart.Unsold, value: 90 },
    ],
  },
];

@Component({
  imports: [UiBarChart],
  template: `
    <ui-bar-chart
      [uiBars]="bars()"
      [uiOrientation]="orientation()"
      [uiStacking]="stacking()"
      [uiRanked]="ranked()"
      [uiHighlightIndex]="highlight()"
      [uiValueText]="valueText()"
      uiLabel="Времето по дни: най-зает вторник"
      (uiBarPicked)="picked.push($event)"
      data-testid="chart"
    >
      <ul uiChartLegend data-testid="legend">
        <li><span class="ui-chart-swatch" data-part="worked"></span> Работа</li>
      </ul>
    </ui-bar-chart>
  `,
})
class Host {
  readonly bars = signal<readonly UiChartBar[]>(WEEK);
  readonly orientation = signal<UiBarChartOrientation>('vertical');
  readonly stacking = signal<UiBarChartStacking>('stacked');
  readonly ranked = signal(false);
  readonly highlight = signal<number | null>(null);
  readonly valueText = signal<readonly string[]>(['8 ч', '8 ч', '4 ч']);
  readonly picked: number[] = [];
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
  const bars = () =>
    Array.from(chart.querySelectorAll<SVGGElement>('.ui-bar-chart__bar'));
  const segments = (bar: Element) =>
    Array.from(bar.querySelectorAll<SVGRectElement>('.ui-bar-chart__segment'));
  return { fixture, host: fixture.componentInstance, chart, bars, segments };
}

const length = (rect: SVGRectElement) =>
  parseFloat(rect.style.getPropertyValue('--ui-bar-size'));
const offset = (rect: SVGRectElement) =>
  parseFloat(rect.style.getPropertyValue('--ui-bar-offset'));

describe('UiBarChart', () => {
  it('is a named image of one button per bar, each named by its word and its figure', () => {
    const { chart, bars } = render();
    const svg = chart.querySelector('svg');
    expect(svg?.getAttribute('role')).toBe('img');
    expect(svg?.getAttribute('aria-label')).toBe(
      'Времето по дни: най-зает вторник',
    );
    expect(svg?.getAttribute('viewBox')).toBe('0 0 320 140');
    expect(bars().map((bar) => bar.getAttribute('aria-label'))).toEqual([
      'пн, 8 ч',
      'вт, 8 ч',
      'ср, 4 ч',
    ]);
    expect(bars().map((bar) => bar.getAttribute('role'))).toEqual([
      'button',
      'button',
      'button',
    ]);
    expect(
      Array.from(chart.querySelectorAll('.ui-bar-chart__label')).map((t) =>
        t.textContent?.trim(),
      ),
    ).toEqual(['пн', 'вт', 'ср']);
  });

  it('stacks every part from the baseline with the hook that colours it, 2 px of surface between parts', () => {
    const { bars, segments } = render();
    const [monday] = bars();
    const parts = segments(monday as Element);
    expect(parts.map((p) => p.getAttribute('data-part'))).toEqual([
      'worked',
      'no-show',
      'unsold',
    ]);
    // The tallest bar (480) fills the 120 px plot: 0.25 px per minute.
    expect(offset(parts[0] as SVGRectElement)).toBe(0);
    expect(length(parts[0] as SVGRectElement)).toBe(74); // 75 − 1
    expect(offset(parts[1] as SVGRectElement)).toBe(76); // 75 + 1
    expect(length(parts[1] as SVGRectElement)).toBe(13); // 15 − 2
    expect(offset(parts[2] as SVGRectElement)).toBe(91); // 90 + 1
    expect(length(parts[2] as SVGRectElement)).toBe(21.5); // 112.5 − 91
    // Three bands of 320 / 3, each bar 2 px narrower than its band.
    expect(parts[0]?.getAttribute('width')).toBe('104.67');
    expect(parts[0]?.getAttribute('x')).toBe('1');
  });

  it('draws the total as one mark on the first part when single', () => {
    const { bars, segments } = render((host) => host.stacking.set('single'));
    const parts = segments(bars()[0] as Element);
    expect(parts).toHaveLength(1);
    expect(parts[0]?.getAttribute('data-part')).toBe('worked');
    expect(length(parts[0] as SVGRectElement)).toBe(112.5); // 450 of 480
  });

  it('paints a member bar in its identity tone on every part; an unknown or absent tone paints by part', () => {
    const { bars, segments } = render((host) =>
      host.bars.set([
        { label: 'Център', parts: [{ part: 'worked', value: 2 }], tone: 0 },
        { label: 'Младост', parts: [{ part: 'worked', value: 1 }], tone: 1 },
        { label: 'Стар', parts: [{ part: 'worked', value: 1 }], tone: 7 },
        { label: 'Без', parts: [{ part: 'worked', value: 1 }] },
      ]),
    );
    expect(
      bars().map((bar) =>
        segments(bar).map((rect) => rect.getAttribute('data-tone')),
      ),
    ).toEqual([['0'], ['1'], [null], [null]]);
    // The part hook stays: the tone says WHOSE, the part still says WHAT.
    expect(segments(bars()[0] as Element)[0]?.getAttribute('data-part')).toBe(
      'worked',
    );
  });

  it('lays horizontal bars in rows, largest first when ranked, the figure at the row’s end, the index kept', () => {
    const { chart, bars, segments } = render((host) => {
      host.orientation.set('horizontal');
      host.ranked.set(true);
    });
    expect(chart.getAttribute('data-orientation')).toBe('horizontal');
    expect(chart.querySelector('svg')?.getAttribute('viewBox')).toBe(
      '0 0 320 106',
    );
    expect(bars().map((bar) => bar.getAttribute('data-index'))).toEqual([
      '1',
      '0',
      '2',
    ]);
    expect(
      Array.from(chart.querySelectorAll('.ui-bar-chart__value')).map((t) =>
        t.textContent?.trim(),
      ),
    ).toEqual(['8 ч', '8 ч', '4 ч']);
    const [first] = segments(bars()[0] as Element);
    expect(first?.getAttribute('y')).toBe('18');
    expect(first?.getAttribute('height')).toBe('12');
    expect(length(first as SVGRectElement)).toBe(279); // 420 / 480 × 320 − 1
  });

  it('marks the highlighted bar and the host while a highlight is set', () => {
    const { chart, bars, host, fixture } = render((h) => h.highlight.set(2));
    expect(chart.hasAttribute('data-highlighting')).toBe(true);
    expect(bars().map((bar) => bar.hasAttribute('data-highlight'))).toEqual([
      false,
      false,
      true,
    ]);
    host.highlight.set(null);
    fixture.detectChanges();
    expect(chart.hasAttribute('data-highlighting')).toBe(false);
  });

  it('emits the bar’s index on tap, Enter and Space; the arrows walk one tab stop', () => {
    const { bars, host } = render();
    const [monday, tuesday, wednesday] = bars() as [
      SVGGElement,
      SVGGElement,
      SVGGElement,
    ];
    expect(
      [monday, tuesday, wednesday].map((b) => b.getAttribute('tabindex')),
    ).toEqual(['0', '-1', '-1']);
    tuesday.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    monday.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
    );
    wednesday.dispatchEvent(
      new KeyboardEvent('keydown', { key: ' ', bubbles: true }),
    );
    expect(host.picked).toEqual([1, 0, 2]);

    const right = new KeyboardEvent('keydown', {
      key: 'ArrowRight',
      bubbles: true,
      cancelable: true,
    });
    monday.dispatchEvent(right);
    expect(right.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(tuesday);
  });

  it('projects the legend under the drawing', () => {
    const { chart } = render();
    const legend = chart.querySelector(
      '.ui-bar-chart__legend [data-testid="legend"]',
    );
    expect(legend).not.toBeNull();
    expect(
      legend?.querySelector('.ui-chart-swatch')?.getAttribute('data-part'),
    ).toBe('worked');
  });

  it('draws nothing for no bars', () => {
    const { bars, chart } = render((host) => host.bars.set([]));
    expect(bars()).toEqual([]);
    expect(chart.querySelector('#ui-chart-hatch')).not.toBeNull();
  });
});

describe('fitLabel — a row’s word beside its figure', () => {
  it('keeps a word that fits, and ellipsizes one that would run into the figure', () => {
    expect(fitLabel('Фейд', '618,00 € · 36 пъти', 358)).toBe('Фейд');
    const long = 'Класическа подстрижка · 21,98 € на час';
    const fitted = fitLabel(long, '237,00 € · 22 пъти', 358);
    expect(fitted.endsWith('…')).toBe(true);
    expect(fitted.length).toBeLessThan(long.length);
    expect(fitLabel(long, '', 358)).toBe(long);
  });

  it('leaves at least the ellipsis on a row too narrow for any word', () => {
    expect(fitLabel('Фейд', '618,00 € · 36 пъти', 100)).toBe('…');
  });
});
