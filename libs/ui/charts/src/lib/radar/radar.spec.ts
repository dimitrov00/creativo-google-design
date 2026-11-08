import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { UiRadar, type UiChartRadarAxis } from './radar';

const AXES: readonly UiChartRadarAxis[] = [
  { label: '€ / час', value: 100, comparison: 80 },
  { label: 'Запълване', value: 50, comparison: 60 },
  { label: 'Презаписване', value: null, comparison: 40 },
  { label: 'Бакшиши', value: 80, comparison: null },
  { label: 'Надеждност', value: 20, comparison: 30 },
];

const VALUE_TEXT = ['38 €', '50 %', '—', '80 %', '2 закъснения'];

@Component({
  imports: [UiRadar],
  template: `
    <ui-radar
      [uiAxes]="axes()"
      [uiValueText]="valueText()"
      [uiTone]="tone()"
      uiMissingText="малко данни"
      uiLabel="Иван: най-силен в оборота на час, слаб в надеждността"
      data-testid="radar"
    />
  `,
})
class Host {
  readonly axes = signal<readonly UiChartRadarAxis[]>(AXES);
  readonly valueText = signal<readonly string[]>(VALUE_TEXT);
  readonly tone = signal<number | null>(2);
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
  const radar = fixture.nativeElement.querySelector(
    '[data-testid="radar"]',
  ) as HTMLElement;
  const one = (selector: string) => radar.querySelector(selector);
  const all = (selector: string) =>
    Array.from(radar.querySelectorAll(selector));
  return { fixture, host: fixture.componentInstance, radar, one, all };
}

describe('UiRadar', () => {
  it('is a named image over a square box, with a hidden table of every axis', () => {
    const { one, all } = render();
    const svg = one('svg');
    expect(svg?.getAttribute('role')).toBe('img');
    expect(svg?.getAttribute('aria-label')).toBe(
      'Иван: най-силен в оборота на час, слаб в надеждността',
    );
    expect(svg?.getAttribute('viewBox')).toBe('0 0 320 320');
    const table = one('table');
    expect(table?.hasAttribute('data-visually-hidden')).toBe(true);
    expect(table?.querySelector('caption')?.textContent?.trim()).toBe(
      'Иван: най-силен в оборота на час, слаб в надеждността',
    );
    expect(all('tbody th').map((th) => th.textContent)).toEqual(
      AXES.map((axis) => axis.label),
    );
    const cells = all('tbody tr').map((row) =>
      Array.from(row.querySelectorAll('td')).map((td) => td.textContent),
    );
    expect(cells).toEqual([
      ['38 €', '80'],
      ['50 %', '60'],
      ['малко данни', '40'],
      ['80 %', ''],
      ['2 закъснения', '30'],
    ]);
  });

  it('draws the base: two guide rings and one hairline per axis, the first straight up', () => {
    const { all } = render();
    // Centre 160; the words' band grows with «Презаписване» (12 glyphs → 92 px),
    // so the rings sit on the floor of a quarter of the box: radius 80.
    expect(all('.ui-radar__ring').map((r) => r.getAttribute('points'))).toEqual(
      [
        '160,120 198.04,147.64 183.51,192.36 136.49,192.36 121.96,147.64',
        '160,80 236.08,135.28 207.02,224.72 112.98,224.72 83.92,135.28',
      ],
    );
    const axes = all('.ui-radar__axis');
    expect(axes).toHaveLength(5);
    expect(axes[0]?.getAttribute('x1')).toBe('160');
    expect(axes[0]?.getAttribute('y1')).toBe('160');
    expect(axes[0]?.getAttribute('x2')).toBe('160');
    expect(axes[0]?.getAttribute('y2')).toBe('80');
    expect(axes[1]?.getAttribute('x2')).toBe('236.08');
    expect(axes[1]?.getAttribute('y2')).toBe('135.28');
  });

  it('puts each vertex at its value share of the radius, a null axis on the centre and dotted', () => {
    const { one, all } = render();
    expect(one('.ui-radar__polygon')?.getAttribute('points')).toBe(
      '160,80 198.04,147.64 160,160 122.38,211.78 144.78,155.06',
    );
    const axes = all('.ui-radar__axis');
    expect(axes.map((a) => a.hasAttribute('data-missing'))).toEqual([
      false,
      false,
      true,
      false,
      false,
    ]);
  });

  it('outlines the comparison in the grey hook on the same base, and leaves it out when no axis has one', () => {
    const { one, host, fixture } = render();
    const comparison = one('.ui-radar__comparison');
    expect(comparison?.getAttribute('data-part')).toBe('comparison');
    expect(comparison?.getAttribute('points')).toBe(
      '160,96 205.65,145.17 178.81,185.89 160,160 137.17,152.58',
    );
    host.axes.set(AXES.map((axis) => ({ ...axis, comparison: null })));
    fixture.detectChanges();
    expect(one('.ui-radar__comparison')).toBeNull();
  });

  it('prints each word and its figure outside the axis end, anchored away from the centre, the missing word for a null axis', () => {
    const { all } = render();
    const labels = all('.ui-radar__axis-label');
    const values = all('.ui-radar__axis-value');
    expect(labels.map((l) => l.textContent?.trim())).toEqual(
      AXES.map((axis) => axis.label),
    );
    expect(values.map((v) => v.textContent?.trim())).toEqual([
      '38 €',
      '50 %',
      'малко данни',
      '80 %',
      '2 закъснения',
    ]);
    expect(values.map((v) => v.hasAttribute('data-missing'))).toEqual([
      false,
      false,
      true,
      false,
      false,
    ]);
    expect(labels.map((l) => l.getAttribute('text-anchor'))).toEqual([
      'middle',
      'start',
      'start',
      'end',
      'end',
    ]);
    // Above the centre the two lines stack upwards from the anchor (160, 72) …
    expect(labels[0]?.getAttribute('x')).toBe('160');
    expect(labels[0]?.getAttribute('y')).toBe('58');
    expect(values[0]?.getAttribute('y')).toBe('72');
    // … below it they hang from it (211.73, 231.19).
    expect(labels[2]?.getAttribute('x')).toBe('211.73');
    expect(labels[2]?.getAttribute('y')).toBe('239.19');
    expect(values[2]?.getAttribute('y')).toBe('253.19');
    expect(labels[4]?.getAttribute('x')).toBe('76.31');
  });

  it('carries the identity tone on the host for the stylesheet, none for the accent or a slot it does not know', () => {
    const { radar, host, fixture } = render();
    expect(radar.getAttribute('data-tone')).toBe('2');
    host.tone.set(null);
    fixture.detectChanges();
    expect(radar.hasAttribute('data-tone')).toBe(false);
    host.tone.set(7);
    fixture.detectChanges();
    expect(radar.hasAttribute('data-tone')).toBe(false);
    host.tone.set(0);
    fixture.detectChanges();
    expect(radar.getAttribute('data-tone')).toBe('0');
  });

  it('cross-fades a changed polygon after the first frame and drops the old one when its fade ends', async () => {
    const { all, host, fixture, radar } = render();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(radar.hasAttribute('data-settled')).toBe(true);
    host.axes.set(
      AXES.map((axis) => ({
        ...axis,
        value: axis.value === null ? null : axis.value + 10,
      })),
    );
    fixture.detectChanges();
    const polygons = all('.ui-radar__polygon');
    expect(polygons).toHaveLength(2);
    expect(polygons[0]?.hasAttribute('data-leave')).toBe(true);
    expect(polygons[1]?.hasAttribute('data-enter')).toBe(true);
    expect(polygons[1]?.getAttribute('points')).toBe(
      '160,80 205.65,145.17 160,160 117.68,218.25 137.17,152.58',
    );
    polygons[0]?.dispatchEvent(new Event('animationend', { bubbles: true }));
    fixture.detectChanges();
    expect(all('.ui-radar__polygon')).toHaveLength(1);
    expect(all('.ui-radar__polygon')[0]?.hasAttribute('data-leave')).toBe(
      false,
    );
  });

  it('draws any count of axes, and nothing but the box for none', () => {
    const { all, one, host, fixture } = render((h) => {
      h.axes.set(AXES.slice(0, 3));
      h.valueText.set(VALUE_TEXT.slice(0, 3));
    });
    expect(all('.ui-radar__axis')).toHaveLength(3);
    expect(one('.ui-radar__polygon')?.getAttribute('points')).toBe(
      '160,80 194.64,180 160,160',
    );
    host.axes.set([]);
    host.valueText.set([]);
    fixture.detectChanges();
    expect(all('.ui-radar__ring')).toEqual([]);
    expect(all('.ui-radar__axis')).toEqual([]);
    expect(one('.ui-radar__polygon:not([data-leave])')).toBeNull();
    expect(one('.ui-radar__comparison')).toBeNull();
    expect(one('table')).toBeNull();
  });
});
