import {
  ChangeDetectionStrategy,
  Component,
  ViewEncapsulation,
  computed,
  input,
} from '@angular/core';
import { UiVisuallyHiddenDirective } from '@creativo/ui/modifiers';

/** One cell: its row and column (indices into `uiRows` / `uiColumns`), its value and the scale's top. */
export type UiChartHeatCell = {
  readonly row: number;
  readonly column: number;
  readonly value: number;
  readonly max: number;
};

type HeatCellMark = {
  readonly key: number;
  readonly value: number | null;
  /** value ÷ max, 0 … 1; `null` for a cell without data. */
  readonly strength: number | null;
};

type HeatRow = {
  readonly label: string;
  readonly cells: readonly HeatCellMark[];
};

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

/**
 * THE HEATMAP — a CSS grid of rows × columns (weekday × hour), each cell
 * with data tinted on the accent by `--ui-cell-strength` (its value over
 * its max, 0 … 1: charts.css draws 10 % at nothing and 100 % at the top),
 * a cell without data in the control fill. The words along the edges are
 * ink. The kit decides nothing: which cells exist, their values and their
 * scale arrive in `uiCells`.
 *
 * Accessibility: the grid is `role="img"` named by `uiLabel`, and a
 * visually hidden table beside it lists every row's cells, since no figure
 * is printed on the grid.
 */
@Component({
  selector: 'ui-heatmap',
  imports: [UiVisuallyHiddenDirective],
  templateUrl: './heatmap.html',
  styleUrl: './heatmap.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  host: {
    class: 'ui-heatmap',
    '[style.--ui-heatmap-columns]': 'uiColumns().length',
  },
})
export class UiHeatmap {
  readonly uiRows = input.required<readonly string[]>();
  readonly uiColumns = input.required<readonly string[]>();
  readonly uiCells = input.required<readonly UiChartHeatCell[]>();
  /** The grid's accessible name — one sentence the presenter writes. */
  readonly uiLabel = input.required<string>();

  protected readonly grid = computed<readonly HeatRow[]>(() => {
    const columns = this.uiColumns().length;
    const byPlace = new Map<number, UiChartHeatCell>();
    for (const cell of this.uiCells()) {
      byPlace.set(cell.row * columns + cell.column, cell);
    }
    return this.uiRows().map((label, row) => ({
      label,
      cells: this.uiColumns().map((_, column) => {
        const key = row * columns + column;
        const cell = byPlace.get(key);
        if (cell === undefined) return { key, value: null, strength: null };
        return {
          key,
          value: cell.value,
          strength: cell.max > 0 ? clamp01(cell.value / cell.max) : 0,
        };
      }),
    }));
  });
}
