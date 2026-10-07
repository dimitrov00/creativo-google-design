import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
} from '@angular/core';
import {
  UiBadge,
  UiButton,
  UiCard,
  UiCouponCard,
  UiGauge,
  UiIcon,
} from '@creativo/ui/controls';
import { UiTextDirective } from '@creativo/ui/modifiers';
import type { WalletHoldingVm } from '../client-pages.vm';

/** The two words the holdings print that no view model carries. */
export interface WalletHoldingsWords {
  /** «Карта с печати» — a stamp card's title (its line names the reward). */
  readonly stampCard: string;
  /** «Премахни» — an applied ticket's one verb. */
  readonly remove: string;
}

/** How many holdings stand side by side: one on a phone, two in the ≥ 761 dialog. */
export type WalletHoldingsColumns = 1 | 2;

/**
 * «В ПОРТФЕЙЛА» — what the person holds with the shop, every thing a
 * ticket on white paper, stacked (client-card-revision-3 §2.2.2 WC,
 * §3.13; owner, 2026-09-29: "stacked elevated passes, no rail"). In the
 * wallet's order: gift vouchers, reward tickets, stamp cards.
 *
 * A GIFT VOUCHER (WC1) is a ticket whose figure is its balance in the
 * accent («25,00 €»), its title «Ваучер за подарък», and ONE chip saying
 * what it was issued for and how long it is good («от 50,00 € · до
 * 31.12»). Nothing to press: a voucher is spent at the bill.
 *
 * A REWARD TICKET (WC2) is static here too — the DISC under the pass is
 * the verb, said once on the page — so it prints its validity in the chip
 * and no call. A ticket already on the bill is the discount page's own
 * applied card: the check, and its real «Премахни».
 *
 * A STAMP CARD (WC3) is a white card: «Карта с печати» over «10 печата за
 * безплатно подстригване», then the stamps themselves, five to a row, the
 * filled ones solid accent with a white mark, the empty ones ringed with
 * their numeral, the last one the reward. The stamps ARE the count: no
 * ring, no «3 от 10», no «още 7» (one fact, once).
 *
 * Presentational and worded upstream: the view models arrive final from
 * `walletHoldings`; the two words the pieces need and no model carries
 * come from the host (`words`).
 */
@Component({
  selector: 'lib-wallet-holdings',
  imports: [
    UiBadge,
    UiButton,
    UiCard,
    UiCouponCard,
    UiGauge,
    UiIcon,
    UiTextDirective,
  ],
  templateUrl: './wallet-holdings.html',
  styleUrl: './wallet-holdings.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'wallet-holdings',
    '[attr.data-columns]': 'columns()',
  },
})
export class WalletHoldings {
  /** In the wallet's order; the host decides what an empty list means. */
  readonly holdings = input.required<readonly WalletHoldingVm[]>();
  readonly words = input.required<WalletHoldingsWords>();
  /** One column on a phone; two in the centred dialog. */
  readonly columns = input<WalletHoldingsColumns>(1);
  /** An applied ticket's «Премахни»: the grant to take off the bill. */
  readonly removeReward = output<string>();

  /** One key per holding, by kind: a voucher's, a grant's, a rule's id. */
  protected keyOf(holding: WalletHoldingVm): string {
    switch (holding.kind) {
      case 'voucher':
        return `voucher:${holding.voucher.voucherId}`;
      case 'ticket':
        return `ticket:${holding.ticket.grantId}`;
      case 'stamps':
        return `stamps:${holding.card.ruleId}`;
    }
  }
}
