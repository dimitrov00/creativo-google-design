import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { BarberId } from '@core/primitives';
import { type AnalyticsDrillVm, DrillRows } from '../analytics.vm';
import { AnalyticsRows } from './analytics-rows';

const barbers = (count: number): AnalyticsDrillVm['barbers'] =>
  Array.from({ length: count }, (_, i) => ({
    barberId: BarberId.of(`b${i}`),
    name: `Бръснар ${i}`,
    avatarSrc: null,
    detail: null,
    value: `${i},00 €`,
    accessibleName: `Бръснар ${i}`,
    testId: `analytics-rows-barber-b${i}`,
  }));

const vmOf = (count: number): AnalyticsDrillVm => ({
  title: 'Оборот',
  lede: '',
  drillRows: DrillRows.Barbers,
  sections: [],
  days: [],
  barbers: barbers(count),
  waiting: null,
  empty: null,
  footerLabel: 'Общо',
  footerValue: '100,00 €',
  closeLabel: 'Затвори',
});

@Component({
  imports: [AnalyticsRows],
  template: `<lib-analytics-rows
    [vm]="vm()"
    (openBarber)="opened.push($event)"
  />`,
})
class Host {
  readonly vm = signal(vmOf(3));
  readonly opened: string[] = [];
}

describe('AnalyticsRows — the rows behind a figure', () => {
  it('lays out the rows and what they add up to; a barber’s row opens that barber', () => {
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    const rows = root.querySelectorAll(
      '[data-testid^="analytics-rows-barber-"]',
    );
    expect(rows).toHaveLength(3);
    expect(
      root.querySelector('[data-testid="analytics-rows-total"]')?.textContent,
    ).toContain('100,00 €');
    (rows[1] as HTMLElement).click();
    expect(fixture.componentInstance.opened).toEqual(['b1']);
  });

  it('lays every row out where the browser cannot watch the end come into reach', () => {
    // jsdom has no IntersectionObserver: no page waits on a sentinel.
    const fixture = TestBed.createComponent(Host);
    fixture.componentInstance.vm.set(vmOf(45));
    fixture.detectChanges();
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    expect(
      root.querySelectorAll('[data-testid^="analytics-rows-barber-"]'),
    ).toHaveLength(45);
    expect(root.querySelector('.analytics-rows__sentinel')).toBeNull();
  });
});
