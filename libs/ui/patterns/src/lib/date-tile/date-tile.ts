import {
  ChangeDetectionStrategy,
  Component,
  ViewEncapsulation,
  input,
} from '@angular/core';

/**
 * `upcoming` — still ahead: the shop's accent ink on its accent wash.
 * `past` — a memory: the control fill, the quiet ink (a history where
 * every row shouts has no upcoming visit). `hollow` — it did not happen
 * (cancelled, no-show): no fill, a hairline ring, the quiet ink.
 */
export type UiDateTileTone = 'upcoming' | 'past' | 'hollow';
/** 44 · 52 — the house ladder's `regular` and `large` rungs. A local union: patterns cannot import `UiControlSize`. */
export type UiDateTileControlSize = 'regular' | 'large';

/**
 * THE DATE TILE — a visit's stamp: the day over the word the section above
 * does not already say («пт» under a month section, «септ.» under a year
 * one), in a square on the control ladder. Promoted from the client app's
 * visit list so the staff history and «Моите часове» stamp their rows alike.
 *
 * Not `ui-date-badge`: that is a calendar grid's day — a number, a
 * selection disc, an events dot — sized by its grid. This is a captioned
 * stamp at the leading edge of a row.
 *
 * Decorative (`aria-hidden`): the row's own name carries the date in
 * words. The consumer passes the words; the tile formats nothing.
 */
@Component({
  selector: 'ui-date-tile',
  template: `
    <span class="ui-date-tile__caption">{{ uiCaption() }}</span>
    <span class="ui-date-tile__day">{{ uiDay() }}</span>
  `,
  styleUrl: './date-tile.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Unscoped like every pattern: `.ui-date-tile__*` is the styling contract.
  encapsulation: ViewEncapsulation.None,
  host: {
    class: 'ui-date-tile',
    'aria-hidden': 'true',
    '[attr.data-tone]': 'uiTone()',
    '[attr.data-control-size]': 'uiControlSize()',
  },
})
export class UiDateTile {
  /** The day of the month — «4». */
  readonly uiDay = input.required<string | number>();
  /** The word over the day: whatever the section does not already say. */
  readonly uiCaption = input.required<string>();
  readonly uiTone = input<UiDateTileTone>('past');
  readonly uiControlSize = input<UiDateTileControlSize>('regular');
}
