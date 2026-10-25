import {
  type Firestore,
  collection,
  doc,
  documentId,
  limit,
  query,
  where,
} from 'firebase/firestore';
import { type CouponId, GrantStatus, Result } from '@core/primitives';
import { type RepositoryError } from '@core/errors';
import { CouponStatus } from '@core/components';
import {
  Collections,
  type Coupon,
  type CouponGrant,
  type GiftVoucher,
  type OfferedCoupon,
} from '@core/entities';
import type { CouponVoucherPorts } from '@core/ports';
import { DiscountSystem } from '@core/systems';
import { readDoc, readQuery } from './observe';

/** Firestore's cap on the values of one `in` filter. */
const IN_FILTER_MAX = 30;

/** The first entity a `limit 1` query answered, or `null`. */
const first = <E>(
  answer: Result<readonly E[], RepositoryError>,
): Result<E | null, RepositoryError> =>
  answer.ok ? Result.ok(answer.value[0] ?? null) : answer;

/** `ids`, each once, in chunks one `in` filter can carry. */
function chunksOf(
  ids: readonly CouponId[],
  size: number,
): readonly (readonly CouponId[])[] {
  const distinct = [...new Set(ids)];
  const chunks: CouponId[][] = [];
  for (let start = 0; start < distinct.length; start += size) {
    chunks.push(distinct.slice(start, start + size));
  }
  return chunks;
}

/**
 * Coupons, grants and gift vouchers, read side (flip 1, plan §3.4) — the
 * successor of the coupon reader, the grant repository's reads, the gift
 * voucher reader and the client vouchers reader. Every query is an
 * equality on root keys (Firestore merges single-field indexes; no
 * composite): `code`, `couponStatus`, `customerId`, `grantStatus`,
 * `issuedToCustomerId`. A grant burn or a voucher balance is never written
 * from here — those are entries of the server's commit plans.
 */
export const couponVoucherPorts = (db: Firestore): CouponVoucherPorts => {
  const coupons = collection(db, Collections.Coupons);
  const grants = collection(db, Collections.CouponGrants);
  const vouchers = collection(db, Collections.GiftVouchers);

  return {
    /** The ENABLED coupon a typed (normalised) code names, `limit 1` — a retired code reads as no code. */
    findCouponByCode: async (code) =>
      first(
        await readQuery<Coupon>(
          query(
            coupons,
            where('code', '==', code),
            where('couponStatus', '==', CouponStatus.Enabled),
            limit(1),
          ),
          Collections.Coupons,
        ),
      ),

    /**
     * Every coupon on offer — the counter's offer list. One equality on
     * `couponStatus`; which of the answered coupons is on offer (`ENABLED`
     * and carrying a code) is `DiscountSystem.isOffered`, the ONE rule the
     * memory double and the staff day's promo list share — an absent code
     * is what "grant-only" looks like in the store, and an inequality on it
     * would ask for an index.
     */
    listOpenCoupons: async (): Promise<
      Result<readonly OfferedCoupon[], RepositoryError>
    > => {
      const open = await readQuery<Coupon>(
        query(coupons, where('couponStatus', '==', CouponStatus.Enabled)),
        Collections.Coupons,
      );
      return open.ok
        ? Result.ok(open.value.filter(DiscountSystem.isOffered))
        : open;
    },

    loadCouponGrant: (id) =>
      readDoc<CouponGrant>(doc(db, Collections.CouponGrants, id)),

    /**
     * A client's ACTIVE grants — `customerId ==`, `grantStatus ==` (D29: the
     * client record, never the account). Which are usable at a given instant
     * is `CouponGrantSystem`'s decision.
     */
    listUsableCouponGrants: (customerId) =>
      readQuery<CouponGrant>(
        query(
          grants,
          where('customerId', '==', customerId),
          where('grantStatus', '==', GrantStatus.Active),
        ),
        Collections.CouponGrants,
      ),

    /** The gift voucher a code names, whatever its state — the sheet says WHY a void one will not take. */
    findGiftVoucherByCode: async (code) =>
      first(
        await readQuery<GiftVoucher>(
          query(vouchers, where('code', '==', code), limit(1)),
          Collections.GiftVouchers,
        ),
      ),

    /**
     * Every voucher issued to a client, whatever its state, in the order
     * read — `issuedToCustomerId ==` (D29). A paper voucher has no holder,
     * so no client's query returns it.
     */
    listGiftVouchersForHolder: (customerId) =>
      readQuery<GiftVoucher>(
        query(vouchers, where('issuedToCustomerId', '==', customerId)),
        Collections.GiftVouchers,
      ),

    /**
     * The coupons a client's grants name, by id — `documentId() in`,
     * thirty ids a query, and NO status filter: a held grant whose coupon
     * was disabled since keeps its name, value and exclusivity in the
     * «Отстъпка» menu. An id with no document is simply not answered;
     * no ids, no read.
     */
    loadCoupons: async (ids) => {
      const batches = await Promise.all(
        chunksOf(ids, IN_FILTER_MAX).map((batch) =>
          readQuery<Coupon>(
            query(coupons, where(documentId(), 'in', batch)),
            Collections.Coupons,
          ),
        ),
      );
      const found: Coupon[] = [];
      for (const batch of batches) {
        if (!batch.ok) return batch;
        found.push(...batch.value);
      }
      return Result.ok(found);
    },
  };
};
