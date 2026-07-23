import { ChangeDetectionStrategy, Component } from '@angular/core';
import { UiGrid, UiStack } from '@creativo/ui/layout';
import { UiTextDirective } from '@creativo/ui/modifiers';
import { ScDemo } from '../../../shared/demo';
import { ScPage } from '../../../shared/page';

@Component({
  selector: 'cr-grid-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ScDemo, ScPage, UiGrid, UiStack, UiTextDirective],
  templateUrl: './grid.page.html',
  styleUrl: './grid.page.css',
})
export class GridPage {
  protected readonly columnCounts = [2, 3, 4];
  /** 12 cells divide evenly into 2 / 3 / 4 tracks — every sample ends on a full row. */
  protected readonly cells = Array.from({ length: 12 }, (_, i) => i);
  protected readonly adaptiveCells = Array.from({ length: 8 }, (_, i) => i);
}
