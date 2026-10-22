import {
  ChangeDetectionStrategy,
  Component,
  booleanAttribute,
  input,
  output,
} from '@angular/core';
import { UiBadge, UiMedal } from '@creativo/ui/controls';
import { UiFrameDirective } from '@creativo/ui/modifiers';
import { AchievementScope } from '../client-card.contracts';
import type { AchievementTileVm } from '../client-pages.vm';

/**
 * ONE MEDAL OF A GRID (client-card-revision-3 §2.3.2 AF, AL; §3.15) — a
 * family, an archived season or a «Последни» day, drawn by the DS's
 * `button[uiMedal]` at `large` in its RING (§3.8: the arc from the last
 * threshold won to the next, the rim numeral, the dashed silhouette, the
 * full ring of a family complete), with its title and caption, filling the
 * slot its grid gives it (≙ `.frame(maxWidth: .infinity)`), so the whole
 * tile is the target and a row of tiles shares one baseline.
 *
 * The host IS the list item: a grid is a list of medals, and a component
 * element always sits between the list and the button it renders, so the
 * tiles go straight into `ui-grid role="list"`; the DS lays the host on
 * the row's shared tracks (medal.css, ONE ROW, SHARED TRACKS).
 *
 * The one binding of a tile's VM to the medal, for every page that draws
 * one: the numeral rule, the art, the title, the caption, the ring's value
 * and the sentence are the presenter's; this adds only the one decoration
 * the DS places — the quiet «Ново» over the ring for a level earned since
 * the previous visit (never a celebration on a staff surface), in the band
 * its own row makes for it. It is decoration: the medal's sentence already
 * says «ново». A day group counts its other levels once, on its title
 * («Лятна събота +1»), never again on the disc; its medal is the DS's
 * stack (`uiStacked`: a second ring behind the face), so it never reads
 * as one family beside its neighbours — a tap opens the day's levels, not
 * one family's detail.
 *
 * `caption` is the glance's: its three named medals stand without a
 * caption (`[caption]="false"`), every grid keeps it.
 */
@Component({
  selector: 'lib-achievement-tile',
  imports: [UiBadge, UiFrameDirective, UiMedal],
  template: `
    @let vm = tile();
    <button
      uiMedal
      class="achievement-tile__medal"
      uiControlSize="large"
      uiFrame
      uiFrameMaxWidth="infinity"
      [uiState]="vm.medal.state"
      [uiIcon]="vm.medal.icon"
      [uiSrc]="vm.medal.src"
      [uiMonogram]="vm.medal.monogram"
      [uiLevel]="vm.medal.level"
      [uiTitle]="vm.medal.title"
      [uiCaption]="caption() ? vm.medal.caption : null"
      [uiValue]="vm.medal.value"
      [uiValueText]="vm.medal.valueText"
      [uiStacked]="vm.opens?.achievementScope === AchievementScope.Day"
      [uiLabel]="vm.medal.accessibleName"
      [attr.data-testid]="testId()"
      (click)="open.emit(vm)"
    >
      @if (vm.medal.isNew) {
        <span
          uiMedalMarker
          uiBadge
          uiTone="accent"
          aria-hidden="true"
          [attr.data-testid]="testId() + '-marker'"
          >{{ newWord() }}</span
        >
      }
    </button>
  `,
  styleUrl: './achievement-tile.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { role: 'listitem' },
})
export class AchievementTile {
  readonly tile = input.required<AchievementTileVm>();
  /** The medal's `data-testid` — also the origin the editor focuses when it comes back. */
  readonly testId = input.required<string>();
  /** «Ново», in the card's language. */
  readonly newWord = input.required<string>();
  /** The caption under the title («23/25 до III»); `false` draws the ring and its title alone (the glance). */
  readonly caption = input(true, { transform: booleanAttribute });
  /** A tap: the parent opens the family's detail, or the scope the tile names. */
  readonly open = output<AchievementTileVm>();

  protected readonly AchievementScope = AchievementScope;
}
