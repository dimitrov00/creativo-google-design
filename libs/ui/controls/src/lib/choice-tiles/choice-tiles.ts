import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  ViewEncapsulation,
  inject,
  input,
  output,
} from '@angular/core';
import { UiInteractiveDirective } from '@creativo/ui/modifiers';

export type UiChoiceTileSize = 'regular' | 'large' | 'wide';

/** One tile in a `ui-choice-tiles` grid. */
export interface UiChoiceTile {
  readonly id: string;
  /** The figure or word the tile is — «2,00 €», «Без». */
  readonly label: string;
  /** A quieter second line — the share, the sum a round-up adds. */
  readonly detail?: string;
  /**
   * How much of the grid the tile takes — a BENTO, not a row of equals
   * (owner, 2026-09-16): `regular` is one cell, `large` two by two for a
   * tile that carries two facts (a round-up's target and what it adds),
   * `wide` a full row for the one that is a different kind of thing
   * («Друга сума»). Cells pack densely, so order the tiles for the eye.
   */
  readonly size?: UiChoiceTileSize;
  /** Shown, not removed, and picks nothing (the menus' own rule). */
  readonly disabled?: boolean;
  /** The tile's `data-testid`, when a test needs to find it. */
  readonly testId?: string;
}

/**
 * THE CHOICE TILES — one option out of a few, laid out as a grid of tiles
 * rather than a column of rows (owner, 2026-09-15: "predefined tiles plus a
 * custom option … more Apple-like"). Apple Cash's quick amounts over the
 * keypad, the tip grids of Uber and Square: a figure per tile, its share
 * beneath, the chosen one washed and ringed in the accent.
 *
 * Semantics are a RADIO GROUP: `role="radiogroup"` on the grid, `role="radio"`
 * + `aria-checked` on every tile, the arrow keys moving the check the way
 * native radios do. The consumer owns the selection and answers `uiPicked`
 * with a new `uiSelectedId`, exactly like `ui-choice-menu`.
 *
 * Every tile takes the house `[data-interactive]` grammar, so hover, press
 * and focus read like every row and card in the app.
 */
@Component({
  selector: 'ui-choice-tiles',
  imports: [UiInteractiveDirective],
  template: `
    <div
      role="radiogroup"
      class="ui-choice-tiles__grid"
      [style.--ui-choice-tiles-columns]="uiColumns()"
      [attr.aria-label]="uiLabel() || null"
    >
      @for (tile of uiTiles(); track tile.id) {
        <button
          type="button"
          role="radio"
          class="ui-choice-tile"
          uiInteractive
          [attr.aria-checked]="tile.id === uiSelectedId()"
          [attr.data-selected]="tile.id === uiSelectedId() ? '' : null"
          [attr.data-size]="tile.size ?? 'regular'"
          [attr.data-tile-id]="tile.id"
          [attr.data-testid]="tile.testId ?? null"
          [disabled]="tile.disabled ?? false"
          (click)="pick(tile)"
          (keydown)="onKeydown($event)"
        >
          <span class="ui-choice-tile__label">{{ tile.label }}</span>
          @if (tile.detail) {
            <span class="ui-choice-tile__detail">{{ tile.detail }}</span>
          }
        </button>
      }
    </div>
  `,
  styleUrl: './choice-tiles.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Unscoped, like every DS composition: `.ui-*` is the styling contract.
  encapsulation: ViewEncapsulation.None,
  host: { class: 'ui-choice-tiles' },
})
export class UiChoiceTiles {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  readonly uiTiles = input.required<readonly UiChoiceTile[]>();
  readonly uiSelectedId = input<string | null>(null);
  /** The group's accessible name — what the choice is OF. */
  readonly uiLabel = input('');
  /** Cells across. Three for a plain grid; four makes room for a bento of large and regular tiles. */
  readonly uiColumns = input(3);
  readonly uiPicked = output<string>();

  protected pick(tile: UiChoiceTile): void {
    if (tile.disabled) return;
    this.uiPicked.emit(tile.id);
  }

  /** Arrow keys on a tile move the check through the enabled tiles, wrapping — native radios. */
  protected onKeydown(event: KeyboardEvent): void {
    const step =
      event.key === 'ArrowRight' || event.key === 'ArrowDown'
        ? 1
        : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
          ? -1
          : 0;
    if (step === 0) return;
    const tiles = this.uiTiles().filter((tile) => !tile.disabled);
    if (tiles.length === 0) return;
    const current = tiles.findIndex((tile) => tile.id === this.uiSelectedId());
    const next = tiles[(current + step + tiles.length) % tiles.length];
    if (next === undefined) return;
    event.preventDefault();
    this.uiPicked.emit(next.id);
    // Matched by dataset, not by a selector: an id is the consumer's own
    // string and `CSS.escape` is not everywhere a test runs.
    Array.from(
      this.host.nativeElement.querySelectorAll<HTMLElement>('[data-tile-id]'),
    )
      .find((tile) => tile.dataset['tileId'] === next.id)
      ?.focus();
  }
}
