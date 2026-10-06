import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  signal,
  viewChild,
} from '@angular/core';
import { UiBadge, UiButton } from '@creativo/ui/controls';
import { UiIcon } from '@creativo/ui/icons';
import { UiStack } from '@creativo/ui/layout';
import {
  UiInteractiveDirective,
  UiTextDirective,
} from '@creativo/ui/modifiers';
import { UiCouponCard, UiOccasionBand } from '@creativo/ui/patterns';
import { ScDemo } from '../../../shared/demo';
import { ScPage } from '../../../shared/page';

/**
 * THE TICKET AND THE BAND (client card, revision 3 §3.4). Every sample
 * stands on a stand-in for the sheet it lives on, a 390 pt phone wide, so
 * the ticket is seen at the width it is used at (the column is 356); the
 * narrow ones are the 330 pt phone's (296).
 */
@Component({
  selector: 'cr-coupon-card-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ScDemo,
    ScPage,
    UiBadge,
    UiButton,
    UiCouponCard,
    UiIcon,
    UiInteractiveDirective,
    UiOccasionBand,
    UiStack,
    UiTextDirective,
  ],
  templateUrl: './coupon-card.page.html',
  styleUrl: './coupon-card.page.css',
})
export class CouponCardPage {
  /** What the last press did, said under the sample it belongs to. */
  protected readonly last = signal<string | null>(null);

  /** The gift on the draft bill: the moment's applied form. */
  protected readonly giftApplied = signal(false);

  /** The stamped ticket ‹ lands on: an article, focused by script. */
  private readonly landing = viewChild<ElementRef<HTMLElement>>('landing');

  protected act(what: string): void {
    this.last.set(what);
  }

  protected useGift(): void {
    this.giftApplied.set(true);
    this.last.set('Подаръкът е приложен');
  }

  protected removeGift(): void {
    this.giftApplied.set(false);
    this.last.set('Подаръкът е премахнат');
  }

  /** What ‹ does on the discount page: the focus goes to the ticket it came from. */
  protected land(): void {
    this.landing()?.nativeElement.focus({ preventScroll: true });
  }
}
