import { Injectable, inject } from '@angular/core';
import { getDocs, limit, query, where } from 'firebase/firestore';
import { FIREBASE_FIRESTORE } from '@creativo/infrastructure/firebase-app';
import { Result, fail, ok } from '@creativo/domain/kernel';
import { Coupon, GiftVoucher } from '@creativo/domain/engagement';
import {
  GiftVoucherReader,
  giftVoucherFromDocument,
} from '@creativo/application/engagement';
import { RepositoryError } from '@creativo/application/shared';
import { giftVouchersCollection } from './firestore-paths';

/**
 * `giftVouchers/*` by code — the counter's lookup, read side only.
 *
 * Whatever its state: a void or empty voucher is returned so the sheet can
 * say WHY it will not take, which "no such code" cannot. The balance is
 * never written from here — that happens inside the server transaction
 * that writes the visit drawing on it.
 */
@Injectable()
export class FirestoreGiftVoucherReader implements GiftVoucherReader {
  private readonly db = inject(FIREBASE_FIRESTORE);

  async findByCode(
    code: string,
  ): Promise<Result<GiftVoucher | null, RepositoryError>> {
    const normalized = Coupon.normalizeCode(code);
    if (normalized.length === 0) return ok(null);
    try {
      const snapshot = await getDocs(
        query(
          giftVouchersCollection(this.db),
          where('code', '==', normalized),
          limit(1),
        ),
      );
      const hit = snapshot.docs[0];
      if (hit === undefined) return ok(null);
      return ok(giftVoucherFromDocument(hit.id, hit.data()));
    } catch (error) {
      return fail(
        new RepositoryError('Failed to look up a gift voucher', error),
      );
    }
  }
}
