import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  ViewEncapsulation,
  inject,
  input,
} from '@angular/core';

/**
 * THE COUPON CARD — a ticket (owner, 2026-09-16: "I like the look of the
 * foodpanda coupon with the Use now and the whole look of the card — copy
 * it"). One offer, read as a stub: the glyph the host projects at the
 * leading edge, the offer's name over its VALUE with the code beside it in
 * the mono face, then a dashed tear line with a notch cut into each edge,
 * and beneath it the offer's conditions in a chip against the one call to
 * action, «Use now».
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
 * what the offer takes off it); `uiCode` the code it opens by, when it has
 * one; `uiDetail` the rule and whether it stacks; `uiAction` the written
 * call. The glyph is projected (`[uiCouponGlyph]`) so this pattern owes
 * nothing to the icon control, and a host may put a picture there instead.
 * `uiTestId` stamps the value, the code and the detail for a test.
 *
 * The notches are cut with a mask, so the card sits on any ground without
 * a painted patch pretending to be it; the tear line is fixed a foot's
 * height from the bottom, so a long name wraps above it and the notches
 * never drift. Focus rings INSIDE the box for the same reason — an outline
 * would be masked away with the notches.
 */
@Component({
  selector: 'button[uiCouponCard], article[uiCouponCard]',
  template: `
    <span class="ui-coupon-card__head">
      <span class="ui-coupon-card__glyph" aria-hidden="true">
        <ng-content select="[uiCouponGlyph]" />
        <span class="ui-coupon-card__badge"
          ><ng-content select="[uiCouponBadge]"
        /></span>
      </span>
      <span class="ui-coupon-card__lines">
        <span class="ui-coupon-card__title">{{ uiTitle() }}</span>
        <span class="ui-coupon-card__figures">
          <span
            class="ui-coupon-card__value"
            [attr.data-testid]="testIdOf('value')"
            >{{ uiValue() }}</span
          >
          @if (uiCode(); as code) {
            <span
              class="ui-coupon-card__code"
              [attr.data-testid]="testIdOf('code')"
              >{{ code }}</span
            >
          }
        </span>
      </span>
    </span>
    <span class="ui-coupon-card__foot">
      @if (uiDetail(); as detail) {
        <span
          class="ui-coupon-card__detail"
          [attr.data-testid]="testIdOf('detail')"
          >{{ detail }}</span
        >
      } @else {
        <span
          class="ui-coupon-card__detail ui-coupon-card__detail--none"
        ></span>
      }
      @if (uiAction(); as action) {
        <span class="ui-coupon-card__action">{{ action }}</span>
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
  /** The figure that matters where the card is read — what it takes off the bill. */
  readonly uiValue = input.required<string>();
  /** The code the offer opens by, when it has one. */
  readonly uiCode = input<string | null>(null);
  /** The offer's conditions — its rule, whether it stacks — in the chip. */
  readonly uiDetail = input<string | null>(null);
  /** The written call to action, «Use now»; an applied ticket projects a real button instead. */
  readonly uiAction = input<string | null>(null);
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

  protected testIdOf(part: 'value' | 'code' | 'detail'): string | null {
    const id = this.uiTestId();
    return id ? `${id}-${part}` : null;
  }
}
