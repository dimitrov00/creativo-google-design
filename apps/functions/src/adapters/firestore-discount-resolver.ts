import type { Firestore } from 'firebase-admin/firestore';
import { Coupon } from '@creativo/domain/engagement';
import { couponValueFromDocument } from '@creativo/application/booking';
import type {
  DiscountResolver,
  ResolvedCode,
  ResolvedGrant,
} from '../use-cases/staff-edit-appointment.use-case';

/**
 * The promises a staff discount may name, read through the Admin SDK.
 *
 * Two point-reads and one equality query, none of them inside the edit's
 * transaction: a grant or a coupon is not what the transaction protects
 * (the appointment is), and holding the hot busy documents open while a
 * catalogue lookup runs would only widen the conflict window. What is read
 * here is a SNAPSHOT of the promise; ownership of a grant is checked against
 * the appointment inside the transaction, where the owner is known.
 *
 * The value mapper is `couponValueFromDocument` from the shared document
 * module — the same vocabulary `coupons/*`, `couponGrants/*.value` and an
 * appointment's `discounts[].value` are all written in, so a coupon authored
 * on the admin side reads back here without a second mapping.
 */
export class FirestoreDiscountResolver implements DiscountResolver {
  constructor(private readonly db: Firestore) {}

  async grant(grantId: string): Promise<ResolvedGrant | null> {
    const snap = await this.db.collection('couponGrants').doc(grantId).get();
    const data = snap.data();
    if (!data) return null;
    const value = couponValueFromDocument(data['value']);
    const userId = data['userId'];
    if (value === null || typeof userId !== 'string') return null;

    // Usable = active, and not past an expiry the grant carries. The same
    // test `CouponGrant.isUsable` makes, read off the stored state rather
    // than through the client SDK's mapper, which this runtime cannot load.
    const state = (data['state'] ?? {}) as Record<string, unknown>;
    let usable = state['kind'] === 'active';
    const expiration = (state['expiration'] ?? {}) as Record<string, unknown>;
    if (usable && expiration['kind'] === 'expires_at') {
      const at = Date.parse(String(expiration['atIso'] ?? ''));
      usable = Number.isFinite(at) && at > Date.now();
    }

    // The coupon's NAME is the receipt's word for this promise; the grant
    // carries only the value. A grant whose coupon is gone keeps its value
    // and is labelled by the grant itself — the promise stands.
    const couponId = String(data['couponId'] ?? '');
    let label = couponId || grantId;
    // Whether it may share the bill is the COUPON's rule; a grant whose
    // coupon is gone is read as stackable, the permissive reading.
    let exclusive = false;
    if (couponId) {
      const coupon = await this.db.collection('coupons').doc(couponId).get();
      const name = coupon.data()?.['name'];
      if (typeof name === 'string' && name.trim().length > 0) label = name;
      exclusive = isExclusive(coupon.data());
    }

    return { grantId, userId, label, value, usable, exclusive };
  }

  async code(code: string): Promise<ResolvedCode | null> {
    const normalized = Coupon.normalizeCode(code);
    if (normalized.length === 0) return null;
    const hits = await this.db
      .collection('coupons')
      .where('code', '==', normalized)
      .where('enabled', '==', true)
      .limit(1)
      .get();
    const hit = hits.docs[0];
    if (hit === undefined) return null;
    const data = hit.data();
    const value = couponValueFromDocument(data['value']);
    const name = data['name'];
    if (value === null || typeof name !== 'string' || !name.trim()) return null;
    return {
      couponId: hit.id,
      label: name,
      value,
      code: normalized,
      exclusive: isExclusive(data),
    };
  }
}

/** `combinability.kind` off a coupon document — `exclusive` only when it says so. */
function isExclusive(data: Record<string, unknown> | undefined): boolean {
  const combinability = data?.['combinability'] as
    Record<string, unknown> | undefined;
  return combinability?.['kind'] === 'exclusive';
}
