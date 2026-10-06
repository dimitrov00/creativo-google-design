import {
  ChangeDetectionStrategy,
  Component,
  ViewEncapsulation,
  booleanAttribute,
  input,
} from '@angular/core';

/** The parts `uiTestId` stamps. */
type UiPassCardPart = 'figure' | 'holder' | 'detail' | 'state';

/**
 * THE PASS CARD — what a client holds with the shop, drawn as the card in
 * their wallet (client card, revision 3 §3.5; owner, 2026-09-29: "could be
 * made like a WALLET"). One per page, and the page's one orange slab.
 *
 * TWO PARTS INSIDE ONE RADIUS. The FIELD is the solid accent, the same
 * orange in both themes: the shop's mark and ONE plate on its top row,
 * the balance written out at its foot («371 точки»), the figure and its
 * unit on one baseline. Only display sizes stand on the orange (the
 * accent law, rule 4): a white figure at 36/800 and a white unit at
 * 20/700 are large text, a small white word is not. The FOOT is the
 * elevated surface (white in light, the lighter surface in dark) and
 * carries what is small, in ordinary ink: the holder over a quiet line,
 * and the state beside the holder when it says something.
 *
 * THE RATIO IS A FLOOR. The card is as wide as its column and at least
 * an ISO card tall (1.586): the field takes 62 % of that height, the foot
 * 38 %. A holder on two lines grows the FOOT, and the card by the line;
 * the field never gives way. When the holder and the state do not fit
 * one line (a long name, a narrow phone) the state steps under the quiet
 * line. Only the HOLDER decides that: the quiet line runs under both and
 * is as wide as the foot, so two clients whose names are as long have
 * the same card whatever month each of them first came in. Nothing on
 * the card is ever cut.
 *
 * THE MOTIF is two discs of the field's own ink at 10 %, in the field's
 * trailing 40 %, clipped by the field: no gradient, no picture. The
 * balance keeps to the leading 60 %, so no white figure ever lies over a
 * disc and its contrast is the solid's. A balance that cannot fit there
 * puts its unit on a line of its own.
 *
 * Static: `role="group"`, no `button` form, no motion, the figure never
 * counts up. `uiLabel` is the ONE accessible name, in the consumer's
 * words («Карта за лоялност: Георги Петров, Злато, 371 точки за размяна,
 * клиент от март 2025 г.»); the field and the holder's lines are
 * presentational inside it. The STATE line is not: the name does not
 * carry it, so it is read after the name, as the group's content.
 *
 * Slots (projected, so this pattern imports no control):
 * `[uiPassMark]`, top-leading, the shop's `ui-logo` (drawn 20 tall, in
 * the field's ink); `[uiPassBadge]`, top-trailing, ONE plate, a
 * `span[uiBadge uiOnMedia]` (the tier): white, its ink near-black.
 *
 * `uiFrozen` desaturates the FIELD and changes nothing else: the values
 * stay, the foot stays, and the consumer's state line says «Замразено».
 *
 * Custom properties, each read with its default at the use site, so they
 * may be set on the card or on anything above it:
 * `--ui-pass-card-surface` (the field; `--sys-color-accent`),
 * `--ui-pass-card-ink` (the field's ink; `--sys-color-on-accent`),
 * `--ui-pass-card-foot` (the foot; `--sys-color-surface-elevated`),
 * `--ui-pass-card-motif` (the discs; the field's ink at 10 %).
 *
 * The card measures itself (`container-type: inline-size`), so it needs a
 * column to stand in: a block, a stack, a grid cell. It is never sized by
 * its own content.
 */
@Component({
  selector: 'ui-pass-card',
  template: `
    <span class="ui-pass-card__field" aria-hidden="true">
      <span class="ui-pass-card__motif" data-disc="major"></span>
      <span class="ui-pass-card__motif" data-disc="minor"></span>
      <span class="ui-pass-card__top">
        <span class="ui-pass-card__mark"
          ><ng-content select="[uiPassMark]"
        /></span>
        <span class="ui-pass-card__badge"
          ><ng-content select="[uiPassBadge]"
        /></span>
      </span>
      <span class="ui-pass-card__balance">
        <span
          class="ui-pass-card__figure"
          [attr.data-testid]="testIdOf('figure')"
          >{{ uiFigure() }}</span
        >
        @if (uiUnit(); as unit) {
          <span class="ui-pass-card__unit">{{ unit }}</span>
        }
      </span>
    </span>
    <span class="ui-pass-card__foot">
      @if (uiHolder() || uiDetail()) {
        <span class="ui-pass-card__lines" aria-hidden="true">
          @if (uiHolder(); as holder) {
            <span
              class="ui-pass-card__holder"
              [attr.data-testid]="testIdOf('holder')"
              >{{ holder }}</span
            >
          }
          @if (uiDetail(); as detail) {
            <span
              class="ui-pass-card__detail"
              [attr.data-testid]="testIdOf('detail')"
              ><span class="ui-pass-card__detail-line">{{ detail }}</span></span
            >
          }
        </span>
      }
      @if (uiState(); as state) {
        <span
          class="ui-pass-card__state"
          [attr.data-testid]="testIdOf('state')"
          >{{ state }}</span
        >
      }
    </span>
  `,
  styleUrl: './pass-card.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Unscoped like every pattern: `.ui-pass-card__*` is the styling contract.
  encapsulation: ViewEncapsulation.None,
  host: {
    class: 'ui-pass-card',
    role: 'group',
    '[attr.aria-label]': 'uiLabel()',
    '[attr.data-frozen]': "uiFrozen() ? '' : null",
  },
})
export class UiPassCard {
  /** The balance, pre-formatted: «371», «1 250», «−40». The DS formats no number. */
  readonly uiFigure = input.required<string>();
  /** «точки» — on the figure's baseline, a step smaller. */
  readonly uiUnit = input<string | null>(null);
  /** Whose card it is: «Георги Петров». A second line grows the foot, never shrinks the field. */
  readonly uiHolder = input<string | null>(null);
  /** The quiet line under the holder: «Клиент от март 2025 г.». */
  readonly uiDetail = input<string | null>(null);
  /** The state line, on the holder's line, trailing; only when it says something («40 т. изтичат на 31.12»). */
  readonly uiState = input<string | null>(null);
  /** A frozen card: the FIELD desaturates, nothing else changes. */
  readonly uiFrozen = input(false, { transform: booleanAttribute });
  /** The accessible name of the whole card, one sentence. */
  readonly uiLabel = input.required<string>();
  /** Stamps `<id>-figure`, `<id>-holder`, `<id>-detail` and `<id>-state` on the parts, for a test. */
  readonly uiTestId = input<string | null>(null);

  protected testIdOf(part: UiPassCardPart): string | null {
    const id = this.uiTestId();
    return id ? `${id}-${part}` : null;
  }
}
