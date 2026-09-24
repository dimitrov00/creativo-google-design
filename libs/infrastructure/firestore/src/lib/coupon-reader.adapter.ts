import { Injectable, inject } from '@angular/core';
import { getDocs, limit, query, where } from 'firebase/firestore';
import { FIREBASE_FIRESTORE } from '@creativo/infrastructure/firebase-app';
import { Result, fail, ok } from '@creativo/domain/kernel';
import { Coupon } from '@creativo/domain/engagement';
import { CouponReader } from '@creativo/application/engagement';
import { RepositoryError } from '@creativo/application/shared';
import { couponsCollection } from './firestore-paths';
import { couponFromPersistence } from './coupon-persistence';

/**
 * `coupons/*` by code — the counter's lookup.
 *
 * One equality query on the stored, upper-case `code`, filtered to enabled
 * coupons so a retired code reads as "no such code" rather than as a promise
 * the shop no longer keeps. `coupons` is readable by any signed-in account
 * (`firestore.rules`), which is right: a code on a flyer is public by
 * construction, and a barber resolving one at the chair is the reader this
 * exists for.
 */
@Injectable()
export class FirestoreCouponReader implements CouponReader {
  private readonly db = inject(FIREBASE_FIRESTORE);

  async findByCode(
    code: string,
  ): Promise<Result<Coupon | null, RepositoryError>> {
    const normalized = Coupon.normalizeCode(code);
    if (normalized.length === 0) return ok(null);
    try {
      const snapshot = await getDocs(
        query(
          couponsCollection(this.db),
          where('code', '==', normalized),
          where('enabled', '==', true),
          limit(1),
        ),
      );
      const hit = snapshot.docs[0];
      if (hit === undefined) return ok(null);
      const coupon = couponFromPersistence(hit.id, hit.data() ?? {});
      return coupon.isFailure() ? fail(coupon.error) : ok(coupon.value);
    } catch (error) {
      return fail(
        new RepositoryError('Failed to look up a coupon code', error),
      );
    }
  }

  /**
   * `coupons/*` that are enabled and carry a code — one equality query on
   * `enabled`, the code's presence read off each document, because a
   * missing field is what "grant-only" looks like in the store and an
   * inequality on it would ask for an index this read does not need.
   */
  async listOpen(): Promise<Result<readonly Coupon[], RepositoryError>> {
    try {
      const snapshot = await getDocs(
        query(couponsCollection(this.db), where('enabled', '==', true)),
      );
      const coupons: Coupon[] = [];
      for (const doc of snapshot.docs) {
        const coupon = couponFromPersistence(doc.id, doc.data() ?? {});
        if (coupon.isFailure()) return fail(coupon.error);
        if (coupon.value.code !== null) coupons.push(coupon.value);
      }
      return ok(coupons);
    } catch (error) {
      return fail(new RepositoryError('Failed to list live coupons', error));
    }
  }
}
