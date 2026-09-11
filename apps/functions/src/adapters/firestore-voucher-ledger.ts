import type { Firestore, Transaction } from 'firebase-admin/firestore';
import { Result, fail, ok } from '@creativo/domain/kernel';
import { Coupon, GiftVoucher } from '@creativo/domain/engagement';
import { giftVoucherFromDocument } from '@creativo/application/engagement';
import type { VoucherLedger } from '../use-cases/staff-edit-appointment.use-case';
import type { StaffEditError } from '../use-cases/staff-edit-appointment.errors';
import { CommitBookingStoreError } from '../use-cases/commit-booking.errors';

/**
 * The gift vouchers a staff edit draws on, read and written INSIDE the
 * edit's transaction — the balance is the one thing here that two counters
 * can race for, and the visit that draws it down is written in the same
 * breath. Only the balance moves: the rest of the document is the issuer's.
 */
export class FirestoreVoucherLedger implements VoucherLedger {
  constructor(private readonly db: Firestore) {}

  async read(
    tx: Transaction,
    codes: readonly string[],
    ids: readonly string[],
  ): Promise<Result<readonly GiftVoucher[], StaffEditError>> {
    try {
      const found = new Map<string, GiftVoucher>();
      for (const id of ids) {
        const snap = await tx.get(this.db.collection('giftVouchers').doc(id));
        const voucher = giftVoucherFromDocument(snap.id, snap.data());
        if (voucher) found.set(voucher.id.value, voucher);
      }
      for (const raw of codes) {
        const code = Coupon.normalizeCode(raw);
        if ([...found.values()].some((voucher) => voucher.code === code)) {
          continue;
        }
        const hits = await tx.get(
          this.db.collection('giftVouchers').where('code', '==', code).limit(1),
        );
        const hit = hits.docs[0];
        if (hit === undefined) continue;
        const voucher = giftVoucherFromDocument(hit.id, hit.data());
        if (voucher) found.set(voucher.id.value, voucher);
      }
      return ok([...found.values()]);
    } catch (error) {
      return fail(new CommitBookingStoreError(error));
    }
  }

  write(tx: Transaction, vouchers: readonly GiftVoucher[]): void {
    for (const voucher of vouchers) {
      tx.update(this.db.collection('giftVouchers').doc(voucher.id.value), {
        balanceMinorUnits: voucher.balance.toMinorUnits(),
      });
    }
  }
}
