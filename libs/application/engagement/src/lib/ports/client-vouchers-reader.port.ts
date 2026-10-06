import { InjectionToken } from '@angular/core';
import type { Result } from '@creativo/domain/kernel';
import type { GiftVoucher } from '@creativo/domain/engagement';
import { RepositoryError } from '@creativo/application/shared';

/**
 * THE GIFT VOUCHERS A PERSON HOLDS (client-card-revision-3.md §4.5): what
 * the wallet draws under «В портфейла».
 *
 * The counter's lookup (`GiftVoucherReader.findByCode`) answers "what is
 * this code worth"; this one answers "what does this client have", which a
 * code cannot: nobody reads their codes out to see a balance. Its own
 * token, not a second method there, because that reader's fakes are
 * written in several libs.
 *
 * A one-shot read, like every read of the card: a balance moves when a
 * visit settles, not while someone looks at a client.
 */
export interface ClientVouchersReader {
  /**
   * The vouchers issued to this account, WHATEVER THEIR STATE, in any
   * order: the spent and the voided ones are here too, and whoever draws
   * the list keeps what it shows (the wallet: `active`, with a balance).
   *
   * A paper voucher has no holder, so it is on nobody's list: it belongs
   * to whoever presents its code at the bill. A document that is no
   * voucher is left out rather than costing the person the rest; a client
   * who holds none is an empty list, never an error.
   */
  listForHolder(
    userId: string,
  ): Promise<Result<readonly GiftVoucher[], RepositoryError>>;
}

export const CLIENT_VOUCHERS_READER = new InjectionToken<ClientVouchersReader>(
  'ClientVouchersReader',
);
