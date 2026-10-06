import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  ViewEncapsulation,
  afterNextRender,
  booleanAttribute,
  computed,
  effect,
  inject,
  input,
  isDevMode,
} from '@angular/core';
import { UiIcon, type UiIconName } from '@creativo/ui/icons';
import { UiGauge } from '../gauge/gauge';

/**
 * Four states, told apart by FORM, and no hidden fifth: every published
 * medal shows its requirement. `notStarted`: nothing towards it yet (a
 * grey silhouette of the real art in a DASHED ring, never a padlock);
 * `inProgress`: on the way to the first level (a solid track and the
 * tint's arc round an unfilled disc); `earned`: at least one level won
 * (the filled disc, the rim numeral, the arc towards the NEXT level);
 * `complete`: every level won, or a one-off earned (the filled disc in a
 * FULL ring).
 */
export type UiMedalState = 'notStarted' | 'inProgress' | 'earned' | 'complete';
/**
 * 44 · 52 · 112: the house ladder's `regular` and `large` rungs and the
 * portrait rung (`--control-size-extraLarge`, the medal as the face of its
 * own page). The size names the DISC; the ring round it makes the medal
 * 52 · 64 · 128. A local union: patterns cannot import `UiControlSize`.
 */
export type UiMedalControlSize = 'regular' | 'large' | 'extraLarge';

const clamp01 = (value: number): number =>
  Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;

/**
 * THE MEDAL: one achievement family, read at a glance: a disc with its
 * art inside a progress RING, the highest level won on the ring's rim,
 * and, in grids, its title and one caption under it. Named "medal" in
 * code: M3's badge is a notification dot and `span[uiBadge]` is a status
 * capsule.
 *
 * THE RING (revision 3, R2-G) is the gauge's (`ui-gauge`,
 * `circularCapacity`): a quiet track and the tint's arc, from 12 o'clock,
 * clockwise. It is a METER, drawn settled: forty medals never perform on
 * mount. Its value is `uiValue`, 0 … 1 from the last threshold won to the
 * next one: «Фейд» at 23 with II = 10 and III = 25 draws 13 of 15, 87 %.
 * Not started it is the track alone, dashed; complete it is full,
 * whatever `uiValue` says. The ring's box is kept in every state, so a row
 * of medals shares one line whatever each has won.
 *
 * The disc's face, first found wins: `uiSrc` (owner art, a barber's face,
 * a service's or a shop's cover), then `uiMonogram` («Ф», a service family
 * without a cover), then `uiIcon` (the registry emblem). The emblem takes
 * the icon ladder's rung for the disc (20 in the 44, 24 in the 52) and,
 * on the portrait rung, the disc's own scale (half of it, the monogram's
 * rule at every size). Art of any ratio fills the disc exactly, cropped
 * to it.
 *
 * THE NUMERAL RULE: `uiLevel` is the highest EARNED level («II») and is
 * drawn only on a medal with a level won; a target lives in words, in
 * `uiCaption` («23/25 до III»), and `uiTitle` never carries a numeral.
 * The chip stands at 6 o'clock ON the ring, cut out of it by a ring of
 * the ground. A one-off passes no level and wears no chip.
 *
 * States differ by FORM, never by hue alone: a dashed ring, an arc, a
 * filled disc, a full ring. A disc won fills with `--ui-medal-tint` (the
 * accent) and draws its glyph in the on-accent ink; FULL COLOUR MEANS
 * EARNED, so art short of earned stays grey, fainter while not started,
 * and is never locked away.
 *
 * THE GROUND. The accent arc reads 3.04:1 on white and 2.84:1 on grey: a
 * medal stands on a white or elevated card, on the sheet's surface or on
 * the stage's spotlight, never on a muted card nor inside a list group
 * (development warns). The chip's cut-out and the stack's are painted in
 * the ground's colour, `--ui-medal-stack-ring`: the surface, or the
 * elevated surface inside an elevated card and on a headline's stage
 * (the stylesheet says so itself); any other ground is the consumer's to
 * name.
 *
 * Two lives. `ui-medal` is an image (`role="img"`); `button[uiMedal]` opens
 * the family's detail, with the one hover/press grammar and a focus ring
 * round the whole tile. Either way ONE sentence names it (`uiLabel`): the
 * state, the level won and when, the caption in words, and «ново»; its
 * ring is presentational. The one decoration is the consumer's
 * `span[uiBadge]` (a pattern cannot import the badge control), and it
 * never covers the glyph: the «Ново» marker, projected `[uiMedalMarker]`,
 * stands OVER the ring, top-trailing, a tight step above it (a label's
 * spacing), in a band of its own. A row carrying one keeps the band over
 * all its medals, so the rings keep one top line, and ONLY that row does:
 * in a grid or a rail the tiles of one row share the ring's track, so a
 * grid of forty medals pays for a marker once, where it stands. A row of
 * medals alone says it is one with `data-medal-row`; a consumer writes no
 * rule for it. A count («3 нива», a day's levels) is words in
 * `uiCaption`, never a second mark.
 *
 * THE STACK. `uiStacked` draws several medals as ONE item (a day's
 * levels, a tap that opens their scope, not one family's detail): the
 * medal stands in front of a second one, which peeks out on the trailing
 * side by a tight step, cut out of it by a ring of the ground. The medal
 * behind wears the front disc's own fill, so a stack won is a pile of
 * medals won; short of that it is drawn in the extent's ink. It is form,
 * not a count: how many stays words in the caption and the sentence.
 *
 * ONE BASELINE. A medal is three tracks: the ring, the title, the
 * caption. With a title or a caption (the tile form, host `data-tile`) it
 * keeps the chip's room under the ring in every state, so a grid of mixed
 * states sets every title on one line, and the captions align PER ROW: a
 * tile takes its tracks from the row it sits in. The medal alone
 * (a headline, a ladder's row) is the ring's box and nothing more: the
 * chip hangs half its height under it, and whoever mounts it leaves that
 * room.
 */
@Component({
  selector: 'ui-medal, button[uiMedal]',
  imports: [UiIcon, UiGauge],
  template: `
    <span class="ui-medal__marker" aria-hidden="true"
      ><ng-content select="[uiMedalMarker]"
    /></span>
    <span class="ui-medal__figure" aria-hidden="true">
      <ui-gauge
        class="ui-medal__ring"
        aria-hidden="true"
        uiGaugeStyle="circularCapacity"
        [uiControlSize]="uiControlSize()"
        [uiValue]="ring()"
        [uiMin]="0"
        [uiMax]="1"
        [uiLabel]="uiLabel()"
        [uiValueText]="uiValueText() ?? ''"
        [attr.data-extent]="uiState() === 'notStarted' ? 'dashed' : null"
      />
      <span class="ui-medal__disc">
        @if (uiSrc(); as src) {
          <img
            class="ui-medal__art"
            [src]="src"
            alt=""
            loading="lazy"
            decoding="async"
          />
        } @else if (uiMonogram(); as monogram) {
          <span class="ui-medal__monogram">{{ monogram }}</span>
        } @else if (uiIcon(); as icon) {
          <ui-icon class="ui-medal__glyph" [uiName]="icon" />
        }
      </span>
      @if (level(); as level) {
        <span class="ui-medal__level">{{ level }}</span>
      }
    </span>
    @if (uiTitle(); as title) {
      <span class="ui-medal__title">{{ title }}</span>
    }
    @if (uiCaption(); as caption) {
      <span class="ui-medal__caption">{{ caption }}</span>
    }
  `,
  styleUrl: './medal.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Unscoped like every pattern: `.ui-medal__*` is the styling contract.
  encapsulation: ViewEncapsulation.None,
  host: {
    class: 'ui-medal',
    '[attr.role]': "isButton ? null : 'img'",
    '[attr.type]': "isButton ? 'button' : null",
    '[attr.aria-label]': 'uiLabel()',
    '[attr.data-state]': 'uiState()',
    '[attr.data-control-size]': 'uiControlSize()',
    '[attr.data-interactive]': "isButton ? '' : null",
    '[attr.data-tile]': "tile() ? '' : null",
    '[attr.data-stacked]': "uiStacked() ? '' : null",
  },
})
export class UiMedal {
  readonly uiState = input.required<UiMedalState>();
  /** The registry emblem (`loyalty.badge.*`); drawn when there is neither art nor a monogram. */
  readonly uiIcon = input<UiIconName | null>(null);
  /** Art: owner art, a barber's face, a service or shop cover. Wins. */
  readonly uiSrc = input<string | null>(null);
  /** «Ф»: a family without a cover. Wins over the emblem. */
  readonly uiMonogram = input<string | null>(null);
  /** The rim numeral: the highest EARNED level only («II»); `null` for a one-off. */
  readonly uiLevel = input<string | null>(null);
  /** Under the ring in grids; `null` draws the medal alone. */
  readonly uiTitle = input<string | null>(null);
  /** «23/25 до III» · «4.09» · «0/3 до I» · «Всички нива». */
  readonly uiCaption = input<string | null>(null);
  /** 0 … 1 from the last threshold won to the next: the ring's arc. `null` draws the track alone. */
  readonly uiValue = input<number | null>(null);
  /** The arc's reading in words («23 от 25 до ниво III»), for the ring's own meter. */
  readonly uiValueText = input<string | null>(null);
  readonly uiControlSize = input<UiMedalControlSize>('large');
  /** Several medals as one item (a day's levels): a second medal behind this one. Form only: the count stays in the words. */
  readonly uiStacked = input(false, { transform: booleanAttribute });
  /** One sentence: «Фейд, ниво II спечелено на 3 юни, 23 от 25 до ниво III, ново». */
  readonly uiLabel = input.required<string>();

  private readonly host =
    inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;

  /** A button opens the detail; anything else is an image. */
  protected readonly isButton = this.host.tagName === 'BUTTON';

  /** A level is won on an earned medal and on a complete one, nowhere else. */
  private readonly won = computed(() => {
    const state = this.uiState();
    return state === 'earned' || state === 'complete';
  });

  /** The numeral rule: a rim numeral only on a medal with a level won. */
  protected readonly level = computed(() =>
    this.won() ? this.uiLevel() : null,
  );

  /**
   * The ring's value. Not started there is nothing to draw (the gauge
   * dashes its track); complete it is full, whatever the value says; in
   * between it is the way to the next level, and no value is no arc.
   */
  protected readonly ring = computed(() => {
    switch (this.uiState()) {
      case 'notStarted':
        return 0;
      case 'complete':
        return 1;
      default:
        return clamp01(this.uiValue() ?? 0);
    }
  });

  /**
   * The tile form: words under the ring, as in a grid. There every state
   * keeps the same room above the words (the rim numeral's, won or not),
   * so the titles and captions of a row of medals share one baseline.
   */
  protected readonly tile = computed(
    () => !!this.uiTitle() || !!this.uiCaption(),
  );

  constructor() {
    if (isDevMode()) {
      let warned = false;
      effect(() => {
        if (warned || this.uiLevel() === null || this.won()) return;
        warned = true;
        console.warn(
          '[ui-medal] uiLevel is the highest EARNED level: a medal that is ' +
            `"${this.uiState()}" draws no rim numeral. Say the target in uiCaption.`,
        );
      });

      // THE GROUND: the accent arc is 2.84:1 on a grey tile or a grey
      // segment, under the 3:1 a graphic needs.
      afterNextRender(() => {
        const muted =
          this.host.closest('.ui-card')?.getAttribute('data-tone') === 'muted';
        const grouped = this.host.closest('.ui-list-group') !== null;
        if (!muted && !grouped) return;
        console.warn(
          `[ui-medal] a medal stands ${muted ? 'on a muted card' : 'inside a list group'}: ` +
            'its accent arc reads 2.84:1 on that grey. Put it on a white or ' +
            'elevated card, on the sheet’s surface or on a stage.',
        );
      });
    }
  }
}
