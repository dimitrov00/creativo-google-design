import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  ViewEncapsulation,
  contentChild,
  inject,
  input,
} from '@angular/core';
import { UiOccasionBand } from './occasion-band';

/**
 * THE COUPON CARD — a ticket (owner, 2026-09-16: "I like the look of the
 * foodpanda coupon with the Use now and the whole look of the card — copy
 * it"). One offer, read as a stub: the glyph the host projects on a disc
 * at the leading edge, the offer's VALUE as the figure over its name, the
 * code beside the figure in the mono face, then a dashed tear line with a
 * notch cut into each edge, and beneath it the offer's conditions in a
 * chip against the one call to action, «Use now».
 *
 * WHITE PAPER, ONE ORANGE (revision 3 §3.4; owner, 2026-09-29: "why not
 * use the main accent one — this red I don't like"). The ticket is a
 * lifted white card, and its colour is the accent itself: the glyph on an
 * accent-wash disc, the figure at display size (24/700), which is what
 * lets a figure be orange at all. The name and every other word are ink.
 * When there is no figure the NAME is the headline, a step larger.
 *
 * Two lives. ON A BUTTON it is an OFFER: the whole card is the control,
 * the call is its label rather than a second control, and the consumer
 * marks it `uiInteractive` for the one hover/press grammar, so it reads to
 * a screen reader as one thing to press. ON AN `article`, `uiApplied`, it
 * is a ticket ON THE BILL (owner, later that day: "make the applied
 * discounts look like the coupons"): nothing to press but what it
 * projects — a badge stamped on its glyph's corner (`[uiCouponBadge]`, a
 * check) and a real button where the call stood (`[uiCouponAction]`,
 * «Премахни»), so a whole card never removes a discount by accident.
 *
 * `uiValue` is the figure that matters to whoever is looking (on a bill,
 * what the offer takes off it; none when the name already says it);
 * `uiCode` the code it opens by, when it has
 * one; `uiDetail` the rule and whether it stacks. The glyph is projected
 * (`[uiCouponGlyph]`) so this pattern owes nothing to the icon control,
 * and a host may put a picture there instead. `uiTestId` stamps the
 * value, the code and the detail for a test.
 *
 * THE CALL is dress, projected: every ticket that offers something wears
 * the SAME pill in `[uiCouponAction]`, a decorative
 * `span[uiButton uiButtonStyle="borderedProminent" uiControlSize="small"
 * aria-hidden="true"]` (the house form for button chrome inside a larger
 * tappable surface). The ticket is the control; the pill is what it
 * wears. A ticket that offers nothing where it stands (a voucher, a
 * ticket in the wallet) projects none. The ticket writes no call of its
 * own: the written `uiAction` went with its last caller (revision 3
 * §3.4, W4).
 *
 * A TICKET WITHOUT CONDITIONS (2026-10-06, the revision 3 review): no
 * chip and nothing projected into `[uiCouponAction]` —
 * a reward held with no validity, a voucher that never expires — has no
 * foot to draw, so the foot, the tear and the notches go and the ticket
 * is a plain lifted paper. The foot element stays in the template (it is
 * the slot a host projects into) and holds no placeholder; the sheet
 * reads it with `:has()`, since what a host projects is not the ticket's
 * to know. Under an occasion band the seam keeps its perforation: the
 * band is still torn off the paper.
 *
 * WITH AN OCCASION (`ui-occasion-band` as the first child) the ticket is a
 * moment: the band over the paper, the tear and the notches on the SEAM
 * between them, the foot without a tear of its own, and no glyph disc in
 * the body, because the band's disc carries the glyph. The badge, when a
 * host projects one, stands beside the figure instead.
 *
 * THE PAPER is a part of its own (`.ui-coupon-card__paper`), behind the
 * content: it takes the fill, the corner and the notch mask, so the HOST
 * is free to carry the lift as `filter: drop-shadow()`, which follows the
 * notched silhouette where a `box-shadow` would be cut away by the mask.
 * The notches are a mask, so the card sits on any ground without a
 * painted patch pretending to be it; the tear runs a foot's height from
 * the bottom, so a long name wraps above it and the notches never drift.
 * The focus ring and the press layer wear the same mask, inside the box.
 *
 * Custom properties: `--ui-coupon-card-surface` (the paper and the
 * badge's ring; the elevated surface), `--ui-coupon-card-shadow` (ONE
 * shadow, for `drop-shadow()`), `--ui-coupon-card-foot`,
 * `--ui-coupon-card-notch`, `--ui-coupon-card-tear` (where the tear runs,
 * from the top).
 */
@Component({
  selector: 'button[uiCouponCard], article[uiCouponCard]',
  template: `
    <span class="ui-coupon-card__paper" aria-hidden="true"></span>
    <ng-content select="ui-occasion-band" />
    <span class="ui-coupon-card__head">
      <span class="ui-coupon-card__glyph" aria-hidden="true">
        <ng-content select="[uiCouponGlyph]" />
        <span class="ui-coupon-card__badge"
          ><ng-content select="[uiCouponBadge]"
        /></span>
      </span>
      <span class="ui-coupon-card__lines">
        <span class="ui-coupon-card__title">{{ uiTitle() }}</span>
        @if (uiValue() || uiCode()) {
          <span class="ui-coupon-card__figures">
            @if (uiValue(); as value) {
              <span
                class="ui-coupon-card__value"
                [attr.data-testid]="testIdOf('value')"
                >{{ value }}</span
              >
            }
            @if (uiCode(); as code) {
              <span
                class="ui-coupon-card__code"
                [attr.data-testid]="testIdOf('code')"
                >{{ code }}</span
              >
            }
          </span>
        }
      </span>
    </span>
    <span class="ui-coupon-card__foot">
      @if (uiDetail(); as detail) {
        <span
          class="ui-coupon-card__detail"
          [attr.data-testid]="testIdOf('detail')"
          >{{ detail }}</span
        >
      }
      <ng-content select="[uiCouponAction]" />
    </span>
  `,
  styleUrl: './coupon-card.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Unscoped like every pattern: `.ui-coupon-card__*` is the styling
  // contract, and the host element itself must take the card's class.
  encapsulation: ViewEncapsulation.None,
  host: {
    class: 'ui-coupon-card',
    '[attr.type]': "isButton ? 'button' : null",
    '[attr.data-applied]': "uiApplied() ? '' : null",
    '[attr.data-valued]': "uiValue() ? '' : null",
    '[attr.data-occasion]': "occasion() ? '' : null",
    '[attr.data-unavailable]': "uiUnavailable() ? '' : null",
    '[attr.disabled]': "isButton && uiUnavailable() ? '' : null",
    '[attr.aria-disabled]': "!isButton && uiUnavailable() ? 'true' : null",
  },
})
export class UiCouponCard {
  /** A button is an offer; an article, a ticket on the bill. */
  readonly isButton =
    inject<ElementRef<HTMLElement>>(ElementRef).nativeElement.tagName ===
    'BUTTON';

  /** What the offer is called. */
  readonly uiTitle = input.required<string>();
  /**
   * The figure that matters where the card is read — what it takes off the
   * bill. `null` when there is no figure to print: a coupon whose NAME
   * already says its rule («Безплатно подстригване», a free service) is
   * the whole offer in one line, and a second line under it would say the
   * same thing twice. Then the head is the name alone (and the code, if
   * any).
   */
  readonly uiValue = input.required<string | null>();
  /** The code the offer opens by, when it has one. */
  readonly uiCode = input<string | null>(null);
  /** The offer's conditions — its rule, whether it stacks — in the chip. */
  readonly uiDetail = input<string | null>(null);
  /** On the bill already: stamped, and pressed nowhere but on what it projects. */
  readonly uiApplied = input(false);
  /**
   * Cannot be used with what is on the bill — an exclusive offer beside
   * another, any offer beside an exclusive one. MUTED, never a warning
   * (HIG, the service card's rule of 2026-07-30): the whole card
   * desaturates, its ink drops to secondary, the button form is disabled,
   * and the host projects the "cannot combine" glyph into the same badge
   * slot the check takes when applied. One slot, three states.
   */
  readonly uiUnavailable = input(false);
  /** Stamps `<id>-value`, `<id>-code` and `<id>-detail` on the parts, for a test. */
  readonly uiTestId = input<string | null>(null);

  /** The occasion band, when the host projected one: the ticket is a moment. */
  protected readonly occasion = contentChild(UiOccasionBand);

  protected testIdOf(part: 'value' | 'code' | 'detail'): string | null {
    const id = this.uiTestId();
    return id ? `${id}-${part}` : null;
  }
}
