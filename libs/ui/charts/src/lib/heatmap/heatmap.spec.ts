import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { UiHeatmap, type UiChartHeatCell } from './heatmap';

const CELLS: readonly UiChartHeatCell[] = [
  { row: 0, column: 0, value: 30, max: 60 },
  { row: 0, column: 1, value: 60, max: 60 },
  { row: 1, column: 1, value: 0, max: 60 },
  { row: 1, column: 2, value: 90, max: 60 },
];

@Component({
  imports: [UiHeatmap],
  template: `
    <ui-heatmap
      [uiRows]="rows()"
      [uiColumns]="columns()"
      [uiCells]="cells()"
      uiLabel="Заетост по ден и час: най-зает вторник в 10"
      data-testid="chart"
    />
  `,
})
class Host {
  readonly rows = signal<readonly string[]>(['пн', 'вт']);
  readonly columns = signal<readonly string[]>(['9', '10', '11']);
  readonly cells = signal<readonly UiChartHeatCell[]>(CELLS);
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
  const all = (selector: string) =>
    Array.from(chart.querySelectorAll<HTMLElement>(selector));
  return { fixture, host: fixture.componentInstance, chart, all };
}

describe('UiHeatmap', () => {
  it('is a named grid of one cell per row × column, the column count on the host', () => {
    const { chart, all } = render();
    const grid = chart.querySelector('.ui-heatmap__grid');
    expect(grid?.getAttribute('role')).toBe('img');
    expect(grid?.getAttribute('aria-label')).toBe(
      'Заетост по ден и час: най-зает вторник в 10',
    );
    expect(chart.style.getPropertyValue('--ui-heatmap-columns')).toBe('3');
    expect(all('.ui-heatmap__column').map((c) => c.textContent)).toEqual([
      '9',
      '10',
      '11',
    ]);
    expect(all('.ui-heatmap__row').map((r) => r.textContent)).toEqual([
      'пн',
      'вт',
    ]);
    expect(all('.ui-heatmap__cell')).toHaveLength(6);
  });

  it('sets each cell’s strength as value ÷ max, clamped to 0 … 1, and marks the cells with data', () => {
    const { all } = render();
    const cells = all('.ui-heatmap__cell');
    expect(
      cells.map((cell) => cell.style.getPropertyValue('--ui-cell-strength')),
    ).toEqual(['0.5', '1', '', '', '0', '1']);
    expect(cells.map((cell) => cell.hasAttribute('data-cell'))).toEqual([
      true,
      true,
      false,
      false,
      true,
      true,
    ]);
  });

  it('lists every cell in a hidden table, empty where there is no data', () => {
    const { chart, all } = render();
    const table = chart.querySelector('table');
    // The recipe sits on a wrapper: a table would stretch past its 1px.
    expect(table?.hasAttribute('data-visually-hidden')).toBe(false);
    expect(table?.parentElement?.hasAttribute('data-visually-hidden')).toBe(
      true,
    );
    expect(all('thead th').map((th) => th.textContent)).toEqual([
      '9',
      '10',
      '11',
    ]);
    expect(all('tbody th').map((th) => th.textContent)).toEqual(['пн', 'вт']);
    expect(all('tbody td').map((td) => td.textContent)).toEqual([
      '30',
      '60',
      '',
      '',
      '0',
      '90',
    ]);
  });

  it('treats a max of 0 as no strength and draws no table for no rows', () => {
    const { all, chart, host, fixture } = render((h) =>
      h.cells.set([{ row: 0, column: 0, value: 5, max: 0 }]),
    );
    expect(
      all('.ui-heatmap__cell')[0]?.style.getPropertyValue('--ui-cell-strength'),
    ).toBe('0');
    host.rows.set([]);
    fixture.detectChanges();
    expect(all('.ui-heatmap__cell')).toEqual([]);
    expect(chart.querySelector('table')).toBeNull();
  });
});
