import {
  ChangeDetectionStrategy,
  Component,
  ViewEncapsulation,
  input,
} from '@angular/core';

/** What a fleck is cut as: a 6 pt dot, a 4 × 12 bar, a 12 pt four-point spark. */
export type UiOccasionFleckShape = 'dot' | 'bar' | 'spark';

/** The two inks, both at full strength: white and near-black. */
export type UiOccasionFleckInk = 'light' | 'dark';

/** One mark of the fixed map. */
export interface UiOccasionFleck {
  readonly shape: UiOccasionFleckShape;
  readonly ink: UiOccasionFleckInk;
  /** Its CENTRE, in percent of the band's inline size, from the leading edge. */
  readonly x: number;
  /** Its centre, in percent of the band's block size, from the top. */
  readonly y: number;
  /** Degrees. A bar's angle; a spark's tilt; nothing to a dot. */
  readonly turn: number;
  /** Stays in a container narrower than 22.5rem: a corner's, or one of the four nearest the trailing edge. */
  readonly kept: boolean;
}

/**
 * THE MAP. Fourteen marks over the WHOLE band, in percent so the map
 * scales with the band: six along the top, two in the space past the
 * title, six along the foot. It is read as a path (along the top, down
 * the trailing edge, back along the foot) and the inks alternate along
 * it, so no edge and no corner is all one ink. The bars stand at four
 * angles.
 *
 * The two rows stand clear of the title's row by construction (a mark's
 * centre is within 17 % of an edge and its half-height is 6 of the
 * band's 96), and what a long title still reaches it covers: the text
 * column paints the band's own colour behind its box.
 *
 * `kept` marks the eight a narrow band keeps: the four corners' and the
 * four nearest the trailing edge that no title can reach, four of each
 * ink. Beside the title's end stand a spark and a bar, never a dot: a
 * dot after «34 г.» reads as punctuation.
 */
export const UI_OCCASION_FLECKS: readonly UiOccasionFleck[] = [
  { shape: 'dot', ink: 'light', x: 4.5, y: 16, turn: 0, kept: true },
  { shape: 'bar', ink: 'dark', x: 19, y: 13, turn: 38, kept: false },
  { shape: 'spark', ink: 'light', x: 37, y: 15, turn: 0, kept: false },
  { shape: 'dot', ink: 'dark', x: 56, y: 12, turn: 0, kept: false },
  { shape: 'bar', ink: 'light', x: 73, y: 15, turn: -24, kept: true },
  { shape: 'spark', ink: 'dark', x: 93.5, y: 15, turn: 12, kept: true },
  { shape: 'spark', ink: 'light', x: 88, y: 39, turn: -8, kept: false },
  { shape: 'bar', ink: 'dark', x: 95.5, y: 58, turn: 74, kept: true },
  { shape: 'dot', ink: 'light', x: 94, y: 84, turn: 0, kept: true },
  { shape: 'bar', ink: 'dark', x: 80, y: 84, turn: 38, kept: true },
  { shape: 'dot', ink: 'light', x: 64, y: 85, turn: 0, kept: true },
  { shape: 'spark', ink: 'dark', x: 46, y: 83, turn: -10, kept: false },
  { shape: 'dot', ink: 'light', x: 27, y: 86, turn: 0, kept: false },
  { shape: 'bar', ink: 'dark', x: 5.5, y: 83, turn: 112, kept: true },
];

/**
 * THE OCCASION BAND — a moment said in colour: «Рожден ден днес» as a
 * solid accent band, the occasion's glyph on a white disc at its leading
 * edge, the title in the display face beside it, a static scatter of
 * flecks over the rest (client card, revision 3 §3.4). A moment is a
 * banner, never a capsule in a row (owner, 2026-09-29: "it should be like
 * a banner or some colourful card so it's instantly recognisable").
 *
 * Two lives. STANDALONE it is a card of its own, fully rounded and
 * lifted, and the consumer gives it `role="note"`. INSIDE A TICKET it is
 * the first child of `[uiCouponCard]`, which finds it by this class
 * (`contentChild(UiOccasionBand)`), stamps `data-occasion` on itself,
 * squares the band's foot and moves its own tear and notches to the seam
 * under it.
 *
 * `uiTitle` is the occasion in a few words, on ONE line; a title the band
 * cannot hold ends in an ellipsis, it never wraps. It is the only text on
 * the orange, and it is a display figure (24/700): small words do not
 * stand on the solid accent, so a fact that belongs to the occasion goes
 * in the title («Рожден ден · 34 г.») or on the ticket's white body.
 *
 * Slots (projected, so this pattern imports no control):
 * `[uiOccasionGlyph]`, a `ui-icon` on the white disc; `[uiOccasionDetail]`,
 * ONE `span[uiBadge uiOnMedia]` under the title, for a consumer that
 * needs it.
 *
 * THE FLECKS are fourteen shapes in two inks at full strength, white and
 * near-black, on a fixed map (`UI_OCCASION_FLECKS`): no motion, no
 * gradient, no emoji, nothing random, so the band is the same band every
 * time it is seen. They lie in a layer UNDER the text column, which
 * paints the band's colour behind its own box: the title's row is solid
 * whatever the title's length. A NARROW band (the column of a sheet
 * under 22.5rem, the 330 pt phone's) keeps eight of them (the corners'
 * and the four nearest the trailing edge), never none, and sets its
 * title a step smaller, still a display figure, so «Рожден ден · 34 г.»
 * stays whole. Decoration to a reader: the layer is `aria-hidden`.
 *
 * Custom properties, each read with its default at the use site:
 * `--ui-occasion-band-height` (6rem), `--ui-occasion-band-surface`
 * (`--sys-color-accent`). Inside a ticket the height is set on the
 * TICKET, which places its tear by it; the band inherits it.
 */
@Component({
  selector: 'ui-occasion-band',
  template: `
    <span class="ui-occasion-band__flecks" aria-hidden="true">
      @for (fleck of flecks; track $index) {
        <span
          class="ui-occasion-band__fleck"
          aria-hidden="true"
          [attr.data-shape]="fleck.shape"
          [attr.data-ink]="fleck.ink"
          [attr.data-kept]="fleck.kept ? '' : null"
          [style.--ui-occasion-fleck-x]="fleck.x + '%'"
          [style.--ui-occasion-fleck-y]="fleck.y + '%'"
          [style.--ui-occasion-fleck-turn]="fleck.turn + 'deg'"
        ></span>
      }
    </span>
    <span class="ui-occasion-band__lead">
      <span class="ui-occasion-band__glyph" aria-hidden="true"
        ><ng-content select="[uiOccasionGlyph]"
      /></span>
      <span class="ui-occasion-band__lines">
        <span class="ui-occasion-band__title">{{ uiTitle() }}</span>
        <ng-content select="[uiOccasionDetail]" />
      </span>
    </span>
  `,
  styleUrl: './occasion-band.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Unscoped like every pattern: `.ui-occasion-band__*` is the styling contract.
  encapsulation: ViewEncapsulation.None,
  host: {
    class: 'ui-occasion-band',
  },
})
export class UiOccasionBand {
  /** The occasion, in a few words and on ONE line: «Рожден ден днес». */
  readonly uiTitle = input.required<string>();

  protected readonly flecks = UI_OCCASION_FLECKS;
}
