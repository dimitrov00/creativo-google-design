import {
  ChangeDetectionStrategy,
  Component,
  ViewEncapsulation,
  input,
  output,
} from '@angular/core';
import { UiGrid, UiStack } from '@creativo/ui/layout';
import { ServiceCardComponent } from './service-card.component';
import type { ServiceCoverGrid, ServiceCoverTile } from './service-cover-grid';

/**
 * THE SERVICE PICKER'S GRID, ONCE (owner, 2026-11-06: "services should look
 * the same as the others, the grid view, made reusable"): cover cards three
 * across, the name under each cover and its variant under that, a ring that
 * turns to a ✓ — the schedule search's service values, the visit sheet's
 * «Добави услуга» and the rhythm rule's «Услуги» draw THIS, never their own
 * copy. It holds no state: the picker lays its tiles out (`coverRowsOf`),
 * says which are ticked, and is handed the pressed tile back whole.
 *
 * A press never takes the focus from a search field that is being typed in
 * (the dock's field keeps its caret and its keyboard while cards are ticked).
 */
@Component({
  selector: 'cr-service-cover-grid',
  imports: [ServiceCardComponent, UiGrid, UiStack],
  template: `
    <ui-stack uiSpacing="comfortable">
      @for (grid of uiGrids(); track grid.id) {
        <ui-grid
          [uiColumns]="3"
          uiSpacing="regular"
          [attr.data-testid]="uiGridTestId()"
          [attr.data-service]="grid.id"
        >
          @for (tile of grid.tiles; track tile.id) {
            <cr-service-card
              [uiServiceId]="tile.serviceId"
              [uiName]="tile.name"
              [uiMeta]="tile.meta"
              [uiCoverUrl]="tile.coverSrc"
              uiCaption="below"
              uiRatio="3 / 4"
              [uiSelectedCount]="tile.checked ? 1 : 0"
              [uiShowDetails]="false"
              uiSelectionIndicator="always"
              [attr.data-tile]="tile.id"
              [attr.data-checked]="tile.checked ? '' : null"
              [attr.data-testid]="tile.testId ?? null"
              (mousedown)="$event.preventDefault()"
              (click)="uiPicked.emit(tile)"
            />
          }
        </ui-grid>
      }
    </ui-stack>
  `,
  styles: `
    .cr-service-cover-grid {
      display: block;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Unscoped, like the card it lays out: `.cr-*` is the styling contract.
  encapsulation: ViewEncapsulation.None,
  host: { class: 'cr-service-cover-grid' },
})
export class ServiceCoverGridComponent<T extends ServiceCoverTile> {
  /** The tiles as grids, in order (`coverRowsOf`). */
  readonly uiGrids = input.required<readonly ServiceCoverGrid<T>[]>();
  /** A test hook for each grid, when the picker names one. */
  readonly uiGridTestId = input<string | null>(null);
  /** A card was pressed — the tile it draws, with the picker's own fields. */
  readonly uiPicked = output<T>();
}
