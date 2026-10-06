import { Injectable, inject } from '@angular/core';
import { getDocs, query, where } from 'firebase/firestore';
import { FIREBASE_FIRESTORE } from '@creativo/infrastructure/firebase-app';
import { UserId } from '@creativo/domain/accounts';
import { Result, fail, ok } from '@creativo/domain/kernel';
import type { GiftVoucher } from '@creativo/domain/engagement';
import {
  type ClientVouchersReader,
  GIFT_VOUCHER_HOLDER_FIELD,
  giftVoucherFromDocument,
} from '@creativo/application/engagement';
import { RepositoryError } from '@creativo/application/shared';
import { giftVouchersCollection } from './firestore-paths';

/**
 * `giftVouchers/*` by HOLDER: what a person has, where the counter's
 * lookup (`FirestoreGiftVoucherReader`) answers what a code is worth
 * (client-card-revision-3.md §4.5).
 *
 * One equality on `issuedToUserId`, which Firestore serves from the index
 * it keeps by itself. Rules are not filters: the query names the holder,
 * and the rule lets the book list any holder's vouchers and a client
 * their own.
 *
 * Whatever their state, in the order read: the spent and the voided ones
 * are here too, and whoever draws the list keeps what it shows. A paper
 * voucher has no holder, so no holder's query returns it. A document that
 * is no voucher is left out rather than costing the person the rest.
 *
 * Read once, like every read of the card; `getDocs` falls back to the
 * persistent cache when the network is gone, so a barber offline in the
 * chair still sees the last balance. The balance is never written from
 * here.
 */
@Injectable()
export class FirestoreClientVouchersReader implements ClientVouchersReader {
  private readonly db = inject(FIREBASE_FIRESTORE);

  async listForHolder(
    userId: string,
  ): Promise<Result<readonly GiftVoucher[], RepositoryError>> {
    const holder = UserId.create(userId);
    // Nobody holds the vouchers of no one: an empty list, and no read.
    if (holder.isFailure()) return ok([]);
    try {
      const snapshot = await getDocs(
        query(
          giftVouchersCollection(this.db),
          where(GIFT_VOUCHER_HOLDER_FIELD, '==', holder.value.value),
        ),
      );
      return ok(
        snapshot.docs.flatMap((entry) => {
          const voucher = giftVoucherFromDocument(entry.id, entry.data());
          return voucher === null ? [] : [voucher];
        }),
      );
    } catch (error) {
      return fail(
        new RepositoryError('Failed to read a client’s gift vouchers', error),
      );
    }
  }
}
