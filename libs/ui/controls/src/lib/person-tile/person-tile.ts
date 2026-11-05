import {
  ChangeDetectionStrategy,
  Component,
  ViewEncapsulation,
  input,
} from '@angular/core';
import { UiIcon } from '@creativo/ui/icons';
import { UiAvatar } from '../avatar/avatar';

/**
 * THE PERSON TILE — a person as a FACE over their name, centred, for a grid
 * of people (≙ the «People» row of Photos' search, the pinned conversations
 * of Messages). A face reads as a person before a word is read; a list row
 * reads as a setting. A grid of three on a phone (`ui-grid [uiColumns]="3"`)
 * holds a shop's barbers in one or two rows.
 *
 * ```html
 * <ui-grid [uiColumns]="3" uiSpacing="regular">
 *   <button uiPersonTile [uiSrc]="src" uiName="Иван Колев" [uiSelected]="false">
 *     Иван Колев
 *   </button>
 * </ui-grid>
 * ```
 *
 * The name is PROJECTED, so a marked run (`ui-marked-text`) reads in it; it
 * is centred, balanced over at most two lines («Стефан» / «Петров» in a
 * narrow column), and the button's accessible name. The face is decoration
 * beside it (`aria-hidden`), so a reader hears the name once.
 *
 * `uiSelected` says whether the tile is a choice: `null` (the default) is a
 * plain press — no mark; `false` an empty ring on the face's corner (one of
 * a set being ticked); `true` the accent check, and the accent ring round
 * the face, the way a service card in a grid says it is chosen. A choice
 * carries `aria-pressed`.
 */
@Component({
  selector: 'button[uiPersonTile]',
  imports: [UiAvatar, UiIcon],
  template: `
    <span class="ui-person-tile__face" aria-hidden="true">
      <ui-avatar uiControlSize="tile" [uiSrc]="uiSrc()" [uiName]="uiName()" />
      @if (uiSelected() !== null) {
        <span
          class="ui-person-tile__check"
          [attr.data-selected]="uiSelected() ? '' : null"
          ><ui-icon uiName="checklist.done"
        /></span>
      }
    </span>
    <span class="ui-person-tile__name"><ng-content /></span>
  `,
  styleUrl: './person-tile.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Unscoped like every control: `.ui-person-tile*` is the styling contract.
  encapsulation: ViewEncapsulation.None,
  host: {
    class: 'ui-person-tile',
    type: 'button',
    '[attr.data-selected]': "uiSelected() ? '' : null",
    '[attr.aria-pressed]': 'uiSelected()',
  },
})
export class UiPersonTile {
  /** The person's photo; `null` draws their monogram. */
  readonly uiSrc = input<string | null>(null);
  /** The person's name, for the monogram (the label is the projected text). */
  readonly uiName = input('');
  /** `null` — a plain press; `false`/`true` — a choice, unticked/ticked. */
  readonly uiSelected = input<boolean | null>(null);
}
