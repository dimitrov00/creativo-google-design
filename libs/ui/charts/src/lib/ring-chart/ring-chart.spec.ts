import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { UiChartPart } from '../chart-part';
import { UiRingChart, type UiChartRingSegment } from './ring-chart';

const SPEND: readonly UiChartRingSegment[] = [
  {
    value: 50,
    part: null,
    tone: null,
    label: 'Подстригване',
    valueText: '500 €',
  },
  {
    value: 30,
    part: UiChartPart.Unsold,
    tone: null,
    label: 'Брада',
    valueText: '300 €',
  },
  {
    value: 20,
    part: UiChartPart.Other,
    tone: 3,
    label: 'Детско',
    valueText: '200 €',
  },
];

@Component({
  imports: [UiRingChart],
  template: `
    <ui-ring-chart
      [uiSegments]="segments()"
      [uiThickness]="thickness()"
      uiLabel="Оборот по услуги: половината от подстригване"
      data-testid="ring"
    >
      <div uiRingCenter data-testid="centre">
        <span>Оборот</span>
        <strong>1 000 €</strong>
      </div>
      <p data-testid="stray">не се проектира</p>
    </ui-ring-chart>
  `,
})
class Host {
  readonly segments = signal<readonly UiChartRingSegment[]>(SPEND);
  readonly thickness = signal(14);
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
  const ring = fixture.nativeElement.querySelector(
    '[data-testid="ring"]',
  ) as HTMLElement;
  const one = (selector: string) => ring.querySelector(selector);
  const all = (selector: string) => Array.from(ring.querySelectorAll(selector));
  const arcs = () =>
    all('.ui-ring-chart__segments:not([data-leave]) .ui-ring-chart__segment');
  return { fixture, host: fixture.componentInstance, ring, one, all, arcs };
}

// The arcs' literals were computed apart from this code (degrees from north
// through the ordinary maths angle): a 240 box, the ring at radius 113 about
// (120, 120), 4 px of air + 14 of caps between segments (4.56° each side).
describe('UiRingChart', () => {
  it('is a named square image, with a hidden table of every segment', () => {
    const { one, all } = render();
    const svg = one('svg');
    expect(svg?.getAttribute('role')).toBe('img');
    expect(svg?.getAttribute('aria-label')).toBe(
      'Оборот по услуги: половината от подстригване',
    );
    expect(svg?.getAttribute('viewBox')).toBe('0 0 240 240');
    const table = one('table');
    // The recipe sits on a wrapper: a table would stretch past its 1px.
    expect(table?.hasAttribute('data-visually-hidden')).toBe(false);
    expect(table?.parentElement?.hasAttribute('data-visually-hidden')).toBe(
      true,
    );
    expect(table?.querySelector('caption')?.textContent?.trim()).toBe(
      'Оборот по услуги: половината от подстригване',
    );
    expect(all('tbody th').map((th) => th.textContent)).toEqual([
      'Подстригване',
      'Брада',
      'Детско',
    ]);
    expect(all('tbody td').map((td) => td.textContent)).toEqual([
      '500 €',
      '300 €',
      '200 €',
    ]);
  });

  it('draws each share clockwise from 12 o’clock with a gap between the caps', () => {
    const { arcs, one } = render();
    expect(arcs().map((arc) => arc.getAttribute('d'))).toEqual([
      'M128.99 7.36 A113 113 0 0 1 128.99 232.64',
      'M111.01 232.64 A113 113 0 0 1 10.09 93.74',
      'M15.65 76.64 A113 113 0 0 1 111.01 7.36',
    ]);
    // Something to share: no track.
    expect(one('.ui-ring-chart__track')).toBeNull();
  });

  it('paints a segment by its tone first, else its part, else the accent', () => {
    const { arcs } = render();
    expect(
      arcs().map((arc) => [
        arc.getAttribute('data-tone'),
        arc.getAttribute('data-part'),
      ]),
    ).toEqual([
      [null, null],
      [null, 'unsold'],
      ['3', null],
    ]);
  });

  it('draws one share as the whole ring with no gap', () => {
    const { arcs } = render((h) =>
      h.segments.set([
        { ...(SPEND[0] as UiChartRingSegment) },
        { ...(SPEND[1] as UiChartRingSegment), value: 0 },
      ]),
    );
    expect(arcs().map((arc) => arc.getAttribute('d'))).toEqual([
      'M120 7 A113 113 0 1 1 120 233 A113 113 0 1 1 120 7 Z',
    ]);
  });

  it('draws the track alone, a full quiet ring, for a zero total', () => {
    const { arcs, one } = render((h) =>
      h.segments.set(SPEND.map((segment) => ({ ...segment, value: 0 }))),
    );
    expect(arcs()).toEqual([]);
    const track = one('.ui-ring-chart__track');
    expect(['cx', 'cy', 'r'].map((name) => track?.getAttribute(name))).toEqual([
      '120',
      '120',
      '113',
    ]);
  });

  it('insets the ring by half its thickness and hands the thickness to the stylesheet', () => {
    const { ring, one, host, fixture } = render();
    expect(ring.style.getPropertyValue('--ui-ring-chart-thickness')).toBe(
      '14px',
    );
    host.thickness.set(20);
    host.segments.set([]);
    fixture.detectChanges();
    expect(ring.style.getPropertyValue('--ui-ring-chart-thickness')).toBe(
      '20px',
    );
    expect(one('.ui-ring-chart__track')?.getAttribute('r')).toBe('110');
  });

  it('projects only [uiRingCenter] over the drawing', () => {
    const { one } = render();
    const centre = one('.ui-ring-chart__center');
    expect(
      centre?.querySelector('[data-testid="centre"]')?.textContent,
    ).toContain('1 000 €');
    expect(one('[data-testid="stray"]')).toBeNull();
  });

  it('cross-fades new shares after the first frame and drops the old ring when its fade ends', async () => {
    const { all, host, fixture, ring } = render();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(ring.hasAttribute('data-settled')).toBe(true);
    host.segments.set(SPEND.map((segment) => ({ ...segment, value: 10 })));
    fixture.detectChanges();
    const groups = all('.ui-ring-chart__segments');
    expect(groups).toHaveLength(2);
    expect(groups[0]?.hasAttribute('data-leave')).toBe(true);
    expect(groups[1]?.hasAttribute('data-enter')).toBe(true);
    groups[0]?.dispatchEvent(new Event('animationend', { bubbles: true }));
    fixture.detectChanges();
    expect(all('.ui-ring-chart__segments')).toHaveLength(1);
    // A new thickness alone redraws in place.
    host.thickness.set(10);
    fixture.detectChanges();
    expect(all('.ui-ring-chart__segments')).toHaveLength(1);
  });

  it('draws nothing but the track and no table for no segments', () => {
    const { arcs, one } = render((h) => h.segments.set([]));
    expect(arcs()).toEqual([]);
    expect(one('.ui-ring-chart__track')).not.toBeNull();
    expect(one('table')).toBeNull();
  });
});
