import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { UiSparkLine } from './spark-line';

@Component({
  imports: [UiSparkLine],
  template: `<ui-spark-line
    [uiValues]="values()"
    [uiComparison]="comparison()"
    [uiSlots]="slots"
    uiLabel="Оборот: 35 € до днес, 20 € миналия месец"
  />`,
})
class Host {
  readonly values = signal<readonly number[]>([0, 10, 35]);
  readonly comparison = signal<readonly number[] | null>([5, 10, 15, 20]);
  readonly slots = 4;
}

describe('UiSparkLine', () => {
  function render() {
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    return { fixture, host };
  }

  it('draws the series as a line with a wash and an end dot, the comparison dashed, named as one image', () => {
    const { host } = render();
    const svg = host.querySelector('svg');
    expect(svg?.getAttribute('role')).toBe('img');
    expect(svg?.getAttribute('aria-label')).toBe(
      'Оборот: 35 € до днес, 20 € миналия месец',
    );
    expect(
      host.querySelector('.ui-spark-line__line')?.getAttribute('d'),
    ).toMatch(/^M/);
    expect(
      host.querySelector('.ui-spark-line__area')?.getAttribute('d'),
    ).toMatch(/Z$/);
    expect(host.querySelector('.ui-spark-line__dot')).not.toBeNull();
    expect(
      host
        .querySelector('.ui-spark-line__comparison')
        ?.getAttribute('data-part'),
    ).toBe('comparison');
  });

  it('ends the dot at the last value, three slots of four across: a running period leaves the rest ahead', () => {
    const { host } = render();
    const dot = host.querySelector('.ui-spark-line__dot');
    const cx = Number(dot?.getAttribute('cx'));
    // 320 wide less a 5 px inset each side: slot 2 of 0…3.
    expect(cx).toBeCloseTo(5 + (2 / 3) * 310, 1);
  });

  it('draws no comparison without one, and a lone value as a dot alone', () => {
    const { fixture, host } = render();
    fixture.componentInstance.comparison.set(null);
    fixture.componentInstance.values.set([12]);
    fixture.detectChanges();
    expect(host.querySelector('.ui-spark-line__comparison')).toBeNull();
    expect(host.querySelector('.ui-spark-line__line')).toBeNull();
    expect(host.querySelector('.ui-spark-line__dot')).not.toBeNull();
  });
});
